"use client";

import { useEffect, useState } from "react";

import { CoinSwitcher } from "@/components/CoinSwitcher";
import { DecisionFeed } from "@/components/DecisionFeed";
import { EquityChart } from "@/components/EquityChart";
import { HudStats } from "@/components/HudStats";
import { JevToggle } from "@/components/JevToggle";
import { LawsPanel } from "@/components/LawsPanel";
import { PriceChart } from "@/components/PriceChart";
import { TickerTape } from "@/components/TickerTape";
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
      <div className="relative flex h-full flex-col">
        <Header />
        <TickerTape />
        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_392px] gap-2.5 p-2.5">
          <div className="grid min-h-0 grid-rows-[minmax(0,1.35fr)_minmax(200px,0.78fr)] gap-2.5">
            <PriceChart />
            <DecisionFeed />
          </div>
          <div className="grid min-h-0 grid-rows-[auto_minmax(112px,0.62fr)_minmax(0,1fr)] gap-2.5">
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
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-medium tracking-tight">Jev</span>
          <span className="text-[12px] text-zinc-500">Paper</span>
        </div>
      </div>
      <CoinSwitcher />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-zinc-400">
          <span className={cn("size-1.5 rounded-full", live ? "bg-mint" : "bg-zinc-500")} />
          <span>{statusLabel(status.type)}</span>
        </div>
        <JevToggle />
        <div className="w-16 text-right font-mono text-[12px] tabular-nums text-zinc-500">
          {now === null ? "--:--:--" : formatClock(now)}
        </div>
      </div>
    </header>
  );
}

function statusLabel(status: "connecting" | "live" | "reconnecting" | "closed"): string {
  switch (status) {
    case "connecting":
      return "Binance connecting";
    case "live":
      return "Binance live";
    case "reconnecting":
      return "Binance reconnecting";
    case "closed":
      return "Binance offline";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
