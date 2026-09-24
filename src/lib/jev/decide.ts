import { markTooSoft } from "@/lib/jev/liveJudgment";
import { planSize } from "@/lib/jev/size";
import type { JudgeAction, Judgment } from "@/lib/jev/surface";
import { applyOrder, type Book, type PaperCaps, type RiskGate } from "@/lib/paper/book";
import type { Symbol } from "@/lib/market/types";

export type DecisionFill =
  | { type: "filled"; notionalUsd: number; judgmentId: string }
  | { type: "rejected"; reason: string }
  | { type: "none" };

export type Decided = {
  judgment: Judgment;
  book: Book;
  fill: DecisionFill;
  sizeLine: string | null;
  filled: boolean;
};

/**
 * Host policy after a Choice (or the local surface). Jev does not pick a size.
 * Escalate never reaches the book. A soft live probability is recorded as wait.
 */
export function decidePaper(input: {
  judgment: Judgment;
  choice: JudgeAction;
  choiceProbability: number;
  book: Book;
  symbol: Symbol;
  price: number;
  time: number;
  judgmentId: string;
  caps: PaperCaps;
  marks: Partial<Record<Symbol, number>>;
  gate: RiskGate;
  msSinceLastAct: number;
  cooldownMs: number;
}): Decided {
  const plan = planSize({
    origin: input.judgment.origin,
    choice: input.choice,
    probability: input.choiceProbability,
    book: input.book,
    symbol: input.symbol,
    price: input.price,
    caps: input.caps,
    marks: input.marks,
    msSinceLastAct: input.msSinceLastAct,
    cooldownMs: input.cooldownMs,
  });

  switch (plan.type) {
    case "skip":
      return { judgment: input.judgment, book: input.book, fill: { type: "none" }, sizeLine: null, filled: false };
    case "blocked": {
      if (plan.reason === "too-soft") {
        return {
          judgment: markTooSoft(input.judgment),
          book: input.book,
          fill: { type: "rejected", reason: "too soft" },
          sizeLine: plan.line,
          filled: false,
        };
      }
      return {
        judgment: input.judgment,
        book: input.book,
        fill: { type: "rejected", reason: plan.detail },
        sizeLine: plan.line,
        filled: false,
      };
    }
    case "order": {
      if (input.gate.type === "frozen") {
        return {
          judgment: input.judgment,
          book: input.book,
          fill: { type: "rejected", reason: input.gate.reason },
          sizeLine: plan.line,
          filled: false,
        };
      }
      const result = applyOrder(
        input.book,
        {
          type: plan.side,
          symbol: input.symbol,
          notionalUsd: plan.notionalUsd,
          price: input.price,
          time: input.time,
          judgmentId: input.judgmentId,
        },
        input.caps,
        input.gate,
        input.marks,
      );
      if (result.type === "rejected") {
        return {
          judgment: input.judgment,
          book: input.book,
          fill: { type: "rejected", reason: result.reason },
          sizeLine: plan.line,
          filled: false,
        };
      }
      return {
        judgment: input.judgment,
        book: result.book,
        fill: { type: "filled", notionalUsd: result.fill.notionalUsd, judgmentId: result.fill.judgmentId },
        sizeLine: plan.line,
        filled: true,
      };
    }
    default: {
      const unreachable: never = plan;
      return unreachable;
    }
  }
}
