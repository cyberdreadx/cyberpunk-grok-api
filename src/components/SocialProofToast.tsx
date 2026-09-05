import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";

const NAMES = [
  "Alex", "Jordan", "Sam", "Riley", "Casey", "Morgan", "Taylor", "Jamie",
  "Quinn", "Avery", "Blake", "Drew", "Reese", "Sage", "Phoenix", "Dakota",
  "Harper", "Emery", "Rowan", "Skyler", "Kai", "Noor", "Yuki", "Luca",
];

const PRIZES = [
  { credits: 1, weight: 50 },
  { credits: 2, weight: 30 },
  { credits: 3, weight: 12 },
  { credits: 5, weight: 5 },
  { credits: 10, weight: 2 },
  { credits: 25, weight: 1 },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickPrize(): number {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of PRIZES) {
    r -= p.weight;
    if (r <= 0) return p.credits;
  }
  return 1;
}

function timeAgo(): string {
  const s = Math.floor(Math.random() * 55) + 5;
  return s < 60 ? `${s}s ago` : "just now";
}

export default function SocialProofToast() {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState({ name: "", credits: 0, time: "" });

  useEffect(() => {
    // Initial delay 8-15s, then every 20-40s
    const initialDelay = 8000 + Math.random() * 7000;

    const show = () => {
      setData({
        name: pickRandom(NAMES),
        credits: pickPrize(),
        time: timeAgo(),
      });
      setVisible(true);
      setTimeout(() => setVisible(false), 4000);
    };

    const t1 = setTimeout(() => {
      show();
      const interval = setInterval(show, 20000 + Math.random() * 20000);
      return () => clearInterval(interval);
    }, initialDelay);

    return () => clearTimeout(t1);
  }, []);

  if (!visible) return null;

  const isJackpot = data.credits >= 10;

  return (
    <div
      className="fixed bottom-20 left-3 z-50 animate-in slide-in-from-left-full duration-500 max-w-[260px]"
      style={{ animationFillMode: "both" }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-primary/20 bg-background/95 backdrop-blur-md shadow-glow-live">
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isJackpot ? "bg-yellow-500/20" : "bg-primary/15"}`}>
          {isJackpot ? (
            <Sparkles className="w-4 h-4 text-yellow-400" />
          ) : (
            <Gift className="w-4 h-4 text-primary" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-mono-share text-[11px] text-foreground/90 truncate">
            <span className="font-bold text-primary">{data.name}</span>
            {" won "}
            <span className={`font-bold ${isJackpot ? "text-yellow-400" : "neon-text-cyan"}`}>
              {data.credits} credit{data.credits !== 1 ? "s" : ""}
            </span>
            {isJackpot && " 🎉"}
          </p>
          <p className="font-mono-share text-[9px] text-muted-foreground/50">
            {data.time} • Daily Spin
          </p>
        </div>
      </div>
    </div>
  );
}
