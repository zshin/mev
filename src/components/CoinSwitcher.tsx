"use client";

import { motion } from "framer-motion";

import { SYMBOLS, baseAsset, type Symbol } from "@/lib/market/types";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export function CoinSwitcher() {
  const symbol = useDesk((state) => state.symbol);
  const setSymbol = useDesk((state) => state.setSymbol);

  return (
    <div
      className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5"
      role="tablist"
      aria-label="Symbol"
    >
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
              "relative rounded-full px-3 py-1 text-[13px] font-medium tracking-tight",
              active ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {active ? (
              <motion.span
                layoutId="active-coin"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 460, damping: 38 }}
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
