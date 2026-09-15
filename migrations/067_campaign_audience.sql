-- 067: frozen per-campaign audiences.
--
-- Campaigns chose recipients live from users — verified, opted in, not already
-- sent that campaign — and nothing else. The v5.5 blast on 2026-09-01 sent
-- 25,038 emails, 6,078 of them (24.3%) to throwaway domains, plus accounts under
-- active bans and farm clusters. Mail to dead and trap inboxes drags down the
-- sending domain's reputation, and that same reputation carries verification
-- codes and receipts.
--
-- A campaign with rows here is sent ONLY to those rows, still re-checked live at
-- send time for verification, opt-out, active bans, prior delivery and — where
-- the row asks — a subscription taken out since the audience was built.
-- Campaigns without rows keep the old behaviour. Audiences are built in
-- TypeScript (scripts/build-campaign-audience-*.mts) so the disposable-domain
-- and canonical-inbox rules are the same code signup and the starter grant use.
CREATE TABLE IF NOT EXISTS campaign_audience (
  campaign text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  skip_if_subscribed boolean NOT NULL DEFAULT false,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign, user_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_audience_campaign ON campaign_audience (campaign);
