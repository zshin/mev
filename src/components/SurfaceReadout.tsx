"use client";

import type { JudgeAction } from "@/lib/jev/judge";
import { useDesk, type SourceMode } from "@/lib/store";
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

  const current = jevEnabled && latest && latest.symbol === symbol && latest.judgment.origin === mode ? latest : null;
  const tape = tapeView?.symbol === symbol ? tapeView : null;
  const regime = current?.judgment.regime ?? tape?.regime ?? null;
  const sizeLine =
    current?.sizeLine ?? (current?.choice === "escalate" ? "stub · no size" : null);

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
          {livePending
            ? "asking"
            : current?.judgment.latencyMs != null
              ? `${Math.round(current.judgment.latencyMs)}ms`
              : "—"}
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
        {sizeLine ? `size ${sizeLine}` : "size —"}
      </p>
    </aside>
  );
}

function sourceTitle(mode: SourceMode, configured: boolean | null): string {
  if (mode === "live") return "Live Jev";
  if (configured === false) return "Offline fallback";
  return "Tape Alignment Surface";
}
