"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";

import { formatSignedUsd, formatUsd } from "@/lib/format";
import { bindEquityChart, useDesk, type EquityPoint } from "@/lib/store";
import { cn } from "@/lib/utils";

export function EquityChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tradeCount = useDesk((state) => state.book?.tradeCount ?? 0);
  const equityUsd = useDesk((state) => state.equityUsd);
  const starting = useDesk((state) => state.book?.startingCashUsd ?? state.caps.startingCashUsd);
  const pnl = equityUsd - starting;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let chart: IChartApi | null = null;
    let removed = false;
    let baseline = false;
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
          vertLines: { color: "rgba(255,255,255,0.035)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
        timeScale: {
          borderColor: "rgba(255,255,255,0.06)",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#18181b" },
          horzLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#18181b" },
        },
      });
      const series = chart.addSeries(charts.AreaSeries, {
        lineColor: "#e4e4e7",
        topColor: "rgba(255,255,255,0.14)",
        bottomColor: "rgba(255,255,255,0.01)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      const armBaseline = () => {
        if (baseline) return;
        const start = useDesk.getState().book?.startingCashUsd;
        if (start === undefined) return;
        series.createPriceLine({
          price: start,
          color: "rgba(255,255,255,0.28)",
          lineWidth: 1,
          lineStyle: charts.LineStyle.Dashed,
          title: "start",
          axisLabelVisible: true,
        });
        baseline = true;
      };
      bindEquityChart({
        setData: (points) => {
          series.setData(points.map(toPoint));
          if (points.length > 0) armBaseline();
          chart?.timeScale().fitContent();
        },
        update: (point) => {
          series.update(toPoint(point));
          armBaseline();
        },
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
        bindEquityChart(null);
        chart?.remove();
      };
    });

    return () => {
      removed = true;
      chartCleanup?.();
      bindEquityChart(null);
    };
  }, []);

  return (
    <section className="glass-panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between px-3.5 pt-3 pb-1">
        <h2 className="kicker">Equity</h2>
        <p className={cn("font-mono text-[12px] tabular-nums", pnl > 0 ? "text-mint" : pnl < 0 ? "text-rose" : "text-zinc-500")}>
          {tradeCount > 0 ? `${formatUsd(equityUsd)}  ${formatSignedUsd(pnl)}` : "After the first fill"}
        </p>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-2" />
        {tradeCount === 0 ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="text-[12px] text-zinc-500">The curve prints with the first paper fill.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function toPoint(point: EquityPoint): { time: UTCTimestamp; value: number } {
  return { time: point.time as UTCTimestamp, value: point.value };
}
