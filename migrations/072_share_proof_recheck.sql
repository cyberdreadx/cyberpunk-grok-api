-- Re-verification state for social proofs.
--
-- verifyTweetLinksToUs() proves a post existed and linked to us at the moment
-- it was claimed. It cannot prove the post still exists tomorrow, and 20 of the
-- last 71 X proofs — 28% — were deleted after being paid for. One account
-- deleted 10 of its 11. The mission buys promotion; a deleted post delivers
-- none, so the credits have to come back.
--
-- Deliberately NOT a hold on the reward: paying only after a post survives a
-- day would make the mission feel broken for the honest majority. Pay on claim,
-- re-check later, reverse what vanished.

ALTER TABLE daily_share_proofs
  ADD COLUMN IF NOT EXISTS rechecked_at   TIMESTAMPTZ,
  -- 'alive'      — still readable and still ours
  -- 'gone'       — 404 twice; the post was deleted
  -- 'hidden'     — 403; account went private or was locked. NOT clawed back:
  --                a locked account is not the same act as a deletion and we
  --                cannot tell which from outside.
  -- 'unreadable' — anything else, including rate limiting. Retried, never
  --                charged for. The media integrity probe produced 139 false
  --                positives by treating throttling as absence.
  ADD COLUMN IF NOT EXISTS recheck_status VARCHAR(16),
  ADD COLUMN IF NOT EXISTS recheck_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clawed_back    INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_share_proofs_recheck
  ON daily_share_proofs(claim_date)
  WHERE recheck_status IS DISTINCT FROM 'gone' AND clawed_back = 0;
