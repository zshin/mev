"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { SurfaceReadout } from "@/components/SurfaceReadout";
import { formatBps, formatClock, formatUsd } from "@/lib/format";
import { STRATEGY_NAME, THRESHOLDS, type JudgeAction, type OptionScores } from "@/lib/jev/judge";
import { baseAsset } from "@/lib/market/types";
import { useDesk, type Decision, type DecisionFill } from "@/lib/store";
import { cn } from "@/lib/utils";

type FeedFilter = "all" | "act" | "wait" | "escalate";

const filters: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "act", label: "Act" },
  { id: "wait", label: "Wait" },
  { id: "escalate", label: "Escalate" },
];

export function DecisionFeed() {
  const decisions = useDesk((state) => state.decisions);
  const latest = useDesk((state) => state.latest);
  const jevEnabled = useDesk((state) => state.jevEnabled);
  const symbol = useDesk((state) => state.symbol);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const visible = decisions.filter((decision) => matches(decision.judgment.action, filter));
  const current = jevEnabled && latest?.symbol === symbol ? latest : null;

  return (
    <section className="glass-panel flex min-h-0 flex-col" data-testid="decision-feed">
      <header className="flex shrink-0 items-start justify-between gap-3 px-3.5 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="kicker">Decisions</h2>
            <span className="truncate text-[11px] text-zinc-500">
              {STRATEGY_NAME} · local stand-in, not a hosted Jev call
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-zinc-400">
            {current
              ? `${baseAsset(current.symbol)}  ${chipLabel(current.judgment.action)}  ${current.judgment.probability.toFixed(2)}  ${current.judgment.reason}`
              : jevEnabled
                ? "Reading the tape"
                : "Jev off. Tape live. Surface gated."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {filters.map((item) => {
            const count = decisions.filter((decision) => matches(decision.judgment.action, item.id)).length;
            const selected = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "rounded-full px-2 py-1 font-mono text-[10px] tabular-nums",
                  selected ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {item.label} {count}
              </button>
            );
          })}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-2 px-2.5 pb-2.5">
        <div className={cn("desk-scroll min-h-0 flex-1 space-y-1.5 overflow-auto pr-1", !jevEnabled && "opacity-80")}>
          <AnimatePresence initial={false}>
            {visible.map((decision) => (
              <DecisionRow key={decision.id} decision={decision} />
            ))}
          </AnimatePresence>
          {visible.length === 0 ? (
            <p className="px-2 py-8 text-center text-[12px] text-zinc-600">{emptyCopy(filter, jevEnabled, decisions.length)}</p>
          ) : null}
        </div>
        <SurfaceReadout judgment={current?.judgment ?? null} jevEnabled={jevEnabled} />
      </div>
    </section>
  );
}

function DecisionRow({ decision }: { decision: Decision }) {
  const judgment = decision.judgment;
  const runner = runnerUp(judgment.optionScores, judgment.action);
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5"
      data-testid="decision-row"
    >
      <div className="flex items-center gap-2">
        <time className="w-16 shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">{formatClock(decision.time)}</time>
        <span className="w-8 shrink-0 font-mono text-[10px] text-zinc-400">{baseAsset(decision.symbol)}</span>
        <ActionChip action={judgment.action} />
        <span className="w-9 shrink-0 font-mono text-[12px] text-zinc-200 tabular-nums">{judgment.probability.toFixed(2)}</span>
        <p className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">{judgment.drivers.join(" · ")}</p>
        <FillMark fill={decision.fill} id={decision.id} />
      </div>
      <p className="mt-0.5 truncate pl-16 font-mono text-[10px] text-zinc-500">
        {judgment.regime}
        {" · "}mom {formatBps(judgment.features.momentumBps)}
        {" · "}taker {formatTaker(judgment.features.imbalance)}
        {" · "}vol {judgment.features.volatilityBps.toFixed(1)}
        {" · "}shock {formatBps(judgment.features.shockBps)}
        {" · "}inv {formatInventory(judgment.features.inventory)}
        {" · "}cd {formatCooldown(judgment.features.cooldown)}
        {runner ? ` · next ${chipLabel(runner.action).toLowerCase()} ${runner.probability.toFixed(2)}` : ""}
      </p>
    </motion.article>
  );
}

function ActionChip({ action }: { action: JudgeAction }) {
  return (
    <span className={cn("inline-flex w-[76px] shrink-0 justify-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none", chipClass(action))}>
      {chipLabel(action)}
    </span>
  );
}

function FillMark({ fill, id }: { fill: DecisionFill; id: string }) {
  switch (fill.type) {
    case "filled":
      return (
        <span className="shrink-0 font-mono text-[10px] text-mint tabular-nums">
          {formatUsd(fill.notionalUsd, 0)} · {id}
        </span>
      );
    case "rejected":
      return (
        <span className="shrink-0 font-mono text-[10px] text-rose" title={fill.reason}>
          Blocked · {id}
        </span>
      );
    case "none":
      return null;
    default: {
      const unreachable: never = fill;
      return unreachable;
    }
  }
}

function matches(action: JudgeAction, filter: FeedFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "act":
      return action === "act_buy" || action === "act_sell";
    case "wait":
      return action === "wait";
    case "escalate":
      return action === "escalate";
    default: {
      const unreachable: never = filter;
      return unreachable;
    }
  }
}

function chipLabel(action: JudgeAction): string {
  switch (action) {
    case "act_buy":
      return "Act buy";
    case "act_sell":
      return "Act sell";
    case "wait":
      return "Wait";
    case "escalate":
      return "Escalate";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function chipClass(action: JudgeAction): string {
  switch (action) {
    case "act_buy":
      return "border-mint/25 bg-mint/10 text-mint";
    case "act_sell":
      return "border-rose/25 bg-rose/10 text-rose";
    case "wait":
      return "border-white/10 bg-white/[0.04] text-zinc-300";
    case "escalate":
      return "border-violet/25 bg-violet/10 text-violet";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function emptyCopy(filter: FeedFilter, jevEnabled: boolean, total: number): string {
  if (!jevEnabled && total === 0) return "Jev off. The tape is live. The surface stays gated.";
  switch (filter) {
    case "all":
      return jevEnabled ? "Reading the tape." : "No judgments yet.";
    case "act":
      return "No acts in this window.";
    case "wait":
      return "No waits in this window.";
    case "escalate":
      return "No escalate yet. A shock, a wide range, or a taker fight prints a stub.";
    default: {
      const unreachable: never = filter;
      return unreachable;
    }
  }
}

function runnerUp(scores: OptionScores, chosen: JudgeAction): { action: JudgeAction; probability: number } | null {
  let best: JudgeAction | null = null;
  const actions: JudgeAction[] = ["act_buy", "act_sell", "wait", "escalate"];
  for (const action of actions) {
    if (action === chosen) continue;
    if (!best || scores[action] > scores[best]) best = action;
  }
  if (!best || scores[best] <= 0) return null;
  return { action: best, probability: scores[best] };
}

function formatTaker(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatInventory(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function formatCooldown(ms: number): string {
  if (ms >= THRESHOLDS.actCooldownMs) return "ready";
  return `${(ms / 1000).toFixed(1)}s`;
}
