import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "./config.js";

let _sql: NeonQueryFunction<false, false> | null = null;

export function getDb() {
  if (!_sql) _sql = neon(config.databaseUrl);
  return _sql;
}

export async function ensureTelegramUser(telegramId: number, username?: string, firstName?: string) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO telegram_users (telegram_id, username, first_name)
    VALUES (${telegramId}, ${username || null}, ${firstName || null})
    ON CONFLICT (telegram_id) DO UPDATE
      SET username   = COALESCE(EXCLUDED.username, telegram_users.username),
          first_name = COALESCE(EXCLUDED.first_name, telegram_users.first_name),
          updated_at = now()
    RETURNING id, telegram_id, credits, linked_user_id
  `;
  return rows[0] as {
    id: string;
    telegram_id: number;
    credits: number;
    linked_user_id: string | null;
  };
}

export async function getCredits(tgUserId: string, linkedUserId: string | null): Promise<number> {
  const sql = getDb();
  if (linkedUserId) {
    const rows = await sql`
      SELECT (COALESCE(sub_credits, 0) + COALESCE(pack_credits, 0)) AS total
      FROM users WHERE id = ${linkedUserId}::uuid
    `;
    if (rows.length > 0) return Number(rows[0].total);
  }
  const rows = await sql`
    SELECT credits FROM telegram_users WHERE id = ${tgUserId}::uuid
  `;
  return rows.length > 0 ? Number(rows[0].credits) : 0;
}

export async function deductCredits(tgUserId: string, linkedUserId: string | null, amount: number): Promise<boolean> {
  const sql = getDb();
  if (linkedUserId) {
    const rows = await sql`
      UPDATE users
      SET sub_credits = CASE
            WHEN sub_credits >= ${amount} THEN sub_credits - ${amount}
            ELSE 0
          END,
          pack_credits = CASE
            WHEN sub_credits >= ${amount} THEN pack_credits
            ELSE pack_credits - (${amount} - sub_credits)
          END,
          updated_at = now()
      WHERE id = ${linkedUserId}::uuid
        AND (COALESCE(sub_credits, 0) + COALESCE(pack_credits, 0)) >= ${amount}
      RETURNING id
    `;
    return rows.length > 0;
  }
  const rows = await sql`
    UPDATE telegram_users
    SET credits = credits - ${amount}, updated_at = now()
    WHERE id = ${tgUserId}::uuid AND credits >= ${amount}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function addCredits(tgUserId: string, linkedUserId: string | null, amount: number): Promise<void> {
  const sql = getDb();
  if (linkedUserId) {
    await sql`
      UPDATE users SET pack_credits = pack_credits + ${amount}, updated_at = now()
      WHERE id = ${linkedUserId}::uuid
    `;
  } else {
    await sql`
      UPDATE telegram_users SET credits = credits + ${amount}, updated_at = now()
      WHERE id = ${tgUserId}::uuid
    `;
  }
}

export async function refundCredits(tgUserId: string, linkedUserId: string | null, amount: number): Promise<void> {
  await addCredits(tgUserId, linkedUserId, amount);
}

export async function createJob(p: {
  telegramUserId: string;
  chatId: number;
  messageId: number;
  runpodJobId: string;
  endpointId: string;
  jobType: string;
  outputType: string;
  creditsUsed: number;
}): Promise<string> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO telegram_jobs (telegram_user_id, chat_id, message_id, runpod_job_id, endpoint_id, job_type, output_type, credits_used)
    VALUES (${p.telegramUserId}::uuid, ${p.chatId}, ${p.messageId}, ${p.runpodJobId}, ${p.endpointId}, ${p.jobType}, ${p.outputType}, ${p.creditsUsed})
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function getPendingJobs() {
  const sql = getDb();
  return await sql`
    SELECT j.*, tu.linked_user_id
    FROM telegram_jobs j
    JOIN telegram_users tu ON tu.id = j.telegram_user_id
    WHERE j.status = 'pending'
      AND j.created_at > now() - interval '10 minutes'
    ORDER BY j.created_at ASC
  `;
}

export async function completeJob(jobId: string, status: "completed" | "failed") {
  const sql = getDb();
  await sql`
    UPDATE telegram_jobs SET status = ${status}, completed_at = now()
    WHERE id = ${jobId}::uuid
  `;
}

export async function recordTransaction(p: {
  telegramUserId: string;
  credits: number;
  paymentMethod: "stars" | "xrge";
  starsAmount?: number;
  xrgeAmount?: string;
  txHash?: string;
  telegramPaymentId?: string;
}) {
  const sql = getDb();
  await sql`
    INSERT INTO telegram_transactions (telegram_user_id, credits, payment_method, stars_amount, xrge_amount, tx_hash, telegram_payment_id)
    VALUES (${p.telegramUserId}::uuid, ${p.credits}, ${p.paymentMethod}, ${p.starsAmount || null}, ${p.xrgeAmount || null}, ${p.txHash || null}, ${p.telegramPaymentId || null})
  `;
}

export async function createLinkCode(tgUserId: string): Promise<string> {
  const sql = getDb();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await sql`DELETE FROM telegram_link_codes WHERE telegram_user_id = ${tgUserId}::uuid`;
  await sql`
    INSERT INTO telegram_link_codes (telegram_user_id, code)
    VALUES (${tgUserId}::uuid, ${code})
  `;
  return code;
}

export async function verifyLinkCode(code: string, webUserId: string): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`
    SELECT lc.telegram_user_id
    FROM telegram_link_codes lc
    WHERE lc.code = ${code}
      AND lc.used = false
      AND lc.expires_at > now()
  `;
  if (rows.length === 0) return false;

  const tgUserId = rows[0].telegram_user_id;
  await sql`UPDATE telegram_link_codes SET used = true WHERE code = ${code}`;
  await sql`
    UPDATE telegram_users SET linked_user_id = ${webUserId}::uuid, updated_at = now()
    WHERE id = ${tgUserId}::uuid
  `;
  return true;
}
