"use client";

import { THRESHOLDS, type JudgeAction } from "@/lib/jev/judge";
import { planSize } from "@/lib/jev/size";
import type { Symbol } from "@/lib/market/types";
import type { Book, PaperCaps } from "@/lib/paper/book";
import { useDesk, type Decision, type SourceMode } from "@/lib/store";
import { cn } from "@/lib/utils";

const rows: { action: JudgeAction; label: string; bar: string }[] = [
  { action: "act_buy", label: "Buy", bar: "bg-mint/80" },
  { action: "act_sell", label: "Sell", bar: "bg-rose/80" },
  { action: "wait", label: "Wait", bar: "bg-zinc-400/80" },
  { action: "escalate", label: "Escalate", bar: "bg-violet/70" },
];

export function SurfaceReadout() {
  const mode = useDesk((state) => state.sourceMode);
  const configured = useDesk((state) => state.jevConfigured);
  const jevEnabled = useDesk((state) => state.jevEnabled);
  const symbol = useDesk((state) => state.symbol);
  const latest = useDesk((state) => state.latest);
  const tapeView = useDesk((state) => state.tapeView);
  const livePending = useDesk((state) => state.livePending);
  const book = useDesk((state) => state.book);
  const caps = useDesk((state) => state.caps);
  const marks = useDesk((state) => state.marks);

  const current = jevEnabled && latest && latest.symbol === symbol && latest.judgment.origin === mode ? latest : null;
  const tape = tapeView?.symbol === symbol ? tapeView : null;
  const regime = tape?.regime ?? current?.judgment.regime ?? null;
  const preview = current && book ? sizePreview(current, book, caps, marks, symbol, tape?.price ?? current.price, tape?.features.cooldown ?? current.judgment.features.cooldown) : null;

  return (
    <aside className="flex w-[200px] shrink-0 flex-col rounded-[10px] border border-white/[0.06] bg-black/20 px-2.5 py-2" data-testid="surface-readout">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{mode === "live" ? "Live" : configured === false ? "Offline" : "Local"}</span>
        <span className="font-mono text-[10px] tracking-wide text-zinc-400 uppercase">{regime ?? "idle"}</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-zinc-500">{sourceTitle(mode, configured)}</p>
      {mode === "live" ? (
        <p className="mt-1 font-mono text-[10px] text-zinc-400" data-testid="jev-model">
          {current?.judgment.model ?? "—"}
          {" · "}
          {current?.judgment.latencyMs != null ? `${Math.round(current.judgment.latencyMs)}ms` : livePending ? "asking" : "—"}
        </p>
      ) : null}
      {current?.judgment.failure ? (
        <p className="mt-1 text-[10px] leading-snug text-rose" data-testid="jev-failure">
          {current.judgment.failure}
        </p>
      ) : null}
      {current ? (
        <div className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const score = current.judgment.optionScores[row.action];
            const chosen = current.choice === row.action;
            return (
              <div key={row.action}>
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className={cn(chosen ? "text-zinc-200" : "text-zinc-500")}>{row.label}</span>
                  <span className={cn("tabular-nums", chosen ? "text-zinc-200" : "text-zinc-500")}>{score.toFixed(2)}</span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className={cn("h-full rounded-full", row.bar, !chosen && "opacity-50")} style={{ width: `${Math.round(score * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-snug text-zinc-500">
          {jevEnabled ? (mode === "live" ? "Waiting for a window, then Jev." : "Waiting for a full window.") : "Gated until Jev is on."}
        </p>
      )}
      <p className="mt-2 font-mono text-[10px] leading-snug text-zinc-400" data-testid="size-preview">
        {preview ? `preview ${preview}` : "preview —"}
      </p>
    </aside>
  );
}

function sizePreview(
  current: Decision,
  book: Book,
  caps: PaperCaps,
  marks: Partial<Record<Symbol, number>>,
  symbol: Symbol,
  price: number,
  msSinceLastAct: number,
): string | null {
  if (current.judgment.failure) return null;
  const plan = planSize({
    origin: current.judgment.origin,
    choice: current.choice,
    probability: current.choiceProbability,
    book,
    symbol,
    price,
    caps,
    marks: { ...marks, [symbol]: price },
    msSinceLastAct,
    cooldownMs: THRESHOLDS.actCooldownMs,
  });
  switch (plan.type) {
    case "skip":
      return current.choice === "escalate" ? "stub · no size" : null;
    case "blocked":
    case "order":
      return plan.line;
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}

function sourceTitle(mode: SourceMode, configured: boolean | null): string {
  if (mode === "live") return "Live Jev";
  if (configured === false) return "Offline fallback";
  return "Tape Alignment Surface";
}
