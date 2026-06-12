import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowRight, Bot, Boxes, ChevronDown, CircuitBoard, Cpu, Eye,
  Film, Gauge, Globe, Layers, Lock, Play, Radio, ShieldCheck, Siren,
  Sparkles, Users, Wand2, Zap,
} from "lucide-react";
import "./commandCenter.css";

const GridCity = lazy(() => import("./GridCity"));

const SIGNUP = "/create?signup=1";
const RED = "hsl(0 88% 56%)";

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

/** Animated random-walk sparkline on a canvas. */
function Sparkline({ stroke = RED }: { stroke?: string }) {
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
  }, [stroke]);
  return <canvas ref={ref} className="cc-spark" />;
}

/* ──────────────────────────────────────────────────────────────────────────
   Static content
   ────────────────────────────────────────────────────────────────────────── */

const AGENTS = [
  { name: "PRISM", role: "Image Synthesis", img: "/landing/agent-prism.webp", stat: "412 ops/min // uptime 99.99%", desc: "Turns a prompt into cinematic, uncensored stills in seconds — no gatekeeping, no watered-down models." },
  { name: "REEL", role: "Video Render", img: "/landing/agent-reel.webp", stat: "38 clips queued // 4K upscale armed", desc: "Dispatches motion jobs across the GPU swarm and upscales the result to crisp, shareable clips." },
  { name: "ATLAS", role: "Grid Orchestration", img: "/landing/agent-atlas.webp", stat: "monitoring 7 districts // 24/7", desc: "Watches queue depth and latency, then auto-scales render nodes so your jobs never wait in line." },
  { name: "AEGIS", role: "Safety Layer", img: "/landing/agent-aegis.webp", stat: "0 breaches // guardrails active", desc: "Runs every output through guardrails — adult-but-consensual, with the hard lines enforced automatically." },
];

const FEATURES = [
  { icon: Wand2, title: "UNCENSORED MODELS", desc: "Generation without the corporate lobotomy. Real creative range for adult work." },
  { icon: Film, title: "IMAGE + VIDEO", desc: "Stills and motion from one console. Prompt, render, upscale, publish." },
  { icon: Users, title: "CREATOR ECONOMY", desc: "Follow models, unlock exclusive drops, and get paid out instantly when you build a following." },
  { icon: Bot, title: "PERSONA CHAT", desc: "Talk to AI personas that generate selfies and clips mid-conversation, on demand." },
  { icon: Zap, title: "DAILY CREDITS", desc: "Free credits every day plus referral boosts — start rendering without a card." },
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

const SERVICES_INIT = [
  { nm: "image-engine", k: "ok" as const },
  { nm: "video-engine", k: "ok" as const },
  { nm: "persona-chat", k: "ok" as const },
  { nm: "render-swarm", k: "ok" as const },
  { nm: "payouts", k: "warn" as const },
  { nm: "moderation", k: "ok" as const },
];

const TICKER = [
  { b: "GRID", t: "all districts reporting" },
  { b: "RENDER", t: "swarm at nominal load" },
  { b: "MODELS", t: "uncensored set online" },
  { b: "PAYOUTS", t: "instant rail active", r: true },
  { b: "CREATORS", t: "onboarding open" },
  { b: "CHAT", t: "personas responsive" },
  { b: "CREDITS", t: "daily drop armed" },
];

/** Camera choreography phases — mirrors the spline in GridCity.tsx. */
const PHASES = [
  { at: 0.0, n: "01", label: "OVERWATCH" },
  { at: 0.18, n: "02", label: "DESCENT" },
  { at: 0.42, n: "03", label: "STREET LEVEL" },
  { at: 0.62, n: "04", label: "PERIMETER SWEEP" },
  { at: 0.85, n: "05", label: "GRID OVERVIEW" },
];

/** One simulated autonomous incident: detection → triage → action → resolution. */
const INCIDENT_LINES = [
  { ts: "00:00.000", op: "SCAN", k: "", t: "sweep 4471 complete — 0 anomalies, 7 districts nominal" },
  { ts: "00:02.882", op: "DETECT", k: "detect", t: "district-07 latency p99 ↑ 412ms — threshold breached" },
  { ts: "00:02.901", op: "TRIAGE", k: "", t: "ATLAS correlates 3 signals → GPU node 22 thermal drift" },
  { ts: "00:03.130", op: "ACT", k: "act", t: "traffic rerouted // node 22 drained // spare node spun up" },
  { ts: "00:04.092", op: "RESOLVE", k: "resolve", t: "p99 back to 38ms — incident closed in 1.21s" },
];

const STATUS_LABEL: Record<string, string> = { ok: "ONLINE", warn: "DEGRADED", crit: "ALERT" };

function fmtClock(d: Date) {
  return d.toISOString().slice(11, 19);
}

/* ──────────────────────────────────────────────────────────────────────────
   HUD widgets
   ────────────────────────────────────────────────────────────────────────── */

/** Bottom-left mission-phase readout, synced to the 3D camera's scroll path. */
function MissionPhase() {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        setP(Math.min(1, Math.max(0, window.scrollY / max)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  const phase = [...PHASES].reverse().find((ph) => p >= ph.at) ?? PHASES[0];
  return (
    <div className="cc-phase" aria-hidden>
      <div className="ph">CAMERA // FLIGHT PATH</div>
      <div className="nm"><b>PHASE {phase.n}</b> {phase.label}</div>
      <div className="trackbar"><i style={{ width: `${Math.round(p * 100)}%` }} /></div>
    </div>
  );
}

/** Periodic autonomous-incident toast: anomaly detected → auto-resolved. */
function AlertToast() {
  const [stage, setStage] = useState<"idle" | "detect" | "resolved">("idle");
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let t1: number, t2: number, t3: number;
    const cycle = () => {
      setStage("detect");
      t1 = window.setTimeout(() => setStage("resolved"), 3600);
      t2 = window.setTimeout(() => setStage("idle"), 7200);
    };
    t3 = window.setTimeout(cycle, 9000);
    const i = setInterval(cycle, 26000);
    return () => { clearInterval(i); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);
  if (stage === "idle") return null;
  return stage === "detect" ? (
    <div className="cc-alert" role="status">
      <span className="led" />
      <span><span className="sig">ANOMALY</span> // district-07 latency spike — ATLAS dispatched</span>
    </div>
  ) : (
    <div className="cc-alert resolved" role="status">
      <span className="led" />
      <span><span className="sig">RESOLVED</span> // auto-mitigated in 1.21s — no human intervention</span>
    </div>
  );
}

/** Looping incident-playback terminal: the observability story, told live. */
function IncidentTerminal() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (setArmed(true), io.disconnect())),
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!armed) return;
    if (prefersReducedMotion()) { setStep(INCIDENT_LINES.length + 1); return; }
    const i = setInterval(() => {
      setStep((s) => (s >= INCIDENT_LINES.length + 3 ? 0 : s + 1));
    }, 1100);
    return () => clearInterval(i);
  }, [armed]);
  return (
    <div className="cc-term" ref={ref}>
      <div className="cc-term-bar">
        <span className="led" />
        <span>INCIDENT PLAYBACK // DISTRICT-07 // AUTONOMOUS RESPONSE LOG</span>
      </div>
      <div className="cc-term-body">
        {INCIDENT_LINES.slice(0, step).map((l) => (
          <div className={`cc-term-line ${l.k}`} key={l.op + l.ts}>
            <span className="ts">{l.ts}</span>
            <span className="op">{l.op}</span>
            <span>{l.t}</span>
          </div>
        ))}
        {step > INCIDENT_LINES.length && (
          <div className="cc-term-stamp">NO HUMAN INTERVENTION REQUIRED</div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Main component
   ────────────────────────────────────────────────────────────────────────── */

export default function CommandCenterLanding() {
  const navigate = useNavigate();
  const go = () => navigate(SIGNUP);

  const [clock, setClock] = useState(() => new Date());
  const [tele, setTele] = useState({ load: 62, queue: 14, latency: 38, nodes: 28 });
  const [services, setServices] = useState(SERVICES_INIT);
  const [feed, setFeed] = useState<{ id: number; ts: string; a: string; t: string; alert?: boolean }[]>([]);
  const feedId = useRef(0);

  // Master clock
  useEffect(() => {
    const i = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Telemetry random-walk + occasional service status flips
  useEffect(() => {
    const i = setInterval(() => {
      setTele((p) => ({
        load: Math.min(96, Math.max(34, Math.round(p.load + (Math.random() - 0.5) * 11))),
        queue: Math.min(48, Math.max(2, Math.round(p.queue + (Math.random() - 0.5) * 7))),
        latency: Math.min(120, Math.max(18, Math.round(p.latency + (Math.random() - 0.5) * 14))),
        nodes: Math.min(40, Math.max(18, Math.round(p.nodes + (Math.random() - 0.5) * 2))),
      }));
      if (Math.random() > 0.78) {
        setServices((prev) =>
          prev.map((s) => {
            if (s.nm === "payouts") return s; // keep the standing "degraded" flavor
            const roll = Math.random();
            return { ...s, k: roll > 0.94 ? "warn" : "ok" };
          })
        );
      }
    }, 1600);
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
          <span><span className="accent">GLTCH</span>RUNNER</span>
          <span className="sub">// MISSION CONTROL</span>
        </div>
        <div className="cc-statuschips">
          <span className="cc-chip"><span className="led" />SYSTEMS NOMINAL</span>
          <span className="cc-chip" style={{ fontVariantNumeric: "tabular-nums" }}><Radio size={11} />{clockStr} UTC</span>
          <button className="cc-btn cc-btn-primary" style={{ padding: "9px 18px", fontSize: 11 }} onClick={go}>
            SIGN UP <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* Autonomous incident toast */}
      <AlertToast />

      {/* Floating HUD rails (desktop) */}
      <aside className="cc-rail left cc-content" aria-hidden>
        <div className="cc-panel" style={{ marginBottom: 16 }}>
          <div className="cc-panel-head"><span>GRID TELEMETRY</span><Gauge size={12} /></div>
          <div className="cc-panel-body">
            <div className="cc-metric"><span className="label">Grid Load</span><span className={`value ${tele.load > 88 ? "red" : ""}`}>{tele.load}%</span></div>
            <div className="cc-metric"><span className="label">Render Queue</span><span className="value">{tele.queue}</span></div>
            <div className="cc-metric"><span className="label">Avg Latency</span><span className="value">{tele.latency}ms</span></div>
            <div className="cc-metric"><span className="label">GPU Nodes</span><span className="value">{tele.nodes}</span></div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 9, letterSpacing: "0.12em", color: "hsl(220 8% 62% / 0.8)", marginBottom: 4 }}>THROUGHPUT // renders/s</div>
              <Sparkline />
            </div>
          </div>
        </div>
        <div className="cc-panel">
          <div className="cc-panel-head"><span>SUBSYSTEMS</span><CircuitBoard size={12} /></div>
          <div className="cc-panel-body">
            {services.map((s) => (
              <div className="cc-svc" key={s.nm}>
                <span className={`led ${s.k}`} />
                <span className="nm">{s.nm}</span>
                <span className={`st ${s.k}`}>{STATUS_LABEL[s.k]}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

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
            <div style={{ display: "flex", alignItems: "center", marginTop: 8, fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: "hsl(0 88% 56% / 0.8)" }}>
              <span>autonomous agents</span><span className="cc-caret">&nbsp;</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mission phase readout (tracks the scroll-driven camera) */}
      <MissionPhase />

      {/* HERO */}
      <section className="cc-hero cc-content">
        <span className="cc-eyebrow">Autonomous Monitoring Network</span>
        <h1 className="cc-title">
          <span className="hollow">COMMAND</span> THE{" "}
          <span className="cc-glitch g" data-text="GRID">GRID</span>
        </h1>
        <p className="cc-subtitle">
          GLTCHRunner is mission control for uncensored AI. A living city of render nodes,
          patrolled by autonomous agents that detect, triage and resolve before you ever feel it.
          You create — the grid takes care of the rest.
        </p>
        <div className="cc-cta-row">
          <button className="cc-btn cc-btn-primary" onClick={go}>
            <Zap size={16} /> Deploy First Render
          </button>
          <button
            className="cc-btn cc-btn-ghost"
            onClick={() => document.getElementById("cc-grid-sec")?.scrollIntoView({ behavior: "smooth" })}
          >
            <Play size={15} /> Begin Descent
          </button>
        </div>
        <div className="cc-hero-meta">
          <span><b>◇</b> No card required</span>
          <span><b>◇</b> Free daily credits</span>
          <span><b>◇</b> Instant creator payouts</span>
        </div>
        <div className="cc-scroll-hint">
          <span>SCROLL TO DESCEND</span>
          <ChevronDown size={16} />
        </div>
      </section>

      {/* SECTION — the living grid */}
      <section className="cc-section cc-section-bg" id="cc-grid-sec">
        <Reveal>
          <div className="cc-kicker">Live Observability</div>
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
            { ic: Activity, h: "Packets = live jobs", p: "Each glow is a render in motion — image synthesis, video, persona media — flowing in real time." },
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

      {/* SECTION — autonomous incident response */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-kicker"><Siren size={13} /> Autonomous Response</div>
          <h2 className="cc-h2">Incidents that <span className="g">resolve themselves</span></h2>
          <p className="cc-lead">
            The grid doesn't page a human at 3am. It detects the anomaly, isolates the cause,
            reroutes the load and closes the incident — in about the time it took you to read
            this sentence. Watch a real playback:
          </p>
        </Reveal>
        <Reveal><IncidentTerminal /></Reveal>
      </section>

      {/* SECTION — autonomous render swarm */}
      <section className="cc-section cc-section-bg">
        <Reveal>
          <div className="cc-kicker">The Sentinels</div>
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
                <div className="head">
                  <img className="core" src={a.img} alt="" loading="lazy" width={64} height={64} />
                  <div>
                    <div className="role">{a.role}</div>
                    <div className="name">{a.name}</div>
                    <div className="stat"><b>▣</b> {a.stat}</div>
                  </div>
                </div>
                <p style={{ marginTop: 14 }}>{a.desc}</p>
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
            <div className="cc-stat"><div className="n"><CountUp to={6} prefix="<" suffix="s" /></div><div className="l">Avg render</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={100} suffix="%" /></div><div className="l">Uncensored</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={24} /><span className="u">/7</span></div><div className="l">Autonomous watch</div></div>
            <div className="cc-stat"><div className="n"><CountUp to={1.21} suffix="s" decimals={2} /></div><div className="l">Auto-mitigation</div></div>
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
            Free to start. Free credits daily. No limits on your imagination — just hit deploy.
          </p>
          <div className="cc-cta-row" style={{ justifyContent: "center" }}>
            <button className="cc-btn cc-btn-primary" onClick={go}>
              <Zap size={16} /> Create Free Account
            </button>
            <button className="cc-btn cc-btn-ghost" onClick={go}>
              <Layers size={15} /> Sign In
            </button>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="cc-footer">
        <div className="cc-brand" style={{ fontSize: 15 }}>
          <span className="dot" /><span><span className="accent">GLTCH</span>RUNNER</span>
        </div>
        <span>© {new Date().getFullYear()} GLTCHRUNNER // ALL DISTRICTS OPERATIONAL</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ShieldCheck size={12} /> 18+ ONLY · CONSENT ENFORCED</span>
      </footer>

      {/* Bottom ticker */}
      <div className="cc-ticker" aria-hidden>
        <div className="cc-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span className="cc-ticker-item" key={i}>
              <b>{t.b}</b> <span className={t.r ? "r" : ""}>{t.t}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
