"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Tone = "mint" | "rose" | "cyan" | "violet";

const toneClass: Record<Tone, string> = {
  mint: "text-mint",
  rose: "text-rose",
  cyan: "text-neon",
  violet: "text-violet",
};

export function ProbabilityRing({ value, tone }: { value: number; tone: Tone }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div className={cn("relative grid size-12 shrink-0 place-items-center", toneClass[tone])}>
      <svg viewBox="0 0 40 40" className="size-12 -rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute font-mono text-[10px] text-ink">{Math.round(value * 100)}</span>
    </div>
  );
}
