import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PaperCaps } from "@/lib/paper/book";

export type LawsDocument = {
  source: string;
  caps: PaperCaps;
};

const DEFAULT_CAPS: PaperCaps = {
  startingCashUsd: 10_000,
  maxTradeNotionalUsd: 100,
  maxSymbolNotionalUsd: 1_500,
  maxGrossNotionalUsd: 3_000,
};

export function parseLaws(source: string): LawsDocument {
  return {
    source,
    caps: {
      startingCashUsd: readNumber(source, "starting_cash_usd", DEFAULT_CAPS.startingCashUsd),
      maxTradeNotionalUsd: readNumber(source, "max_trade_notional_usd", DEFAULT_CAPS.maxTradeNotionalUsd),
      maxSymbolNotionalUsd: readNumber(
        source,
        "max_symbol_notional_usd",
        DEFAULT_CAPS.maxSymbolNotionalUsd,
      ),
      maxGrossNotionalUsd: readNumber(source, "max_gross_notional_usd", DEFAULT_CAPS.maxGrossNotionalUsd),
    },
  };
}

export async function loadLaws(): Promise<LawsDocument> {
  const source = await readFile(path.join(process.cwd(), "LAWS.bend"), "utf8");
  return parseLaws(source);
}

function readNumber(source: string, key: string, fallback: number): number {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "m").exec(source);
  const raw = match?.[1];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
