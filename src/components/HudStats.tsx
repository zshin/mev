"use client";

import { formatQty, formatSignedUsd, formatUsd } from "@/lib/format";
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
    <section className="glass-panel px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[10px] tracking-[0.22em] text-white/45">PAPER BOOK</h2>
        <p className="font-mono text-[10px] tracking-[0.14em] text-white/40">
          GROSS {formatUsd(gross, 0)} / {formatUsd(caps.maxGrossNotionalUsd, 0)}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-x-3 gap-y-3">
        {cells.map((cell) => (
          <div key={cell.label}>
            <div className="font-mono text-[10px] tracking-[0.16em] text-white/35">{cell.label}</div>
            <div className={cn("mt-1 font-mono text-sm tabular-nums", cell.tone)}>{cell.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function toneFor(value: number): string {
  if (value > 0) return "text-mint";
  if (value < 0) return "text-rose";
  return "text-ink";
}
