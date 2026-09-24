"use client";

import { useEffect, useState } from "react";

import { CoinSwitcher } from "@/components/CoinSwitcher";
import { DecisionRiver } from "@/components/DecisionRiver";
import { EquityChart } from "@/components/EquityChart";
import { HudStats } from "@/components/HudStats";
import { JevToggle } from "@/components/JevToggle";
import { LawsPanel } from "@/components/LawsPanel";
import { PriceChart } from "@/components/PriceChart";
import { TickerTape } from "@/components/TickerTape";
import { Badge } from "@/components/ui/badge";
import { formatClock } from "@/lib/format";
import type { PaperCaps } from "@/lib/paper/book";
import { bootDesk, useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type DeskLaws = {
  source: string;
  caps: PaperCaps;
};

export function Dashboard({ laws }: { laws: DeskLaws }) {
  useState(() => {
    useDesk.getState().ensureBook(laws.caps);
    return true;
  });

  const startingCashUsd = laws.caps.startingCashUsd;
  const maxTradeNotionalUsd = laws.caps.maxTradeNotionalUsd;
  const maxSymbolNotionalUsd = laws.caps.maxSymbolNotionalUsd;
  const maxGrossNotionalUsd = laws.caps.maxGrossNotionalUsd;

  useEffect(() => {
    return bootDesk({
      startingCashUsd,
      maxTradeNotionalUsd,
      maxSymbolNotionalUsd,
      maxGrossNotionalUsd,
    });
  }, [startingCashUsd, maxTradeNotionalUsd, maxSymbolNotionalUsd, maxGrossNotionalUsd]);

  return (
    <div className="relative h-dvh overflow-hidden bg-desk text-ink">
      <div className="desk-grid pointer-events-none absolute inset-0" />
      <div className="desk-glow pointer-events-none absolute inset-0" />
      <div className="relative flex h-full flex-col">
        <Header />
        <TickerTape />
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] gap-3 px-3 py-3">
          <div className="grid min-h-0 grid-rows-[minmax(0,1.35fr)_minmax(210px,0.8fr)] gap-3">
            <PriceChart />
            <DecisionRiver />
          </div>
          <div className="grid min-h-0 grid-rows-[auto_minmax(120px,0.7fr)_minmax(0,1fr)] gap-3">
            <HudStats />
            <EquityChart />
            <LawsPanel source={laws.source} />
          </div>
        </main>
      </div>
    </div>
  );
}

function Header() {
  const status = useDesk((state) => state.status);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const live = status.type === "live";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex items-center gap-3">
        <div className="relative grid size-10 place-items-center">
          <span className="absolute inset-0 rounded-2xl bg-neon/20 blur-md" />
          <span className="relative grid size-10 place-items-center rounded-2xl border border-neon/40 bg-black/50 font-mono text-[11px] text-neon">
            JV
          </span>
        </div>
        <div>
          <div className="text-[15px] leading-none font-semibold tracking-[0.32em]">JEV</div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.22em] text-white/40">PAPER DESK</div>
        </div>
        <Badge variant="paper" className="ml-2">
          Paper only
        </Badge>
      </div>
      <CoinSwitcher />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5">
          <span className={cn("size-1.5 rounded-full", live ? "live-dot bg-mint" : "bg-amber")} />
          <span className="font-mono text-[10px] tracking-[0.18em] text-white/70">{statusLabel(status.type)}</span>
        </div>
        <JevToggle />
        <div className="w-[72px] text-right font-mono text-xs tabular-nums text-white/55">
          {now === null ? "--:--:--" : formatClock(now)}
        </div>
      </div>
    </header>
  );
}

function statusLabel(status: "connecting" | "live" | "reconnecting" | "closed"): string {
  switch (status) {
    case "connecting":
      return "CONNECTING";
    case "live":
      return "LIVE";
    case "reconnecting":
      return "RECONNECT";
    case "closed":
      return "OFFLINE";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
