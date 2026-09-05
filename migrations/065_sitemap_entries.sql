-- 065_sitemap_entries.sql
--
-- 18,000 share pages exist and 3 URLs were in the sitemap, so none of them were
-- discoverable: nothing on the site links to /s/:id, and Google had no other
-- route in.
--
-- Share metadata lives in R2 as one JSON per share, so the sitemap cannot be
-- built per request — it is curated offline by scripts/build-sitemap.mts and
-- rendered from this table by api/sitemap.ts.

CREATE TABLE IF NOT EXISTS public.sitemap_entries (
  share_id    TEXT PRIMARY KEY,
  ext         TEXT NOT NULL,
  title       TEXT NOT NULL,
  -- Normalised prompt, deduped on. Two hundred people rendering "a cat" should
  -- not become two hundred near-identical pages; that is what thin-content
  -- penalties are for.
  prompt_key  TEXT NOT NULL,
  lastmod     TIMESTAMPTZ NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sitemap_prompt_key
  ON public.sitemap_entries(prompt_key);

CREATE INDEX IF NOT EXISTS idx_sitemap_lastmod
  ON public.sitemap_entries(lastmod DESC);
