/**
 * End-to-end check of the wallet ownership proof.
 *
 * Signs with a throwaway key so there's a real signature to verify rather than a
 * mocked one — the whole point of this change is that only a genuine signature
 * gets through, and a test that stubs the signature would prove nothing.
 *
 *   node --env-file=.env --import tsx scripts/wallet-verify-check.mts
 *
 * Binds and then unbinds the owner account. Costs no credits.
 */
process.env.RESEND_API_KEY = "";

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { signToken } from "/home/neon/cyberpunk-grok-api/api/_lib/auth.ts";

const sql = getDb();
const BASE = "https://api.gltch.app";

const [owner] = await sql`
  SELECT id, email, wallet_address FROM users WHERE email = 'cyberdreadx@proton.me' LIMIT 1` as any[];
const token = signToken({ userId: owner.id, email: owner.email });
const priorWallet = owner.wallet_address;

const call = async (path: string, init: any = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
};

const account = privateKeyToAccount(generatePrivateKey());
const addr = account.address.toLowerCase();
console.log(`${owner.email} · test wallet ${addr}`);
console.log(`prior binding: ${priorWallet || "(none)"}\n`);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// 1. The old attack: bind an address you don't own, no signature.
const noSig = await call("/api/v1/xrge-wallet", { method: "POST", body: { walletAddress: addr } });
check("unsigned bind rejected", noSig.status === 400 && noSig.body.code === "signature_required",
  `${noSig.status} ${noSig.body.code || noSig.body.error}`);

// 2. Challenge issue.
const ch = await call(`/api/v1/xrge-wallet?address=${addr}`);
check("challenge issued", ch.status === 200 && !!ch.body.nonce && ch.body.message?.includes(addr),
  `${ch.status}`);
if (!ch.body.nonce) { console.log("\ncannot continue without a challenge"); process.exit(1); }

// 3. A signature from a DIFFERENT key over the same message must not pass.
const impostor = privateKeyToAccount(generatePrivateKey());
const badSig = await impostor.signMessage({ message: ch.body.message });
const bad = await call("/api/v1/xrge-wallet", {
  method: "POST", body: { walletAddress: addr, nonce: ch.body.nonce, signature: badSig },
});
check("wrong-key signature rejected", bad.status === 401, `${bad.status} ${bad.body.code || ""}`);

// 4. That failed attempt must have burned the nonce.
const goodSigOldNonce = await account.signMessage({ message: ch.body.message });
const replay = await call("/api/v1/xrge-wallet", {
  method: "POST", body: { walletAddress: addr, nonce: ch.body.nonce, signature: goodSigOldNonce },
});
check("nonce is single-use", replay.status === 400 && replay.body.code === "challenge_invalid",
  `${replay.status} ${replay.body.code || ""}`);

// 5. The real thing: fresh challenge, correct key.
const ch2 = await call(`/api/v1/xrge-wallet?address=${addr}`);
const goodSig = await account.signMessage({ message: ch2.body.message });
const ok = await call("/api/v1/xrge-wallet", {
  method: "POST", body: { walletAddress: addr, nonce: ch2.body.nonce, signature: goodSig },
});
check("valid signature binds", ok.status === 200 && ok.body.walletAddress === addr,
  `${ok.status} ${ok.body.error || ""}`);

// 6. Signature over a message the server never issued.
const ch3 = await call(`/api/v1/xrge-wallet?address=${addr}`);
const forged = await account.signMessage({ message: "Bind my wallet, nonce: 1234" });
const wrongMsg = await call("/api/v1/xrge-wallet", {
  method: "POST", body: { walletAddress: addr, nonce: ch3.body.nonce, signature: forged },
});
check("signature over foreign message rejected", wrongMsg.status === 401, `${wrongMsg.status}`);

// 7. wallet_verified_at actually recorded.
const [after] = await sql`SELECT wallet_address, wallet_verified_at FROM users WHERE id = ${owner.id}` as any[];
check("wallet_verified_at stamped", !!after.wallet_verified_at && after.wallet_address === addr);

// 8. The profile route must no longer accept a new address.
const viaProfile = await call("/api/profile", {
  method: "PUT", body: { walletAddress: "0x" + "a".repeat(40) },
});
check("profile route refuses new address",
  viaProfile.status === 400 && viaProfile.body.code === "wallet_requires_signature",
  `${viaProfile.status} ${viaProfile.body.code || viaProfile.body.error}`);

// 9. ...but resubmitting the bound address is a no-op, so profile saves still work.
const sameAddr = await call("/api/profile", { method: "PUT", body: { walletAddress: addr } });
check("profile save with unchanged address still works", sameAddr.status === 200,
  `${sameAddr.status} ${sameAddr.body.error || ""}`);

// Restore.
await call("/api/v1/xrge-wallet", { method: "DELETE" });
if (priorWallet) {
  await sql`UPDATE users SET wallet_address = ${priorWallet} WHERE id = ${owner.id}`;
}
const [restored] = await sql`SELECT wallet_address FROM users WHERE id = ${owner.id}` as any[];
check("test binding cleaned up", (restored.wallet_address || null) === (priorWallet || null),
  `now ${restored.wallet_address || "(none)"}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
