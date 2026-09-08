/**
 * POST /api/auth/delete-account
 * Permanently deletes the user's account. Requires password confirmation.
 * Cancels any active Stripe subscription before deletion.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { getDb } from "../_lib/db";
import { getUserFromRequest } from "../_lib/auth";
import { deleteBlobs, isVercelBlobUrl } from "../_lib/blob";
import { isR2Url, r2KeyFromUrl, deleteR2Objects, deleteR2Prefix } from "../_lib/r2";
import { previewKeyForKey } from "../_lib/preview-url";
import { recordPurge } from "../_lib/purgeLog";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const auth = getUserFromRequest(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized" });

    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: "Password is required to delete your account" });
    }

    const sql = getDb();

    // Verify password
    const [user] = await sql`
      SELECT id, email, password_hash, stripe_customer_id, subscription_tier, device_fingerprint
      FROM users WHERE id = ${auth.userId}
    `;
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    // ── Stripe subscriptions must be gone BEFORE the row is ───────────
    //
    // This used to warn and delete anyway. It cannot: transactions.user_id has
    // a foreign key to users, so once the row is gone every future invoice for
    // that customer 500s on the webhook — while the card keeps being charged,
    // because deleting our row does not cancel anything at Stripe.
    //
    // That produced 11 subscriptions billing $470/month against accounts that
    // no longer exist, $1,444.71 taken, one person paying for three of them.
    // The cancel call had been failing every single time: the live key is
    // restricted and has no Subscriptions Write scope, so it throws
    // "Permission denied" and the old catch swallowed it.
    //
    // Refusing the deletion is the right failure. A user who cannot delete
    // today is annoyed; a user silently charged for a year disputes, and three
    // disputes in one month puts the whole account into Visa's monitoring
    // programme.
    if (user.stripe_customer_id) {
      const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
      if (!STRIPE_KEY) {
        console.error("[delete-account] no Stripe key — refusing to delete a billable account");
        return res.status(503).json({
          error: "Account deletion is temporarily unavailable. Please try again later.",
          code: "billing_unavailable",
        });
      }

      let active: Stripe.Subscription[] = [];
      try {
        const stripe = new Stripe(STRIPE_KEY);
        // status:"all" then filter, so trialing/past_due/unpaid count too —
        // every one of those still bills or resumes billing later.
        const subs = await stripe.subscriptions.list({
          customer: user.stripe_customer_id,
          status: "all",
          limit: 100,
        });
        active = subs.data.filter((s) =>
          ["active", "trialing", "past_due", "unpaid", "paused"].includes(s.status));

        for (const sub of active) {
          await stripe.subscriptions.cancel(sub.id);
          console.log(`[delete-account] cancelled ${sub.id} for ${auth.userId}`);
        }
        active = [];
      } catch (err: any) {
        console.error(
          `[delete-account] REFUSED — could not cancel Stripe subscriptions for ${auth.userId}: ${err.message}`,
        );
        return res.status(409).json({
          error:
            "We could not cancel your active subscription automatically, so we have not deleted your " +
            "account — deleting it now would leave you being charged with no way to stop it. " +
            "Please cancel your subscription first from Settings, or email gltch.app@proton.me and " +
            "we will cancel it and delete the account for you.",
          code: "subscription_cancel_failed",
        });
      }
    }

    // -----------------------------------------------------------------
    // PRIVACY: purge all user-owned media from blob/R2 storage BEFORE
    // dropping the DB rows. Without this, share links / feed posts /
    // stories / avatars would remain publicly accessible after the
    // account is gone (reported privacy bug).
    // -----------------------------------------------------------------
    const blobUrls: string[] = [];
    const r2Keys: string[] = [];
    const sharePrefixes: string[] = [];

    const collect = (url?: string | null) => {
      if (!url || typeof url !== "string") return;
      if (isVercelBlobUrl(url)) blobUrls.push(url);
      else if (isR2Url(url)) {
        const key = r2KeyFromUrl(url);
        if (key) {
          r2Keys.push(key);
          // Companion preview object (-preview.webp convention).
          if (!key.endsWith("-preview.webp")) r2Keys.push(previewKeyForKey(key));
        }
      }
    };

    try {
      // 1. Share links owned by this user — list each shares/<id>.* prefix.
      const shares = await sql`SELECT share_id FROM share_owners WHERE user_id = ${user.id}`;
      for (const row of shares) {
        if (row.share_id && /^[a-zA-Z0-9_-]{4,16}$/.test(row.share_id)) {
          sharePrefixes.push(`shares/${row.share_id}`);
        }
      }
    } catch (e: any) { console.warn("[delete-account] share_owners scan:", e?.message); }

    try {
      const posts = await sql`SELECT image_url, preview_image_url FROM feed_posts WHERE user_id = ${user.id}`;
      for (const row of posts) { collect(row.image_url); collect(row.preview_image_url); }
    } catch (e: any) { console.warn("[delete-account] feed_posts scan:", e?.message); }

    try {
      const storiesRows = await sql`SELECT media_url, preview_url FROM stories WHERE user_id = ${user.id}`;
      for (const row of storiesRows) { collect(row.media_url); collect(row.preview_url); }
    } catch (e: any) { console.warn("[delete-account] stories scan:", e?.message); }

    try {
      const profs = await sql`SELECT avatar_url FROM profiles WHERE user_id = ${user.id}`;
      for (const row of profs) collect(row.avatar_url);
    } catch (e: any) { console.warn("[delete-account] profiles scan:", e?.message); }

    // Fire-and-await purge (best-effort; never blocks deletion on errors).
    let blobTally = { found: 0, deleted: 0, failed: 0 };
    let r2Tally = { found: 0, deleted: 0, failed: 0 };
    let sharePrefixDeleted = 0;
    let sharePrefixErrors = 0;
    try {
      // Presigned client uploads are keyed <folder>/<userId>/… — sweep those
      // prefixes so uploads whose DB rows are already gone still get purged.
      // comfyui-output/<uid>/ holds generation outputs (referenced only from
      // the user's local library) and gltch/seedance use <prefix>/<uid>-…
      const uploadFolders = ["feed", "stories", "avatars", "prompts", "creator-applications", "uploads", "comfyui-output"];
      const userPrefixes = [
        ...uploadFolders.map((f) => `${f}/${user.id}/`),
        `gltch/${user.id}-`,
        `seedance/${user.id}-`,
      ];
      const [b, r, ...prefixCounts] = await Promise.all([
        deleteBlobs(blobUrls),
        deleteR2Objects(r2Keys),
        ...userPrefixes.map((p) => deleteR2Prefix(p)),
        ...sharePrefixes.map(async (p) => {
          let n = 0;
          // Shares may live in either Vercel Blob (legacy) or R2 (current).
          try {
            const { list, del } = await import("@vercel/blob");
            const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.grokrun_READ_WRITE_TOKEN;
            if (token) {
              const { blobs } = await list({ prefix: p, token });
              await Promise.all(blobs.map((bl) =>
                del(bl.url, { token }).then(() => { n++; }).catch(() => { sharePrefixErrors++; })
              ));
            }
          } catch (e: any) { sharePrefixErrors++; console.warn("[delete-account] share blob purge:", e?.message); }
          n += await deleteR2Prefix(p);
          return n;
        }),
      ]);
      blobTally = b;
      r2Tally = r;
      sharePrefixDeleted = (prefixCounts as number[]).reduce((a, b) => a + b, 0);
      console.log(
        `[delete-account] purged media for ${user.email}: ` +
        `${blobTally.deleted}/${blobTally.found} blobs, ${r2Tally.deleted}/${r2Tally.found} R2 objs, ` +
        `${sharePrefixDeleted} share-prefix files (${sharePrefixes.length} prefixes)`
      );
    } catch (e: any) {
      console.warn("[delete-account] media purge encountered errors:", e?.message);
    }

    // Audit log — survives the user-row delete because target_user_id is not FK'd.
    await recordPurge({
      kind: "account-delete",
      actorUserId: auth.userId,
      actorEmail: auth.email,
      targetUserId: user.id,
      targetEmail: user.email,
      blobsFound: blobTally.found + sharePrefixDeleted + sharePrefixErrors,
      blobsDeleted: blobTally.deleted + sharePrefixDeleted,
      r2Found: r2Tally.found,
      r2Deleted: r2Tally.deleted,
      errors: blobTally.failed + r2Tally.failed + sharePrefixErrors,
      notes: { sharePrefixes: sharePrefixes.length },
    });


    // Tombstone BEFORE deleting: signup.ts counts these so delete→recreate
    // cycles can't reset the per-device account cap or free up the email.
    try {
      await sql`
        INSERT INTO deleted_accounts (email, device_fingerprint, user_id)
        VALUES (${user.email}, ${user.device_fingerprint || null}, ${user.id}::uuid)
      `;
    } catch (e: any) {
      console.warn("[delete-account] tombstone insert failed:", e?.message);
    }

    // Delete user (cascades to referrals, transactions, share_owners, feed_posts,
    // stories, profiles, etc. via ON DELETE CASCADE)
    await sql`DELETE FROM transactions WHERE user_id = ${user.id}`;
    await sql`DELETE FROM referrals WHERE referrer_id = ${user.id} OR referee_id = ${user.id}`;
    await sql`DELETE FROM users WHERE id = ${user.id}`;

    console.log(`[delete-account] Deleted user ${user.email} (${user.id})`);

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (err: any) {
    console.error("[delete-account]", err.message);
    return res.status(500).json({ error: "Failed to delete account" });
  }
}
