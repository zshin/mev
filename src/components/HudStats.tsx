"use client";

import { formatClock, formatQty, formatSignedUsd, formatUsd } from "@/lib/format";
import { baseAsset } from "@/lib/market/types";
import { grossNotional } from "@/lib/paper/book";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export function HudStats() {
  const symbol = useDesk((state) => state.symbol);
  const book = useDesk((state) => state.book);
  const marks = useDesk((state) => state.marks);
  const equityUsd = useDesk((state) => state.equityUsd);
  const unrealizedUsd = useDesk((state) => state.unrealizedUsd);
  const caps = useDesk((state) => state.caps);
  const lastPrice = useDesk((state) => state.lastPrice);

  const position = book?.positions[symbol];
  const mark = lastPrice ?? marks[symbol] ?? position?.avgPrice ?? 0;
  const notional = position ? position.qty * mark : 0;
  const realized = book?.realizedPnlUsd ?? 0;
  const total = book ? equityUsd - book.startingCashUsd : 0;
  const gross = book ? grossNotional(book, marks) : 0;

  const cells = [
    { label: "Cash", value: formatUsd(book?.cashUsd ?? caps.startingCashUsd), tone: "text-ink" },
    {
      label: "Position",
      value: position ? `${formatQty(position.qty)} ${baseAsset(symbol)}` : "—",
      tone: "text-ink",
    },
    { label: "Notional", value: formatSignedUsd(notional), tone: toneFor(notional) },
    { label: "Unrealized", value: formatSignedUsd(unrealizedUsd), tone: toneFor(unrealizedUsd) },
    { label: "Realized", value: formatSignedUsd(realized), tone: toneFor(realized) },
    { label: "Equity", value: formatUsd(equityUsd), tone: "text-ink" },
    { label: "Total P&L", value: formatSignedUsd(total), tone: toneFor(total) },
    { label: "Fills", value: String(book?.tradeCount ?? 0), tone: "text-ink" },
  ];

  return (
    <section className="glass-panel px-3.5 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="kicker">Paper book</h2>
        <p className="font-mono text-[11px] text-zinc-500">
          Gross {formatUsd(gross, 0)} / {formatUsd(caps.maxGrossNotionalUsd, 0)}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-x-3 gap-y-2.5">
        {cells.map((cell) => (
          <div key={cell.label}>
            <div className="text-[11px] text-zinc-500">{cell.label}</div>
            <div className={cn("mt-1 font-mono text-[13px] tabular-nums tracking-tight", cell.tone)}>{cell.value}</div>
          </div>
        ))}
      </div>
      {book && book.fills.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-2">
          {book.fills.slice(0, 3).map((fill) => (
            <li key={fill.judgmentId} className="flex items-baseline justify-between gap-3 font-mono text-[10px] text-zinc-400">
              <span className="truncate">
                {formatClock(fill.time)} {baseAsset(fill.symbol)} {fill.type} {formatUsd(fill.notionalUsd, 0)}
              </span>
              <span className="shrink-0 text-zinc-500">{fill.judgmentId}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function toneFor(value: number): string {
  if (value > 0) return "text-mint";
  if (value < 0) return "text-rose";
  return "text-ink";
}
