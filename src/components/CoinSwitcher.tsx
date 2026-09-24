"use client";

import { motion } from "framer-motion";

import { SYMBOLS, baseAsset, type Symbol } from "@/lib/market/types";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export function CoinSwitcher() {
  const symbol = useDesk((state) => state.symbol);
  const setSymbol = useDesk((state) => state.setSymbol);

  return (
    <div className="flex items-center rounded-full border border-white/10 bg-black/40 p-1" role="tablist" aria-label="Symbol">
      {SYMBOLS.map((item) => {
        const active = item === symbol;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setSymbol(item)}
            className={cn(
              "relative rounded-full px-4 py-1.5 font-mono text-xs tracking-[0.16em]",
              active ? "text-[#041018]" : "text-white/55 hover:text-white",
            )}
          >
            {active ? (
              <motion.span
                layoutId="active-coin"
                className="absolute inset-0 rounded-full bg-neon shadow-[0_0_24px_rgba(92,225,255,0.55)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative">{label(item)}</span>
          </button>
        );
      })}
    </div>
  );
}

function label(symbol: Symbol): string {
  return baseAsset(symbol);
}
