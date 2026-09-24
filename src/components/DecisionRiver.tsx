"use client";

import { AnimatePresence, motion } from "framer-motion";

import { ProbabilityRing } from "@/components/ProbabilityRing";
import { formatClock, formatUsd } from "@/lib/format";
import type { JudgeAction } from "@/lib/jev/judge";
import { baseAsset } from "@/lib/market/types";
import { useDesk, type Decision } from "@/lib/store";
import { cn } from "@/lib/utils";

type LaneId = "act" | "wait" | "escalate";

const lanes: { id: LaneId; title: string; hint: string }[] = [
  { id: "act", title: "Act", hint: "High confidence" },
  { id: "wait", title: "Wait", hint: "No new risk" },
  { id: "escalate", title: "Escalate", hint: "Stub only" },
];

export function DecisionRiver() {
  const decisions = useDesk((state) => state.decisions);
  const latest = useDesk((state) => state.latest);
  const jevEnabled = useDesk((state) => state.jevEnabled);

  return (
    <section className="glass-panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="font-mono text-[10px] tracking-[0.22em] text-white/45">JUDGMENTS</h2>
        <p className="truncate font-mono text-[11px] text-white/55">
          {latest
            ? `${baseAsset(latest.symbol)}  ${actionTitle(latest.judgment.action)}  ${latest.judgment.probability.toFixed(2)}  ${latest.judgment.reason}`
            : jevEnabled
              ? "Reading the tape"
              : "Jev off · tape live · judgments gated"}
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 px-3 pb-3">
        {lanes.map((lane) => {
          const cards = decisions.filter((decision) => laneOf(decision.judgment.action) === lane.id).slice(0, 8);
          return (
            <div
              key={lane.id}
              className={cn(
                "flex min-h-0 flex-col rounded-2xl border border-white/8 bg-black/25",
                lane.id === "escalate" && "escalate-lane",
                !jevEnabled && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                <div>
                  <div className="text-sm font-medium">{lane.title}</div>
                  <div className="font-mono text-[10px] tracking-[0.14em] text-white/35">{lane.hint}</div>
                </div>
                {lane.id === "escalate" ? <span className="escalate-chip mt-0">Escalate (stub)</span> : null}
              </div>
              <div className="desk-scroll min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
                <AnimatePresence initial={false}>
                  {cards.map((decision) => (
                    <DecisionCard key={decision.id} decision={decision} />
                  ))}
                </AnimatePresence>
                {cards.length === 0 ? (
                  <p className="px-1 py-6 text-center font-mono text-[10px] tracking-[0.14em] text-white/30">
                    {emptyCopy(lane.id, jevEnabled)}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionCard({ decision }: { decision: Decision }) {
  const tone = toneFor(decision.judgment.action);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.28 }}
      className="flex gap-2 rounded-xl border border-white/10 bg-[#0c1220]/80 p-2"
    >
      <ProbabilityRing value={decision.judgment.probability} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] tracking-[0.12em] text-white/45">
            {baseAsset(decision.symbol)} · {formatClock(decision.time)}
          </span>
          <FillMark decision={decision} />
        </div>
        <div className="mt-0.5 text-[13px] leading-tight font-medium">{actionTitle(decision.judgment.action)}</div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/55">{decision.judgment.reason}</p>
        {decision.judgment.action === "escalate" ? <span className="escalate-chip">Escalate (stub)</span> : null}
      </div>
    </motion.article>
  );
}

function FillMark({ decision }: { decision: Decision }) {
  switch (decision.fill.type) {
    case "filled":
      return <span className="font-mono text-[10px] text-mint">FILL {formatUsd(decision.fill.notionalUsd, 0)}</span>;
    case "rejected":
      return <span className="font-mono text-[10px] text-rose">BLOCKED</span>;
    case "none":
      return null;
    default: {
      const unreachable: never = decision.fill;
      return unreachable;
    }
  }
}

function laneOf(action: JudgeAction): LaneId {
  switch (action) {
    case "act_buy":
    case "act_sell":
      return "act";
    case "wait":
      return "wait";
    case "escalate":
      return "escalate";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function actionTitle(action: JudgeAction): string {
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

function toneFor(action: JudgeAction): "mint" | "rose" | "cyan" | "violet" {
  switch (action) {
    case "act_buy":
      return "mint";
    case "act_sell":
      return "rose";
    case "wait":
      return "cyan";
    case "escalate":
      return "violet";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function emptyCopy(lane: LaneId, jevEnabled: boolean): string {
  if (!jevEnabled) return "Gated";
  switch (lane) {
    case "act":
      return "No acts yet";
    case "wait":
      return "No waits yet";
    case "escalate":
      return "No stubs yet";
    default: {
      const unreachable: never = lane;
      return unreachable;
    }
  }
}
