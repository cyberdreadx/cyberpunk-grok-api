import React, { useEffect, useState, useCallback } from "react";

interface DataRainProps {
  intensity?: number;
}

const CHARS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";

interface Drop {
  id: number;
  x: number;
  speed: number;
  chars: string[];
  opacity: number;
  delay: number;
}

const DataRain: React.FC<DataRainProps> = ({ intensity = 20 }) => {
  const [drops, setDrops] = useState<Drop[]>([]);

  const generateDrop = useCallback((id: number): Drop => {
    const charCount = 5 + Math.floor(Math.random() * 15);
    const chars = Array.from({ length: charCount }, () =>
      CHARS[Math.floor(Math.random() * CHARS.length)]
    );
    return {
      id,
      x: Math.random() * 100,
      speed: 8 + Math.random() * 20,
      chars,
      opacity: 0.05 + Math.random() * 0.15,
      delay: Math.random() * 10,
    };
  }, []);

  useEffect(() => {
    setDrops(Array.from({ length: intensity }, (_, i) => generateDrop(i)));
  }, [intensity, generateDrop]);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[5]">
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="absolute top-0 font-mono-share text-[10px] leading-tight"
          style={{
            left: `${drop.x}%`,
            opacity: drop.opacity,
            color: "hsl(180 100% 50%)",
            animation: `data-rain-fall ${drop.speed}s linear ${drop.delay}s infinite`,
            writingMode: "vertical-rl",
            textOrientation: "upright",
          }}
        >
          {drop.chars.map((char, i) => (
            <span
              key={i}
              style={{
                opacity: 1 - i / drop.chars.length,
                animationDelay: `${i * 0.1}s`,
              }}
            >
              {char}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

export default DataRain;
