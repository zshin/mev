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
      className="flex h-8 items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] pr-1 pl-3 transition-colors hover:bg-white/[0.05]"
    >
      <span className={cn("text-[13px] font-medium tracking-tight", enabled ? "text-zinc-100" : "text-zinc-400")}>
        {enabled ? "Jev on" : "Jev off"}
      </span>
      <span className="relative h-6 w-10 rounded-full bg-black/40">
        <motion.span
          className={cn("absolute top-0.5 size-5 rounded-full", enabled ? "bg-white" : "bg-zinc-500")}
          animate={{ left: enabled ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 520, damping: 36 }}
        />
      </span>
    </button>
  );
}
