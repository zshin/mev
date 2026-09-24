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

    void import("lightweight-charts").then((charts) => {
      if (removed || !containerRef.current) return;
      chart = charts.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { type: charts.ColorType.Solid, color: "transparent" },
          textColor: "rgba(231,238,252,0.5)",
          fontFamily: "Geist Mono, ui-monospace, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(92,225,255,0.04)" },
          horzLines: { color: "rgba(92,225,255,0.05)" },
        },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
        timeScale: {
          borderColor: "rgba(255,255,255,0.06)",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: { color: "rgba(61,255,176,0.3)", labelBackgroundColor: "#101626" },
          horzLine: { color: "rgba(61,255,176,0.3)", labelBackgroundColor: "#101626" },
        },
      });
      const series = chart.addSeries(charts.AreaSeries, {
        lineColor: "#5ce1ff",
        topColor: "rgba(92,225,255,0.32)",
        bottomColor: "rgba(92,225,255,0.02)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      const armBaseline = () => {
        if (baseline) return;
        const start = useDesk.getState().book?.startingCashUsd;
        if (start === undefined) return;
        series.createPriceLine({
          price: start,
          color: "rgba(231,238,252,0.35)",
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
      <header className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
        <h2 className="font-mono text-[10px] tracking-[0.22em] text-white/45">EQUITY</h2>
        <p className={cn("font-mono text-xs tabular-nums", pnl > 0 ? "text-mint" : pnl < 0 ? "text-rose" : "text-white/50")}>
          {tradeCount > 0 ? `${formatUsd(equityUsd)}  ${formatSignedUsd(pnl)}` : "Flat until the first fill"}
        </p>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-2" />
        {tradeCount === 0 ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-white/45">
              CURVE ARMS ON FIRST PAPER FILL
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function toPoint(point: EquityPoint): { time: UTCTimestamp; value: number } {
  return { time: point.time as UTCTimestamp, value: point.value };
}
