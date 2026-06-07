/**
 * TerminalMode — full hacker shell over the existing API.
 *
 * Visual: Matrix data-rain background + translucent CRT terminal pane on top
 * with scanlines, blinking caret, and green-on-black-with-neon-accents text.
 *
 * Commands are parsed locally and dispatched to the existing /api endpoints
 * via apiFetch. Output is appended to a scrollback buffer; arrow keys page
 * through history; tab autocompletes.
 *
 * SECURITY NOTE: All inputs are routed through the same authenticated API
 * surface used by the rest of the app — the terminal is just a different UI.
 * No raw eval, no shell-out — only a fixed allow-list of commands below.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import DataRain from "@/components/DataRain";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch, calculateCreditCost, type CreditMode } from "@/lib/api";

// -------------------------------------------------------------------------
// Types & helpers
// -------------------------------------------------------------------------
type LineKind = "input" | "output" | "error" | "system" | "success" | "ascii";
interface Line {
  id: number;
  kind: LineKind;
  text: string;
  // Optional rich payload (clickable URL/image)
  url?: string;
  isImage?: boolean;
  isVideo?: boolean;
}

let _lineId = 0;
const nextId = () => ++_lineId;

const PROMPT_USER = (email?: string | null) =>
  email ? email.split("@")[0] : "guest";

/**
 * Tokenize a command line preserving quoted strings.
 * Example: gen "a cyberpunk cat" --engine gltch --n 4
 */
function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Parse `--key value` and `--flag` pairs out of the token list, returning rest + opts. */
function parseFlags(tokens: string[]): { args: string[]; opts: Record<string, string | boolean> } {
  const args: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      args.push(t);
    }
  }
  return { args, opts };
}

// -------------------------------------------------------------------------
// Command registry
// -------------------------------------------------------------------------
interface CommandCtx {
  print: (text: string, kind?: LineKind, extra?: Partial<Line>) => void;
  printLines: (texts: string[], kind?: LineKind) => void;
  clear: () => void;
  navigate: ReturnType<typeof useNavigate>;
  auth: ReturnType<typeof useAuth>;
}

interface CommandSpec {
  name: string;
  usage: string;
  desc: string;
  needsAuth?: boolean;
  run: (args: string[], opts: Record<string, string | boolean>, ctx: CommandCtx) => Promise<void> | void;
}

const COMMANDS: CommandSpec[] = [
  {
    name: "help",
    usage: "help [command]",
    desc: "List commands or show details on one",
    run: (args, _opts, { print, printLines }) => {
      if (args[0]) {
        const c = COMMANDS.find((x) => x.name === args[0]);
        if (!c) return print(`unknown command: ${args[0]}`, "error");
        printLines([`${c.name} — ${c.desc}`, `  usage: ${c.usage}`], "output");
        return;
      }
      printLines(
        [
          "available commands:",
          ...COMMANDS.map((c) => `  ${c.name.padEnd(14)} ${c.desc}`),
          "",
          "tips: ↑/↓ history · TAB complete · ctrl+l clear · type `help <cmd>`",
        ],
        "output"
      );
    },
  },
  {
    name: "clear",
    usage: "clear",
    desc: "Clear the screen (alias: cls)",
    run: (_a, _o, { clear }) => clear(),
  },
  {
    name: "cls",
    usage: "cls",
    desc: "alias of clear",
    run: (_a, _o, { clear }) => clear(),
  },
  {
    name: "whoami",
    usage: "whoami",
    desc: "Show the current user + posting/karma status",
    run: async (_a, _o, { print, printLines, auth }) => {
      if (!auth.isAuthenticated) return print("not logged in — `login <email>` to start", "system");
      const u = auth.user;
      printLines(
        [
          `email           ${u?.email}`,
          `verified        ${u?.email_verified ? "yes" : "no"}`,
          `admin           ${u?.is_admin ? "yes" : "no"}`,
          `karma           ${u?.posting?.karma ?? 0} / ${u?.posting?.karma_threshold ?? "?"}`,
          `can_post        ${u?.posting?.can_post ? "yes" : "no"}`,
        ],
        "output"
      );
    },
  },
  {
    name: "credits",
    usage: "credits",
    desc: "Show credit balance",
    needsAuth: true,
    run: async (_a, _o, { print, auth }) => {
      try {
        const data = await apiFetch<any>("/credits");
        print(
          `subscription: ${data.sub_credits ?? 0}   pack: ${data.pack_credits ?? 0}   total: ${(data.sub_credits ?? 0) + (data.pack_credits ?? 0)}`,
          "success"
        );
      } catch (err: any) {
        print(`credits failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "karma",
    usage: "karma",
    desc: "Show karma + posting unlock progress",
    needsAuth: true,
    run: async (_a, _o, { printLines, auth }) => {
      await auth.refreshUser?.();
      const p = auth.user?.posting;
      if (!p) return printLines(["no karma data"], "error");
      const bar =
        "[" +
        "█".repeat(Math.floor((p.karma / Math.max(1, p.karma_threshold)) * 20)).padEnd(20, "·") +
        "]";
      printLines(
        [
          `karma     ${p.karma} / ${p.karma_threshold}`,
          `progress  ${bar}`,
          `email_ok  ${p.email_verified ? "yes" : "no"}`,
          `age_hrs   ${p.account_age_hours} / ${p.min_account_age_hours}`,
          `unlocked  ${p.can_post ? "✔ yes — you can post" : "✘ not yet"}`,
        ],
        "output"
      );
    },
  },
  {
    name: "login",
    usage: "login <email> <password>",
    desc: "Sign in with email + password",
    run: async (args, _o, { print, auth }) => {
      const [email, password] = args;
      if (!email || !password) return print("usage: login <email> <password>", "error");
      try {
        await auth.signIn(email, password);
        print(`signed in as ${email}`, "success");
      } catch (err: any) {
        print(`login failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "logout",
    usage: "logout",
    desc: "Sign out",
    run: async (_a, _o, { print, auth }) => {
      await auth.signOut();
      print("session terminated.", "system");
    },
  },
  {
    name: "gen",
    usage: 'gen "<prompt>" [--n 1-4] [--ratio 1:1|16:9|9:16] [--pro]',
    desc: "Generate images from a text prompt (GLTCH engine)",
    needsAuth: true,
    run: async (args, opts, { print, auth }) => {
      const prompt = args.join(" ").trim();
      if (!prompt) return print('usage: gen "<prompt>"', "error");
      const n = Math.min(4, Math.max(1, parseInt(String(opts.n || "1"), 10)));
      const ratio = String(opts.ratio || "1:1");
      const pro = !!opts.pro;
      const cost = calculateCreditCost(pro ? "text-to-image-pro" : "text-to-image", n);
      print(`▸ dispatching ${n}× image · ratio=${ratio}${pro ? " · PRO" : ""} · cost=${cost}cr`, "system");

      try {
        const data = await apiFetch<any>("/generate", {
          method: "POST",
          body: {
            action: "generate-image",
            prompt,
            n,
            aspect_ratio: ratio,
            ...(pro ? { model: "grok-imagine-image-pro" } : {}),
          },
        });
        const images: string[] = (data?.data || data?.images || []).map(
          (x: any) => x?.url || x?.b64_json && `data:image/png;base64,${x.b64_json}` || x
        );
        if (!images.length) return print("no images returned", "error");
        images.forEach((url, i) => print(`[img ${i + 1}] ${url}`, "ascii", { url, isImage: true }));
        print(`✔ done · ${images.length} image(s) ready`, "success");
        await auth.refreshUser?.();
      } catch (err: any) {
        print(`gen failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "edit",
    usage: 'edit <image_url> "<prompt>"',
    desc: "Edit an existing image (GLTCH engine)",
    needsAuth: true,
    run: async (args, _o, { print, auth }) => {
      const [url, ...rest] = args;
      const prompt = rest.join(" ").trim();
      if (!url || !prompt) return print('usage: edit <image_url> "<prompt>"', "error");
      const cost = calculateCreditCost("edit-image", 1);
      print(`▸ editing image · cost=${cost}cr`, "system");
      try {
        const data = await apiFetch<any>("/generate", {
          method: "POST",
          body: { action: "edit-image", prompt, image_url: url, n: 1 },
        });
        const out = (data?.data || data?.images || [])[0];
        const outUrl = out?.url || (out?.b64_json && `data:image/png;base64,${out.b64_json}`) || out;
        if (outUrl) print(`[edit] ${outUrl}`, "ascii", { url: outUrl, isImage: true });
        print("✔ edit complete", "success");
        await auth.refreshUser?.();
      } catch (err: any) {
        print(`edit failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "animate",
    usage: 'animate <image_url> ["<motion prompt>"] [--seconds 5]',
    desc: "Image → video (GLTCH engine)",
    needsAuth: true,
    run: async (args, opts, { print, auth }) => {
      const [url, ...rest] = args;
      const prompt = rest.join(" ").trim() || "smooth cinematic motion";
      const seconds = Math.min(15, Math.max(1, parseInt(String(opts.seconds || "5"), 10)));
      if (!url) return print("usage: animate <image_url>", "error");
      const cost = calculateCreditCost("image-to-video", 1, seconds);
      print(`▸ animating · ${seconds}s · cost=${cost}cr — this may take a minute`, "system");
      try {
        const data = await apiFetch<any>("/generate", {
          method: "POST",
          body: { action: "generate-video", prompt, image_url: url, duration_seconds: seconds },
        });
        const v = (data?.data || data?.videos || [])[0];
        const vurl = v?.url || v;
        if (vurl) print(`[video] ${vurl}`, "ascii", { url: vurl, isVideo: true });
        print("✔ render complete", "success");
        await auth.refreshUser?.();
      } catch (err: any) {
        print(`animate failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "feed",
    usage: "feed [--sort hot|new|top] [--limit 10]",
    desc: "List the latest community posts",
    run: async (_a, opts, { print, printLines }) => {
      const sort = String(opts.sort || "new");
      const limit = Math.min(50, Math.max(1, parseInt(String(opts.limit || "10"), 10)));
      try {
        const data = await apiFetch<any>(`/feed?sort=${sort}&limit=${limit}`, { auth: false });
        const posts: any[] = data.posts || [];
        if (!posts.length) return print("feed empty", "system");
        const rows = posts.map((p, i) => {
          const u = p.username || "anon";
          const score = (p.upvotes ?? 0) - (p.downvotes ?? 0);
          const txt = (p.text || "").replace(/\s+/g, " ").slice(0, 60);
          return `${String(i + 1).padStart(2, " ")}. ▲${String(score).padStart(3, " ")}  @${u.padEnd(14, " ")}  ${txt}`;
        });
        printLines([`feed · sort=${sort} · ${posts.length} posts`, ...rows], "output");
      } catch (err: any) {
        print(`feed failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "stories",
    usage: "stories",
    desc: "List active 24h stories",
    run: async (_a, _o, { print, printLines }) => {
      try {
        const data = await apiFetch<any>("/stories", { auth: false });
        const users: any[] = data.users || data || [];
        if (!users.length) return print("no active stories", "system");
        const rows = users.map(
          (u: any, i: number) => `${String(i + 1).padStart(2, " ")}. @${(u.username || "anon").padEnd(16, " ")}  ${u.stories?.length ?? 0} story`
        );
        printLines(["active stories:", ...rows], "output");
      } catch (err: any) {
        print(`stories failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "post",
    usage: 'post "<text>" [--image <url>]',
    desc: "Post to the community feed",
    needsAuth: true,
    run: async (args, opts, { print, auth }) => {
      const text = args.join(" ").trim();
      const image = opts.image ? String(opts.image) : undefined;
      if (!text && !image) return print('usage: post "<text>" [--image <url>]', "error");
      try {
        await apiFetch("/feed", { method: "POST", body: { text, imageUrl: image } });
        print("✔ posted to feed", "success");
        await auth.refreshUser?.();
      } catch (err: any) {
        print(`post failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "notifications",
    usage: "notifications",
    desc: "Show recent notifications",
    needsAuth: true,
    run: async (_a, _o, { print, printLines }) => {
      try {
        const data = await apiFetch<any>("/notifications");
        const items: any[] = data.notifications || data || [];
        if (!items.length) return print("inbox is empty", "system");
        const rows = items
          .slice(0, 20)
          .map((n: any, i: number) => `${String(i + 1).padStart(2, " ")}. ${n.read ? " " : "●"} ${n.type?.padEnd(14, " ") || ""} ${n.message || ""}`);
        printLines([`inbox · ${items.length} total`, ...rows], "output");
      } catch (err: any) {
        print(`notifications failed: ${err.message}`, "error");
      }
    },
  },
  {
    name: "open",
    usage: "open <route>",
    desc: "Navigate to a route (e.g. /create, /feed, /library, /admin)",
    run: (args, _o, { print, navigate }) => {
      const path = args[0];
      if (!path) return print("usage: open <route>", "error");
      navigate(path.startsWith("/") ? path : `/${path}`);
      print(`→ navigating to ${path}`, "system");
    },
  },
  {
    name: "echo",
    usage: "echo <text>",
    desc: "Print text",
    run: (args, _o, { print }) => print(args.join(" "), "output"),
  },
  {
    name: "exit",
    usage: "exit",
    desc: "Leave terminal mode",
    run: (_a, _o, { navigate }) => navigate("/create"),
  },
];

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------
const BANNER = [
  "╔══════════════════════════════════════════════════════════╗",
  "║  GLTCH // TERMINAL  ·  v1.0  ·  unauthorized access logged ║",
  "║  type `help` for commands · `exit` returns to GUI         ║",
  "╚══════════════════════════════════════════════════════════╝",
];

const TerminalMode: React.FC = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const print = useCallback((text: string, kind: LineKind = "output", extra?: Partial<Line>) => {
    setLines((prev) => [...prev, { id: nextId(), kind, text, ...extra }]);
  }, []);
  const printLines = useCallback((texts: string[], kind: LineKind = "output") => {
    setLines((prev) => [
      ...prev,
      ...texts.map((t) => ({ id: nextId(), kind, text: t })),
    ]);
  }, []);
  const clear = useCallback(() => setLines([]), []);

  // Boot banner
  useEffect(() => {
    printLines(BANNER, "system");
    print(`session: ${auth.user?.email ? "authenticated as " + auth.user.email : "guest (login to use most commands)"}`, "system");
    print("", "output");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  // Keep input focused
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener("click", focus);
    return () => window.removeEventListener("click", focus);
  }, []);

  const ctx: CommandCtx = useMemo(
    () => ({ print, printLines, clear, navigate, auth }),
    [print, printLines, clear, navigate, auth]
  );

  const runCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const tokens = tokenize(trimmed);
      const name = tokens[0]?.toLowerCase();
      const cmd = COMMANDS.find((c) => c.name === name);
      print(`${PROMPT_USER(auth.user?.email)}@gltch:~$ ${trimmed}`, "input");
      if (!cmd) {
        print(`command not found: ${name} — try \`help\``, "error");
        return;
      }
      if (cmd.needsAuth && !auth.isAuthenticated) {
        print("authentication required — `login <email> <password>`", "error");
        return;
      }
      const { args, opts } = parseFlags(tokens.slice(1));
      setBusy(true);
      try {
        await cmd.run(args, opts, ctx);
      } catch (err: any) {
        print(`runtime error: ${err.message || err}`, "error");
      } finally {
        setBusy(false);
      }
    },
    [auth, ctx, print]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Ctrl+L clears
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clear();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const v = input;
      if (v.trim()) {
        setHistory((h) => [...h, v]);
      }
      setHistIdx(null);
      setInput("");
      runCommand(v);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setInput(history[next] || "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(null);
        setInput("");
      } else {
        setHistIdx(next);
        setInput(history[next]);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const tokens = tokenize(input);
      if (tokens.length <= 1) {
        const prefix = tokens[0] || "";
        const matches = COMMANDS.filter((c) => c.name.startsWith(prefix));
        if (matches.length === 1) setInput(matches[0].name + " ");
        else if (matches.length > 1) printLines([matches.map((m) => m.name).join("  ")], "output");
      }
    }
  };

  return (
    <div
      className={`relative bg-black text-foreground ${
        fullscreen ? "fixed inset-0 z-50" : "min-h-[100dvh]"
      }`}
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
    >
      {/* Layer 1: Matrix data rain */}
      <div className="absolute inset-0 opacity-60">
        <DataRain intensity={30} />
      </div>

      {/* Layer 2: scanlines overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "repeating-linear-gradient(0deg, hsl(var(--primary) / 0.04) 0px, hsl(var(--primary) / 0.04) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "overlay",
        }}
      />
      {/* CRT vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {/* Layer 3: terminal pane */}
      <div className="relative z-20 mx-auto flex min-h-[100dvh] max-w-5xl flex-col p-3 sm:p-6">
        {/* Header chrome */}
        <div className="mb-2 flex items-center justify-between rounded-t border border-primary/30 bg-card/80 px-3 py-1.5 backdrop-blur">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
            <span className="ml-3 font-mono-share text-[10px] tracking-widest text-primary/80">
              GLTCH // TERMINAL — {auth.user?.email || "guest"}@local
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFullscreen((v) => !v)}
              className="text-primary/60 hover:text-primary"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <Link
              to="/create"
              className="flex items-center gap-1 font-mono-share text-[10px] text-primary/60 hover:text-primary"
            >
              <ArrowLeft className="h-3 w-3" /> EXIT
            </Link>
          </div>
        </div>

        {/* Scrollback */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-b border border-t-0 border-primary/30 bg-black/85 p-3 sm:p-4 backdrop-blur"
          style={{ minHeight: "60dvh" }}
        >
          {lines.map((l) => (
            <TerminalLine key={l.id} line={l} />
          ))}
          {busy && (
            <div className="font-mono-share text-[12px] text-primary/70">
              <span className="animate-pulse">▌ working…</span>
            </div>
          )}

          {/* Active prompt */}
          <div className="mt-1 flex items-center gap-2 font-mono-share text-[12px] text-primary">
            <span className="text-secondary">{PROMPT_USER(auth.user?.email)}@gltch</span>
            <span className="text-muted-foreground">:~$</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              className="flex-1 bg-transparent text-primary outline-none caret-primary"
              aria-label="terminal input"
            />
            <span className="h-3 w-2 animate-pulse bg-primary/80" />
          </div>
        </div>

        {/* Footer hint strip */}
        <div className="mt-2 flex flex-wrap items-center gap-3 px-1 font-mono-share text-[9px] text-primary/40">
          <span>↑↓ history</span>
          <span>TAB complete</span>
          <span>CTRL+L clear</span>
          <span>type `help`</span>
        </div>
      </div>
    </div>
  );
};

// -------------------------------------------------------------------------
// Single line renderer — handles plain output, links, and inline media.
// -------------------------------------------------------------------------
const TerminalLine: React.FC<{ line: Line }> = ({ line }) => {
  const color =
    line.kind === "input"
      ? "text-primary"
      : line.kind === "error"
        ? "text-destructive"
        : line.kind === "success"
          ? "text-green-400"
          : line.kind === "system"
            ? "text-secondary/80"
            : line.kind === "ascii"
              ? "text-primary/90"
              : "text-foreground/80";

  return (
    <div className={`whitespace-pre-wrap break-words font-mono-share text-[12px] leading-relaxed ${color}`}>
      {line.url ? (
        <a href={line.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-primary">
          {line.text}
        </a>
      ) : (
        line.text
      )}
      {line.isImage && line.url && (
        <div className="my-1 max-w-xs border border-primary/30 p-0.5">
          <img src={line.url} alt="" loading="lazy" className="block w-full" />
        </div>
      )}
      {line.isVideo && line.url && (
        <div className="my-1 max-w-xs border border-primary/30 p-0.5">
          <video src={line.url} controls playsInline muted className="block w-full" />
        </div>
      )}
    </div>
  );
};

export default TerminalMode;
