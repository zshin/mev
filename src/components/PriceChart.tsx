"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import { Button } from "@/components/ui/button";
import { formatPercent, formatPrice, formatSignedUsd } from "@/lib/format";
import { baseAsset } from "@/lib/market/types";
import type { Candle } from "@/lib/market/types";
import { bindPriceChart, restartFeed, useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const symbol = useDesk((state) => state.symbol);
  const lastPrice = useDesk((state) => state.lastPrice);
  const sessionOpen = useDesk((state) => state.sessionOpen);
  const taker = useDesk((state) => state.lastTaker);
  const status = useDesk((state) => state.status);
  const error = useDesk((state) => state.error);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let chart: IChartApi | null = null;
    let removed = false;
    let chartCleanup: (() => void) | null = null;

    // Lightweight Charts reads `window` while loading. Keep the import inside the effect so SSR does not evaluate it.
    void import("lightweight-charts").then((charts) => {
      if (removed || !containerRef.current) return;
      chart = charts.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: charts.ColorType.Solid, color: "transparent" },
          textColor: "rgba(161,161,170,0.9)",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.04)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
        timeScale: {
          borderColor: "rgba(255,255,255,0.06)",
          timeVisible: true,
          secondsVisible: true,
          barSpacing: 7,
          rightOffset: 6,
        },
        crosshair: {
          mode: charts.CrosshairMode.Normal,
          vertLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#18181b" },
          horzLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#18181b" },
        },
      });
      const series = chart.addSeries(charts.CandlestickSeries, {
        upColor: "#3ecf8e",
        downColor: "#f07167",
        borderVisible: false,
        wickUpColor: "#3ecf8e",
        wickDownColor: "#f07167",
      });
      bindPriceChart({
        setData: (data) => {
          series.setData(data.map(toBar));
          chart?.timeScale().fitContent();
        },
        update: (candle) => series.update(toBar(candle)),
      });
      const observer = new ResizeObserver(() => {
        if (!containerRef.current || !chart) return;
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      });
      observer.observe(containerRef.current);
      chartCleanup = () => {
        observer.disconnect();
        bindPriceChart(null);
        chart?.remove();
      };
    });

    return () => {
      removed = true;
      chartCleanup?.();
      bindPriceChart(null);
    };
  }, []);

  const delta = lastPrice !== null && sessionOpen !== null ? lastPrice - sessionOpen : null;
  const percent = delta !== null && sessionOpen ? delta / sessionOpen : null;
  const changeTone = delta === null ? "text-zinc-400" : delta < 0 ? "text-rose" : delta > 0 ? "text-mint" : "text-zinc-400";

  return (
    <section className="glass-panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-end justify-between gap-4 px-3.5 pt-3 pb-2">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium tracking-tight text-zinc-200">{baseAsset(symbol)}</span>
            <span className="font-mono text-[11px] text-zinc-500">{symbol} · 1s</span>
          </div>
          <div className="mt-1 font-mono text-[32px] leading-none font-medium tabular-nums tracking-tight text-ink">
            {lastPrice === null ? "—" : formatPrice(lastPrice)}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("font-mono text-[13px] tabular-nums", changeTone)}>
            {delta === null ? "—" : formatSignedUsd(delta)}
            {percent === null ? "" : `  ${formatPercent(percent)}`}
          </div>
          <div className="mt-1 font-mono text-[11px] text-zinc-500">
            {taker === "buy" ? "Lift" : taker === "sell" ? "Hit" : "Last"} · {status.type === "closed" ? "offline" : status.host}
          </div>
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-mono text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            Chart: TradingView Lightweight Charts
          </a>
          {status.type === "closed" ? (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => restartFeed()}>
              Reconnect
            </Button>
          ) : null}
          {error ? <p className="mt-1 max-w-64 text-[11px] text-rose">{error}</p> : null}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 px-2 pb-2">
        <div ref={containerRef} className="absolute inset-x-2 inset-y-0" />
      </div>
    </section>
  );
}

function toBar(candle: Candle): { time: UTCTimestamp; open: number; high: number; low: number; close: number } {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}
