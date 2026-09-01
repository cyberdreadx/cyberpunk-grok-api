import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowRight, Bot, Boxes, ChevronDown, CircuitBoard, Cpu, Eye,
  Film, Gauge, Globe, Image as ImageIcon, Layers, Lock, Network, Play,
  Radar, Radio, ShieldCheck, Sparkles, Users, Wand2, Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { isAgeVerified, AGE_VERIFIED_EVENT } from "@/lib/ageGate";
import "./commandCenter.css";

const GridCity = lazy(() => import("./GridCity"));

const SIGNUP = "/create?signup=1";

/* ──────────────────────────────────────────────────────────────────────────
   Small utilities
   ────────────────────────────────────────────────────────────────────────── */

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(
      (window as any).WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function themeColor(varName: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return v ? `hsl(${v})` : fallback;
  } catch {
    return fallback;
  }
}

/** Catches a WebGL/runtime failure in the canvas subtree → static fallback. */
class CanvasBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { err: boolean }
> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

function CanvasLayer() {
  const cfg = useMemo(() => {
    const mobile = typeof window !== "undefined" && window.innerWidth < 820;
    return {
      enabled: hasWebGL() && !prefersReducedMotion(),
      density: mobile ? 14 : 22,
      packets: mobile ? 90 : 220,
    };
  }, []);

  if (!cfg.enabled) return <div className="cc-fallback" />;
  return (
    <CanvasBoundary fallback={<div className="cc-fallback" />}>
      <Suspense fallback={<div className="cc-fallback" />}>
        <GridCity density={cfg.density} packets={cfg.packets} />
      </Suspense>
    </CanvasBoundary>
  );
}

/** IntersectionObserver-driven reveal-on-scroll wrapper. */
function Reveal({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (setInView(true), io.disconnect())),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`cc-reveal ${inView ? "in" : ""} ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Eased count-up that runs once when scrolled into view. */
function CountUp({ to, suffix = "", prefix = "", decimals = 0 }: { to: number; suffix?: string; prefix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      const dur = 1500;
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        setVal(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{prefix}{val.toFixed(decimals)}{suffix}</span>;
}

/** Animated random-walk sparkline on a canvas, themed via CSS vars. */
function Sparkline({ varName = "--primary" }: { varName?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      cv.width = Math.max(1, cv.clientWidth * dpr);
      cv.height = Math.max(1, cv.clientHeight * dpr);
    };
    resize();
    const stroke = themeColor(varName, "hsl(180 100% 50%)");
    const N = 64;
    const data = new Array(N).fill(0.5);
    const reduced = prefersReducedMotion();
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      if (now - last > 70) {
        last = now;
        const next = Math.min(0.95, Math.max(0.08, data[N - 1] + (Math.random() - 0.5) * 0.32));
        data.push(next);
        data.shift();
      }
      const w = cv.width, h = cv.height;
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h - data[i] * h * 0.9 - h * 0.05;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, stroke.replace(")", " / 0.35)").replace("hsl(", "hsla("));
      grad.addColorStop(1, stroke.replace(")", " / 0)").replace("hsl(", "hsla("));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const y = h - data[i] * h * 0.9 - h * 0.05;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6 * dpr;
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 8 * dpr;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [varName]);
  return <canvas ref={ref} className="cc-spark" />;
}

/* ──────────────────────────────────────────────────────────────────────────
   Static content
   ────────────────────────────────────────────────────────────────────────── */

const AGENTS = [
  { name: "PRISM", role: "Image Synthesis", icon: ImageIcon, desc: "Turns a prompt into cinematic, uncensored stills in seconds — no gatekeeping, no watered-down models." },
  { name: "REEL", role: "Video Render", icon: Film, desc: "Dispatches motion jobs across the GPU swarm and upscales the result to crisp, shareable clips." },
  { name: "ATLAS", role: "Grid Orchestration", icon: Network, desc: "Watches queue depth and latency, then auto-scales render nodes so your jobs never wait in line." },
  { name: "AEGIS", role: "Safety Layer", icon: ShieldCheck, desc: "Runs every output through guardrails — adult-but-consensual, with the hard lines enforced automatically." },
];

const FEATURES = [
  { icon: Wand2, title: "UNCENSORED MODELS", desc: "Generation without the corporate lobotomy. Real creative range for adult work." },
  { icon: Film, title: "IMAGE + VIDEO", desc: "GLTCH, GLTCH PRO, LTX (video with sound) and LongLook engines — prompt, render, upscale, and publish stills or clips." },
  { icon: Users, title: "CREATOR ECONOMY", desc: "Follow models, unlock locked drops, and cash out — creators keep 75% via instant Stripe or XRGE payouts." },
  { icon: Bot, title: "PERSONA CHAT", desc: "Talk to AI personas that generate selfies and clips mid-conversation, on demand." },
  { icon: Zap, title: "MEMBERSHIP CREDITS", desc: "Subscribe for a monthly credit drop that out-values every pack, plus daily bonuses, missions and the spin wheel." },
  { icon: Lock, title: "PRIVATE BY DEFAULT", desc: "Your library is yours. Share what you want, lock the rest behind the grid." },
];

const FEED_LINES: { a: string; t: string; alert?: boolean }[] = [
  { a: "PRISM", t: "image batch ×8 synthesized" },
  { a: "REEL", t: "6s cinematic clip dispatched" },
  { a: "ATLAS", t: "render pool scaled +4 nodes" },
  { a: "AEGIS", t: "content scan passed" },
  { a: "GRID", t: "new creator provisioned" },
  { a: "REEL", t: "1080p upscale complete" },
  { a: "PRISM", t: "persona portrait generated" },
  { a: "ATLAS", t: "latency spike absorbed", alert: true },
  { a: "GRID", t: "credit drop distributed" },
  { a: "AEGIS", t: "policy guardrail enforced" },
  { a: "REEL", t: "motion job queued // 03 ahead" },
  { a: "PRISM", t: "style transfer locked in" },
];

/** `r` (the red highlight) belonged to the PAYOUTS entry, which came off the
 *  first screen. No item is highlighted now, so the type carries no `r`. */
const TICKER: { b: string; t: string }[] = [
  { b: "GRID", t: "all districts reporting" },
  { b: "RENDER", t: "swarm at nominal load" },
  { b: "MODELS", t: "uncensored set online" },
  { b: "CREATORS", t: "onboarding open" },
  { b: "CHAT", t: "personas responsive" },
  { b: "CREDITS", t: "daily drop armed" },
];


/* ──────────────────────────────────────────────────────────────────────────
   Live showcase — real top-rated posts pulled from the public feed API.
   Logged-out responses only carry preview thumbnails (full-res is stripped
   server-side); we additionally show only SFW, non-locked posts here.
   ────────────────────────────────────────────────────────────────────────── */

type ShowcasePost = { id: string; username: string; preview?: string; full?: string; score: number };

const isVideoUrl = (u?: string | null) => !!u && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u);

/** One showcase tile. Tries the preview thumb, falls back to the full image
 *  (old posts have no preview in storage), and reports itself dead if neither
 *  loads so the grid can swap in the next candidate. */
function ShowcaseTile({ post, onJoin, onDead }: {
  post: ShowcasePost; onJoin: () => void; onDead: (id: string) => void;
}) {
  const [src, setSrc] = useState(post.preview || post.full!);
  const triedFull = useRef(!post.preview || post.preview === post.full);
  return (
    <div
      className="cc-shot"
      onClick={onJoin}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onJoin()}
    >
      <img
        src={src}
        alt={`Render by @${post.username}`}
        loading="lazy"
        onError={() => {
          if (!triedFull.current && post.full) {
            triedFull.current = true;
            setSrc(post.full);
          } else {
            onDead(post.id);
          }
        }}
      />
      <div className="who">
        <span>@{post.username}</span>
        {post.score > 0 && <span className="score">▲ {post.score}</span>}
      </div>
    </div>
  );
}

function LiveShowcase({ onJoin }: { onJoin: () => void }) {
  const [posts, setPosts] = useState<ShowcasePost[]>([]);
  const [dead, setDead] = useState<Set<string>>(() => new Set());
  const [ageOk, setAgeOk] = useState(() => isAgeVerified());

  // The age gate is a modal, so it dims the page but leaves everything behind
  // it in the DOM — showcase images were loading and showing through before
  // anyone confirmed anything. Hold the fetch until age is confirmed so the
  // media is never requested, not merely covered up.
  useEffect(() => {
    if (ageOk) return;
    const onConfirm = () => setAgeOk(isAgeVerified());
    window.addEventListener(AGE_VERIFIED_EVENT, onConfirm);
    window.addEventListener("storage", onConfirm);
    return () => {
      window.removeEventListener(AGE_VERIFIED_EVENT, onConfirm);
      window.removeEventListener("storage", onConfirm);
    };
  }, [ageOk]);

  useEffect(() => {
    if (!ageOk) return;
    let alive = true;
    // strict, not sfw=1: the mature flag is self-reported and most posters have
    // never touched it, so "not flagged" alone is not evidence of anything on a
    // public page. strict also requires the poster to have used the flag before.
    apiFetch<{ posts: any[] }>("/feed?sort=top&sfw=strict", { auth: false })
      .then((d) => {
        if (!alive || !Array.isArray(d?.posts)) return;
        const candidates = d.posts
          .filter(
            (p) =>
              !p.isMature &&
              !(p.lockCost > 0 || p.lockPriceCents > 0 || p.lockXrgeAmount) &&
              (p.previewImageUrl || (p.imageUrl && !isVideoUrl(p.imageUrl))),
          )
          .map((p) => ({
            id: p.id,
            username: p.username || "operator",
            preview: p.previewImageUrl || undefined,
            full: p.imageUrl && !isVideoUrl(p.imageUrl) ? (p.imageUrl as string) : undefined,
            score: p.score || 0,
          }));
        setPosts(candidates);
      })
      .catch(() => {}); // fetch failure → section simply doesn't render
    return () => { alive = false; };
  }, [ageOk]);

  const visible = posts.filter((p) => !dead.has(p.id)).slice(0, 7);
  if (visible.length < 3) return null;

  return (
    <section className="cc-section cc-section-bg" id="cc-showcase-sec">
      <Reveal>
        <div className="cc-kicker">Live From The Grid</div>
        <h2 className="cc-h2">Real renders, <span className="g">straight off the feed</span></h2>
        <p className="cc-lead">
          Top-rated drops from operators on the grid — not a curated demo reel.
          This is the safe-for-work slice; sign up to see the uncut feed.
        </p>
      </Reveal>
      <Reveal>
        <div className="cc-showcase">
          {visible.map((p) => (
            <ShowcaseTile
              key={p.id}
              post={p}
              onJoin={onJoin}
              onDead={(id) => setDead((prev) => new Set(prev).add(id))}
            />
          ))}
          <button className="cc-shot cta" onClick={onJoin}>
            <Sparkles size={20} />
            <span>SEE THE FULL FEED</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </Reveal>
    </section>
  );
}

function fmtClock(d: Date) {
  return d.toISOString().slice(11, 19);
}

/* ──────────────────────────────────────────────────────────────────────────
   Main component
   ────────────────────────────────────────────────────────────────────────── */

export default function CommandCenterLanding() {
  const navigate = useNavigate();
  const go = () => navigate(SIGNUP);
  const goSignIn = () => navigate("/create?signin=1");

  const [clock, setClock] = useState(() => new Date());
  const [feed, setFeed] = useState<{ id: number; ts: string; a: string; t: string; alert?: boolean }[]>([]);
  const feedId = useRef(0);

  // Master clock
  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(i);
  }, []);


  // Autonomous activity feed
  useEffect(() => {
    const push = () => {
      const line = FEED_LINES[Math.floor(Math.random() * FEED_LINES.length)];
      setFeed((prev) => {
        const row = { id: feedId.current++, ts: fmtClock(new Date()), ...line };
        return [row, ...prev].slice(0, 6);
      });
    };
    push();
    const i = setInterval(push, 2400);
    return () => clearInterval(i);
  }, []);

  const clockStr = fmtClock(clock);

  return (
    <div className="cc-root">
      {/* Fixed 3D grid behind everything */}
      <div className="cc-canvas" aria-hidden>
        <CanvasLayer />
      </div>

      {/* Atmosphere overlays */}
      <div className="cc-overlay cc-scanlines cc-flicker" aria-hidden />
      <div className="cc-overlay cc-vignette" aria-hidden />
      <span className="cc-corner tl" aria-hidden />
      <span className="cc-corner tr" aria-hidden />
      <span className="cc-corner bl" aria-hidden />
      <span className="cc-corner br" aria-hidden />

      {/* Top command bar */}
      <header className="cc-topbar cc-content">
        <div className="cc-brand">
          <span className="dot" />
          <span><span className="accent">GLTCH</span> RUNNER</span>
          <span style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 9, letterSpacing: "0.2em", color: "hsl(var(--foreground) / 0.4)", marginLeft: 4 }}>// COMMAND</span>
        </div>
        <div className="cc-statuschips">
          <span className="cc-chip" style={{ fontVariantNumeric: "tabular-nums" }}><Radio size={11} />{clockStr} UTC</span>
          <button className="cc-btn cc-btn-primary" style={{ padding: "9px 18px", fontSize: 11 }} onClick={go}>
            SIGN UP <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* The left HUD rail used to sit here with GRID TELEMETRY (grid load, queue
          depth, latency, GPU node count) and SUBSYSTEMS (per-service ONLINE /
          DEGRADED lights). Every number was a Math.random() walk and the
          service lights flipped at random, with "payouts" pinned to DEGRADED
          as deliberate flavour. The result was that a first-time visitor's
          opening impression could be IMAGE-ENGINE DEGRADED — decoration
          reporting an outage that wasn't happening. Removed rather than
          wired up: real status belongs behind login or on a /status page,
          not in the first paint. -- 2026-09-01 */}

      <aside className="cc-rail right cc-content" aria-hidden>
        <div className="cc-panel">
          <div className="cc-panel-head"><span>LIVE ACTIVITY</span><Activity size={12} /></div>
          <div className="cc-panel-body">
            <div className="cc-feed">
              {feed.map((r) => (
                <div className={`cc-feed-row ${r.alert ? "alert" : ""}`} key={r.id}>
                  <span className="ts">{r.ts}</span>
                  <span><span className="agent">{r.a}</span> ▸ {r.t}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 8, fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: "hsl(var(--primary) / 0.7)" }}>
              <span>autonomous agents</span><span className="cc-caret">&nbsp;</span>
            </div>
          </div>
        </div>
      </aside>

      {/* HERO */}
      <section className="cc-hero cc-content">
        <span className="cc-eyebrow">Autonomous Creation Network</span>
        <h1 className="cc-title">
          ENTER THE{" "}
          <span className="cc-glitch g" data-text="GRID">GRID</span>
        </h1>
        <p className="cc-subtitle">
          GLTCH Runner is mission control for uncensored AI. Generate cinematic images and video,
          command a swarm of render nodes, and follow the creators building on the grid —
          all from one command center.
        </p>
        <div className="cc-cta-row">
          <button className="cc-btn cc-btn-primary" onClick={go}>
            <Zap size={16} /> Start Creating Free
          </button>
          <button
            className="cc-btn cc-btn-ghost"
            onClick={() =>
              (document.getElementById("cc-showcase-sec") ?? document.getElementById("cc-grid-sec"))
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Play size={15} /> See It Live
          </button>
        </div>
        <div className="cc-hero-meta">
          <span><b>◇</b> No card required</span>
          <span><b>◇</b> Uncensored image + video</span>
          <span><b>◇</b> Runs in your browser</span>
        </div>
        <div className="cc-scroll-hint">
          <span>SCROLL TO EXPLORE</span>
          <ChevronDown size={16} />
        </div>
      </section>

      {/* SECTION — the living grid */}
      <section className="cc-section cc-section-bg" id="cc-grid-sec">
        <Reveal>
          <div className="cc-kicker">The Grid</div>
          <h2 className="cc-h2">A living map of <span className="g">everything you make</span></h2>
          <p className="cc-lead">
            Every tower in the city is a node on the network. Streams of light are real jobs moving
            between districts — prompts compiling, frames rendering, clips shipping. The red towers?
            That's the swarm catching a spike before you'd ever feel it.
          </p>
        </Reveal>
        <div className="cc-grid c3">
          {[
            { ic: Boxes, h: "Towers = nodes", p: "Creators, models and render pools, laid out as a skyline you can actually watch work." },
            { ic: Radar, h: "Packets = live jobs", p: "Each glow is a render in motion — image synthesis, video, persona media — flowing in real time." },
            { ic: Eye, h: "Red = the swarm acting", p: "Autonomous agents resolve latency and load before it reaches you. Mission control, automated." },
          ].map((c, i) => (
            <Reveal key={i} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="cc-card">
                <div className="cc-card-ic"><c.ic size={22} /></div>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* SECTION — live showcase (real feed content, SFW only) */}
      <LiveShowcase onJoin={go} />

      {/* SECTION — autonomous render swarm */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-kicker">Autonomous Swarm</div>
          <h2 className="cc-h2">Agents that <span className="g">never sleep</span></h2>
          <p className="cc-lead">
            Four autonomous systems run the grid around the clock so creation feels instant.
            You write the prompt — they handle the rest.
          </p>
        </Reveal>
        <div className="cc-grid c2">
          {AGENTS.map((a, i) => (
            <Reveal key={a.name} style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="cc-card cc-agent">
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div className="cc-card-ic" style={{ marginBottom: 0 }}><a.icon size={22} /></div>
                  <div>
                    <div className="role">{a.role}</div>
                    <div className="name">{a.name}</div>
                  </div>
                </div>
                <p style={{ marginTop: 12 }}>{a.desc}</p>
                <div className="barwrap"><div className="bar" style={{ animationDelay: `${i * 0.4}s` }} /></div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* SECTION — how it works */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-kicker">Operations</div>
          <h2 className="cc-h2">Three moves to <span className="g">go live</span></h2>
        </Reveal>
        <div className="cc-grid c3">
          {[
            { n: "01", ic: Wand2, h: "Prompt", p: "Describe it. Pick a model or a persona. Hit render — image or video, your call." },
            { n: "02", ic: Cpu, h: "Render", p: "The swarm dispatches your job across GPU nodes and upscales the output automatically." },
            { n: "03", ic: Sparkles, h: "Publish & earn", p: "Drop it to the feed, build a following, and cash out instantly when fans unlock your work." },
          ].map((s, i) => (
            <Reveal key={s.n} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="cc-card">
                <div className="cc-step">
                  <span className="num">{s.n}</span>
                  <div>
                    <div className="cc-card-ic"><s.ic size={20} /></div>
                    <h3>{s.h}</h3>
                    <p>{s.p}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* STATS band */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-stats">
            <div className="cc-stat"><div className="n"><CountUp to={350} suffix="K+" /></div><div className="l">Renders generated</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={24} suffix="K+" /></div><div className="l">Operators on the grid</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={100} suffix="%" /></div><div className="l">Uncensored</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={24} /><span className="u">/7</span></div><div className="l">Always-on swarm</div></div>
          </div>
        </Reveal>
      </section>

      {/* FEATURE grid */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-kicker">Capabilities</div>
          <h2 className="cc-h2">Everything wired into <span className="g">one console</span></h2>
        </Reveal>
        <div className="cc-grid c3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <div className="cc-card">
                <span className="tag">// {String(i + 1).padStart(2, "0")}</span>
                <div className="cc-card-ic"><f.icon size={22} /></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="cc-final cc-section-bg">
        <Reveal>
          <div className="cc-kicker" style={{ justifyContent: "center" }}><Globe size={13} /> The grid is online</div>
          <h2 className="cc-h2">Take command of <span className="g">the grid</span></h2>
          <p className="cc-lead" style={{ margin: "0 auto 30px" }}>
            Free to start. Uncensored image and video generation, a live creator feed,
            and instant payouts — just hit deploy.
          </p>
          <div className="cc-cta-row" style={{ justifyContent: "center" }}>
            <button className="cc-btn cc-btn-primary" onClick={go}>
              <Zap size={16} /> Start Creating Free
            </button>
            <button className="cc-btn cc-btn-ghost" onClick={goSignIn}>
              <Layers size={15} /> Sign In
            </button>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="cc-footer">
        <div className="cc-brand" style={{ fontSize: 15 }}>
          <span className="dot" /><span><span className="accent">GLTCH</span> RUNNER</span>
        </div>
        <span>© {new Date().getFullYear()} GLTCH Runner</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ShieldCheck size={12} /> 18+ ONLY · CONSENT ENFORCED</span>
      </footer>

      {/* Bottom ticker */}
      <div className="cc-ticker" aria-hidden>
        <div className="cc-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span className="cc-ticker-item" key={i}>
              <b>{t.b}</b> <span>{t.t}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
