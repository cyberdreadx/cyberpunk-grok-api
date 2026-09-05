/**
 * Curate share pages into the sitemap.
 *
 * 18,000 share pages exist; the sitemap had 3 URLs. They are server-rendered
 * with real titles and OG tags and robots.txt allows them, but nothing links to
 * them, so none were ever discoverable.
 *
 * This does NOT submit all 18,000. Their titles are raw user prompts, which is
 * weak on its own and actively risky in bulk — thousands of near-identical
 * thin pages is a recognised way to get a domain devalued rather than ranked.
 * So it takes a capped, deduped, quality-filtered slice, and the cap exists to
 * be raised once there is evidence it helps.
 *
 *   node --env-file=.env --import tsx scripts/build-sitemap.mts            # 300, dry run
 *   node --env-file=.env --import tsx scripts/build-sitemap.mts --write
 *   node --env-file=.env --import tsx scripts/build-sitemap.mts --write --limit 800
 *
 * Re-running is safe: entries upsert by share_id and dedupe by prompt.
 */
process.env.RESEND_API_KEY = "";

import { getDb } from "/home/neon/cyberpunk-grok-api/api/_lib/db.ts";
import { fetchShareMetadata } from "/home/neon/cyberpunk-grok-api/api/_lib/share-metadata.ts";

const sql = getDb();
const WRITE = process.argv.includes("--write");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 300;
const CANDIDATE_POOL = LIMIT * 40; // the vast majority get filtered out
/** Escape hatch. Read the UNDRESS comment before reaching for it. */
const ALLOW_ALL = process.argv.includes("--no-content-filter");

/** Collapse a prompt to what makes it the same page as another one. */
function promptKey(p: string): string {
  return p.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Prompts that must not be actively submitted for indexing.
 *
 * Two separate reasons, and the second is the one that matters.
 *
 * Explicit prompts are pointless here: Google gates them behind SafeSearch, so
 * they cannot deliver the general search traffic this exists to capture, while
 * still shaping how the whole domain gets classified.
 *
 * "Undress this photo" prompts are a different question entirely. Those pages
 * existing because a user made them is one thing; publishing a sitemap that
 * asks Google to crawl, index and surface a searchable corpus of them is an
 * escalation — for the site's legal exposure, and for whoever is in the source
 * photograph. A crawler invitation is not a neutral act.
 */
const UNDRESS = /\b(undress|entkleide|desnuda|desnúda|quitale|quítale|quitales|remove (all |her |the )?(clothes|clothing|bra|top|dress|underwear)|take off (her|his|the) (clothes|clothing)|nude(ify|ify)?|deshabille|spogliala)\b/i;

const EXPLICIT = /\b(nsfw|nude|naked|nackt|pussy|vagina|cock|penis|dick|tits|boobs|pechos|tetas|culo|ass|anal|blowjob|cum|orgasm|masturbat\w*|sex|porn|slut|whore|fuck\w*|erect\w*|nipple|areola|genital|lingerie|thong|topless|bikini)\b/i;

/**
 * Is this prompt worth a page of its own?
 *
 * Deliberately strict. A sitemap is a claim that these URLs are worth crawling,
 * and a page whose title is "aaa" or a bare model name devalues the ones that
 * are.
 */
function usable(prompt: string): string | null {
  const p = prompt.trim().replace(/\s+/g, " ");
  if (p.length < 25 || p.length > 300) return null;
  const words = p.split(" ").filter((w) => w.length > 1);
  if (words.length < 5) return null;
  // Mostly punctuation, emoji or parameter soup is not a description.
  const letters = (p.match(/[a-z]/gi) || []).length;
  if (letters / p.length < 0.6) return null;
  // Prompt-syntax leftovers make terrible titles.
  if (/\b(lora|ckpt|safetensors|--\w+|<\w+:)/i.test(p)) return null;
  if (!ALLOW_ALL && (UNDRESS.test(p) || EXPLICIT.test(p))) return null;
  return p;
}

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

const candidates = await sql`
  SELECT share_id, ext, created_at
  FROM share_owners
  WHERE ext = 'png'          -- image pages index far better than bare video pages
  ORDER BY created_at DESC
  LIMIT ${CANDIDATE_POOL}
` as any[];

console.log(`${candidates.length} candidates, want ${LIMIT}\n`);

const seen = new Set<string>();
const picked: Array<{ share_id: string; ext: string; title: string; key: string; lastmod: string }> = [];
let fetched = 0, noMeta = 0, rejected = 0, dupe = 0;

// Existing keys count as taken, so a re-run doesn't fight with what's stored.
for (const r of await sql`SELECT prompt_key FROM sitemap_entries` as any[]) seen.add(r.prompt_key);

for (const c of candidates) {
  if (picked.length >= LIMIT) break;
  fetched++;
  if (fetched % 200 === 0) process.stdout.write(`  ${fetched} checked, ${picked.length} kept\n`);

  let meta: any = null;
  try { meta = await fetchShareMetadata(c.share_id); } catch { /* counted below */ }
  if (!meta || !meta.mediaUrl) { noMeta++; continue; }

  const prompt = usable(String(meta.prompt || ""));
  if (!prompt) { rejected++; continue; }

  const key = promptKey(prompt);
  if (!key || seen.has(key)) { dupe++; continue; }
  seen.add(key);

  picked.push({
    share_id: c.share_id,
    ext: c.ext,
    title: truncate(prompt, 120),
    key,
    lastmod: new Date(c.created_at).toISOString(),
  });
}

console.log(`\nchecked ${fetched} · kept ${picked.length}`);
console.log(`  no metadata in R2 : ${noMeta}`);
console.log(`  prompt unusable   : ${rejected}`);
console.log(`  duplicate prompt  : ${dupe}`);
console.log(`  (explicit / undress prompts are excluded unless --no-content-filter)`);

console.log(`\nsample of what would be submitted:`);
for (const p of picked.slice(0, 8)) console.log(`  /s/${p.share_id}  ${truncate(p.title, 78)}`);

if (!WRITE) {
  console.log(`\ndry run — pass --write to store these`);
  process.exit(0);
}

let wrote = 0;
for (const p of picked) {
  const [row] = await sql`
    INSERT INTO sitemap_entries (share_id, ext, title, prompt_key, lastmod)
    VALUES (${p.share_id}, ${p.ext}, ${p.title}, ${p.key}, ${p.lastmod})
    ON CONFLICT (share_id) DO UPDATE SET title = EXCLUDED.title, lastmod = EXCLUDED.lastmod
    RETURNING share_id
  `.catch(() => [undefined]) as any[]; // prompt_key collision with an existing row
  if (row) wrote++;
}

const [total] = await sql`SELECT count(*)::int n FROM sitemap_entries` as any[];
console.log(`\nwrote ${wrote} · sitemap now has ${total.n} share pages`);
console.log(`verify: curl -s https://grokrunner.gltch.app/sitemap.xml | grep -c "<loc>"`);
process.exit(0);
