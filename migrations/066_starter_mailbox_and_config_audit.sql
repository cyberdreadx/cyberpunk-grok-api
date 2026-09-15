-- 066: starter grants dedupe by inbox as well as device; audit every app_config change.
--
-- Starter credits were one per device. The device key is a fingerprint computed
-- in the browser, so it changes with the browser, profile or user agent, and
-- farmers rotate it. In the program's first weeks 49 inboxes collected more than
-- one grant — 102 extra, 27% of all grants. The tell was N accounts on exactly N
-- devices (one Gmail inbox: 8 accounts, 8 devices, 7 grants). Plus-addressing
-- covered the email side: 48.7% of recipients signed up with a +tag.
--
-- mailbox is the canonical inbox from api/_lib/email-canonical.ts: +tags stripped
-- everywhere, dots collapsed on Gmail. It is nullable because a grant whose
-- account was deleted can no longer be resolved to an address, and NULLs never
-- collide in a unique index. scripts/backfill-starter-mailbox.mts fills it for
-- the earliest grant per inbox only, so creating the index before the backfill
-- is safe and the backfill cannot violate it.
ALTER TABLE starter_grants ADD COLUMN IF NOT EXISTS mailbox text;
CREATE UNIQUE INDEX IF NOT EXISTS starter_grants_mailbox_key ON starter_grants (mailbox);

-- app_config holds the switches that decide who gets free GPU — free_credits
-- alone governs on the order of $1k a month — and on 2026-09-15 every source was
-- switched on with no record of who did it or what the value was before.
--
-- A trigger rather than application code, so a write from any path, hand-run SQL
-- included, is kept. actor is read from value->>'updated_by', which the admin
-- endpoints now stamp. High-churn system keys are skipped: the XRGE price, the AI
-- summary and campaign progress rewrite themselves constantly and would bury the
-- changes that are worth reading.
CREATE TABLE IF NOT EXISTS app_config_audit (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  actor text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_config_audit_key ON app_config_audit (key, changed_at DESC);

CREATE OR REPLACE FUNCTION app_config_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.key IN ('xrge_last_price_usd', 'admin_ai_summary', 'active_email_campaign') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.value IS NOT DISTINCT FROM NEW.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO app_config_audit (key, old_value, new_value, actor)
  VALUES (
    NEW.key,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END,
    NEW.value,
    CASE WHEN jsonb_typeof(NEW.value) = 'object' THEN NEW.value->>'updated_by' ELSE NULL END
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_config_audit_trg ON app_config;
CREATE TRIGGER app_config_audit_trg AFTER INSERT OR UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION app_config_audit_fn();
