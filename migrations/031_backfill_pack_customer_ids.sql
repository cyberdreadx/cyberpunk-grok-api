-- Backfill stripe_customer_id for users who bought credit packs but never had
-- their customer id persisted (webhook bug — pack branch only added credits).
--
-- Without stripe_customer_id, hasPurchased() returns false and these users
-- got "Failed to post story" despite paying.
--
-- We mark them as paying customers using a sentinel based on their earliest
-- pack transaction's stripe_session_id. Real customer ids will overwrite this
-- on their next subscription / portal interaction.
UPDATE users u
SET stripe_customer_id = 'pack_' || sub.first_session
FROM (
  SELECT DISTINCT ON (user_id) user_id, stripe_session_id AS first_session
  FROM transactions
  WHERE type = 'pack'
    AND amount_cents > 0
    AND stripe_session_id IS NOT NULL
  ORDER BY user_id, created_at ASC
) sub
WHERE u.id = sub.user_id
  AND u.stripe_customer_id IS NULL;
