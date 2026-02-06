import React, { useState, useEffect } from "react";

interface GlitchTextProps {
  text: string;
  className?: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  glitchIntensity?: "low" | "medium" | "high";
}

const GlitchText: React.FC<GlitchTextProps> = ({
  text,
  className = "",
  as: Tag = "span",
  glitchIntensity = "medium",
}) => {
  const [isGlitching, setIsGlitching] = useState(false);

  useEffect(() => {
    const intervals = { low: 8000, medium: 4000, high: 2000 };
    const interval = setInterval(() => {
      setIsGlitching(true);
      setTimeout(() => setIsGlitching(false), 200);
    }, intervals[glitchIntensity] + Math.random() * 2000);

    return () => clearInterval(interval);
  }, [glitchIntensity]);

  return (
    <Tag className={`relative inline-block ${className}`}>
      <span className="relative z-10">{text}</span>
      {isGlitching && (
        <>
          <span
            className="absolute inset-0 z-20"
            style={{
              color: "hsl(180 100% 50%)",
              clipPath: "inset(20% 0 60% 0)",
              transform: "translateX(-2px)",
              opacity: 0.8,
            }}
            aria-hidden
          >
            {text}
          </span>
          <span
            className="absolute inset-0 z-20"
            style={{
              color: "hsl(300 100% 60%)",
              clipPath: "inset(50% 0 20% 0)",
              transform: "translateX(2px)",
              opacity: 0.8,
            }}
            aria-hidden
          >
            {text}
          </span>
        </>
      )}
    </Tag>
  );
};

export default GlitchText;
