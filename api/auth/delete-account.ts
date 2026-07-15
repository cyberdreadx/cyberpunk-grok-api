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

    // Cancel active Stripe subscription if exists
    if (user.stripe_customer_id && user.subscription_tier) {
      try {
        const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
        if (STRIPE_KEY) {
          const stripe = new Stripe(STRIPE_KEY);
          const subs = await stripe.subscriptions.list({
            customer: user.stripe_customer_id,
            status: "active",
            limit: 5,
          });
          for (const sub of subs.data) {
            await stripe.subscriptions.cancel(sub.id);
          }
        }
      } catch (err: any) {
        console.warn("[delete-account] Failed to cancel Stripe sub:", err.message);
        // Continue with deletion anyway
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
        if (key) r2Keys.push(key);
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
      const posts = await sql`SELECT image_url FROM feed_posts WHERE user_id = ${user.id}`;
      for (const row of posts) collect(row.image_url);
    } catch (e: any) { console.warn("[delete-account] feed_posts scan:", e?.message); }

    try {
      const storiesRows = await sql`SELECT media_url FROM stories WHERE user_id = ${user.id}`;
      for (const row of storiesRows) collect(row.media_url);
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
      const [b, r, ...prefixCounts] = await Promise.all([
        deleteBlobs(blobUrls),
        deleteR2Objects(r2Keys),
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
