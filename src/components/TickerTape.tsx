"use client";

import { formatClock } from "@/lib/format";
import { baseAsset } from "@/lib/market/types";
import { useDesk, type Decision } from "@/lib/store";

export function TickerTape() {
  const decisions = useDesk((state) => state.decisions);
  const latest = useDesk((state) => state.latest);
  const items = tickerItems(latest, decisions);
  const line = items.length > 0 ? items.join("    ·    ") : "JEV PAPER DESK    ·    BINANCE PUBLIC TAPE    ·    NO LIVE ORDERS";
  const track = `${line}    ·    ${line}`;

  return (
    <div className="relative h-9 overflow-hidden border-y border-white/8 bg-black/30">
      <div className="marquee-track flex h-full w-max items-center whitespace-nowrap font-mono text-[11px] tracking-[0.14em] text-neon/80">
        <span className="px-6">{track}</span>
      </div>
    </div>
  );
}

function tickerItems(latest: Decision | null, decisions: Decision[]): string[] {
  const source = latest ? [latest, ...decisions.filter((item) => item.id !== latest.id)] : decisions;
  return source.slice(0, 12).map((decision) => {
    const action = decision.judgment.action.replace("act_", "").toUpperCase();
    return `${formatClock(decision.time)}  ${baseAsset(decision.symbol)}  ${action}  ${decision.judgment.probability.toFixed(2)}  ${decision.judgment.reason}`;
  });
}
