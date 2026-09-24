"use client";

import { AnimatePresence, motion } from "framer-motion";

import { formatClock } from "@/lib/format";
import { baseAsset } from "@/lib/market/types";
import { useDesk, type Decision } from "@/lib/store";

export function TickerTape() {
  const decisions = useDesk((state) => state.decisions);
  const latest = useDesk((state) => state.latest);
  const items = tapeItems(latest, decisions);

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
      <span className="kicker shrink-0">Tape</span>
      {items.length === 0 ? (
        <span className="text-[12px] text-zinc-500">Public tape. Paper fills only.</span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item, index) => (
              <motion.span
                key={item.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: index === 0 ? 1 : 0.55, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="shrink-0 font-mono text-[11px] text-zinc-300"
              >
                {item.label}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function tapeItems(latest: Decision | null, decisions: Decision[]): { id: string; label: string }[] {
  const source = latest ? [latest, ...decisions.filter((item) => item.id !== latest.id)] : decisions;
  return source.slice(0, 3).map((decision) => ({
    id: decision.id,
    label: `${formatClock(decision.time)}  ${baseAsset(decision.symbol)}  ${shortAction(decision)}  ${decision.judgment.probability.toFixed(2)}`,
  }));
}

function shortAction(decision: Decision): string {
  switch (decision.judgment.action) {
    case "act_buy":
      return "Buy";
    case "act_sell":
      return "Sell";
    case "wait":
      return "Wait";
    case "escalate":
      return "Escalate";
    default: {
      const unreachable: never = decision.judgment.action;
      return unreachable;
    }
  }
}
