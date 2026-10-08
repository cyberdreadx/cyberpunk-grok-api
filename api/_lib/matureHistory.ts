/**
 * Whether an account has posted anything flagged 18+ (feed post or story).
 *
 * Someone who has posted 18+ once gets 18+ as the default for everything they
 * post after: the switch starts on in the post dialogs, and a request that
 * leaves isMature out (API clients, older app builds) is stored as 18+. They
 * can still turn it off for a post that is safe.
 */
export async function postsMature(sql: any, userId: string): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT
        EXISTS (SELECT 1 FROM feed_posts WHERE user_id = ${userId}::uuid AND is_mature = true)
        OR EXISTS (SELECT 1 FROM stories WHERE user_id = ${userId}::uuid AND is_mature = true) AS m
    `;
    return !!row?.m;
  } catch {
    return false;
  }
}
