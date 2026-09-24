"use client";

import { motion } from "framer-motion";

import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export function JevToggle() {
  const enabled = useDesk((state) => state.jevEnabled);
  const setJevEnabled = useDesk((state) => state.setJevEnabled);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => setJevEnabled(!enabled)}
      className={cn(
        "relative h-11 w-[168px] rounded-full border transition-colors",
        enabled
          ? "border-neon/50 bg-neon/10 shadow-[0_0_28px_rgba(92,225,255,0.28)]"
          : "border-white/10 bg-white/5",
      )}
    >
      <motion.span
        className={cn("absolute top-1.5 size-8 rounded-full", enabled ? "bg-neon shadow-[0_0_16px_rgba(92,225,255,0.8)]" : "bg-zinc-500")}
        animate={{ left: enabled ? 130 : 6 }}
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
      />
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 font-mono text-[11px] tracking-[0.22em]",
          enabled ? "left-4 text-neon" : "right-4 text-white/70",
        )}
      >
        {enabled ? "JEV ON" : "JEV OFF"}
      </span>
    </button>
  );
}
