import { readFileSync } from "fs";

const html = readFileSync("public-site/gltchrunner.com/index.html", "utf8");
const script = html.match(/<div class="banners" id="banners"><\/div>\s*<script>([\s\S]*?)<\/script>/)[1];

function makeEl(tag) {
  return { tag, className: "", children: [], attrs: {}, style: {},
    textContent: "", href: "",
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); },
    set _t(v) {} };
}

function run({ now, store = {}, sale = null }) {
  const host = makeEl("div");
  Object.defineProperty(host, "textContent", {
    get() { return ""; }, set(v) { if (v === "") this.children = []; },
  });
  const ctx = {
    document: { getElementById: (id) => (id === "banners" ? host : null), createElement: makeEl },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    Date: class extends Date { static now() { return now; } },
    setInterval: () => 0,
    fetch: () => (sale
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ sales: [sale] }) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ sales: [] }) })),
  };
  ctx.Date.parse = Date.parse;
  new Function(...Object.keys(ctx), script)(...Object.values(ctx));
  return { host, store };
}

const SALE = { id: "5649dad6", title: "Using XRGE", discount_percent: 20,
  bonus_credits_percent: 0, ends_at: "2026-09-09T18:36:20.237Z" };
const titles = (h) => h.children.map((c) => c.children[0].textContent);

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        got  ${JSON.stringify(got)}` +
    (ok ? "" : `\n        want ${JSON.stringify(want)}`));
};

const T = (s) => Date.parse(s);

// Today, sale live: status wins, sale takes the second slot, cap holds at 2.
let r = run({ now: T("2026-09-06T18:00:00Z"), sale: SALE });
await new Promise((res) => setImmediate(res));
check("today, sale live", titles(r.host), ["All systems operational", "Flash sale"]);

// API down: never invent a sale, fall through to the next banner.
r = run({ now: T("2026-09-06T18:00:00Z"), sale: null });
await new Promise((res) => setImmediate(res));
check("no sale from API", titles(r.host), ["All systems operational", "New — Krea 2"]);

// After the status banner expires and the sale has ended.
r = run({ now: T("2026-09-12T00:00:00Z"), sale: null });
await new Promise((res) => setImmediate(res));
check("Sep 12 — launches take over", titles(r.host), ["New — Krea 2", "Upgraded — LTX-2.3"]);

// After the launch claims expire, only the evergreen promo remains.
r = run({ now: T("2026-10-01T00:00:00Z"), sale: null });
await new Promise((res) => setImmediate(res));
check("Oct 1 — evergreen only", titles(r.host), ["Buy & Hold XRGE"]);

// Dismissing promotes the next banner into the free slot.
r = run({ now: T("2026-09-06T18:00:00Z"), sale: null,
  store: { "gltch-banner-status-2026-09-06-restored": "1" } });
await new Promise((res) => setImmediate(res));
check("status dismissed", titles(r.host), ["New — Krea 2", "Upgraded — LTX-2.3"]);

// A sale dismissal is keyed to the sale id, so the next sale still shows.
r = run({ now: T("2026-09-06T18:00:00Z"), sale: SALE,
  store: { "gltch-banner-flash-5649dad6": "1" } });
await new Promise((res) => setImmediate(res));
check("that sale dismissed", titles(r.host), ["All systems operational", "New — Krea 2"]);

// An expired sale is never shown even if the API still returns it. Sep 20 is
// still inside the launch banners' window, so they are what fills the slots.
r = run({ now: T("2026-09-20T00:00:00Z"), sale: SALE });
await new Promise((res) => setImmediate(res));
check("stale sale from API", titles(r.host), ["New \u2014 Krea 2", "Upgraded \u2014 LTX-2.3"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
