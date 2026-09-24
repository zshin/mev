import { z } from "zod";

import {
  closedResult,
  JEV_MODEL,
  TAPE_CRITERIA,
  TAPE_INSTRUCTIONS,
  TAPE_QUESTION,
  type ChoiceResult,
  type ClosedReason,
  type DeskState,
  type HostResult,
  type OptionScoreMap,
} from "@/lib/jev/contract";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_TIMEOUT_MS = 4_000;

const RESPONSE_TEXT_LIMIT = 100_000;
const PROBABILITY_SUM_TOLERANCE = 0.02;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10_000;

const upstreamChoiceSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number().finite().optional(),
  })
  .passthrough();

const upstreamResponseSchema = z
  .object({
    model: z.string(),
    answers: z
      .object({
        [TAPE_QUESTION]: upstreamChoiceSchema,
      })
      .passthrough(),
  })
  .passthrough();

export type AskJevResult = HostResult | { type: "aborted"; latencyMs: number };

export type AskJevInput = {
  state: DeskState;
  apiKey: string | undefined;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * One Choice question against TypeSafe. Failures become a closed result.
 * The result never includes the API key or the raw response body.
 * Server-side only: do not import this module from a client component.
 */
export async function askJev(input: AskJevInput): Promise<AskJevResult> {
  if (typeof window !== "undefined") {
    return closedResult("unavailable", 0);
  }

  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (apiKey.length === 0) return closedResult("missing-key", 0);

  const now = input.now ?? Date.now;
  const started = now();
  const elapsed = () => Math.max(0, now() - started);
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? JEV_TIMEOUT_MS;
  const outer = input.signal;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const onOuterAbort = () => timeout.abort();
  outer?.addEventListener("abort", onOuterAbort);

  try {
    if (outer?.aborted) return { type: "aborted", latencyMs: elapsed() };
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: timeout.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: input.state,
        questions: {
          [TAPE_QUESTION]: {
            type: "choice",
            instructions: TAPE_INSTRUCTIONS,
            criteria: TAPE_CRITERIA,
          },
        },
      }),
    });

    const latencyMs = elapsed();
    if (!response.ok) {
      const retryAfterMs =
        response.status === 429
          ? (readRetryAfter(response.headers.get("retry-after"), now()) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS)
          : null;
      return closedResult(statusReason(response.status), latencyMs, retryAfterMs);
    }

    const text = await response.text();
    return parseChoiceBody(text, latencyMs);
  } catch (error) {
    const latencyMs = elapsed();
    if (outer?.aborted) return { type: "aborted", latencyMs };
    if (timeout.signal.aborted || isAbortError(error)) return closedResult("timeout", latencyMs);
    return closedResult("unavailable", latencyMs);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

function parseChoiceBody(text: string, latencyMs: number): HostResult {
  if (text.length === 0 || text.length > RESPONSE_TEXT_LIMIT) return closedResult("malformed", latencyMs);
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return closedResult("malformed", latencyMs);
  }
  const parsed = upstreamResponseSchema.safeParse(json);
  if (!parsed.success) return closedResult("malformed", latencyMs);

  const answer = parsed.data.answers[TAPE_QUESTION];
  const scores = readScores(answer.probabilities);
  if (!scores) return closedResult("malformed", latencyMs);
  const sum = scores.act_buy + scores.act_sell + scores.wait + scores.escalate;
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return closedResult("malformed", latencyMs);
  if (!isKnownAction(answer.choice) || !isArgmax(answer.choice, scores)) return closedResult("malformed", latencyMs);
  if (parsed.data.model.trim().length === 0 || parsed.data.model.length > 64) return closedResult("malformed", latencyMs);

  const choice: ChoiceResult = {
    type: "choice",
    model: parsed.data.model,
    latencyMs,
    action: answer.choice,
    probability: scores[answer.choice],
    confidence: readConfidence(answer.confidence),
    optionScores: scores,
  };
  return choice;
}

function readScores(probabilities: Record<string, number>): OptionScoreMap | null {
  const scores: Partial<OptionScoreMap> = {};
  for (const action of ["act_buy", "act_sell", "wait", "escalate"] as const) {
    const value = probabilities[action];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
    scores[action] = value;
  }
  if (
    scores.act_buy === undefined ||
    scores.act_sell === undefined ||
    scores.wait === undefined ||
    scores.escalate === undefined
  ) {
    return null;
  }
  return {
    act_buy: scores.act_buy,
    act_sell: scores.act_sell,
    wait: scores.wait,
    escalate: scores.escalate,
  };
}

function isKnownAction(value: string): value is ChoiceResult["action"] {
  switch (value) {
    case "act_buy":
    case "act_sell":
    case "wait":
    case "escalate":
      return true;
    default:
      return false;
  }
}

function isArgmax(choice: ChoiceResult["action"], scores: OptionScoreMap): boolean {
  let best = 0;
  for (const action of ["act_buy", "act_sell", "wait", "escalate"] as const) {
    best = Math.max(best, scores[action]);
  }
  return scores[choice] >= best - 1e-9;
}

function readConfidence(value: number | undefined): number | null {
  if (value === undefined || value < 0 || value > 1) return null;
  return value;
}

function statusReason(status: number): ClosedReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate-limited";
  if (status === 400 || status === 422) return "rejected";
  if (status === 529 || status >= 500) return "unavailable";
  return "malformed";
}

function readRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(0, date - nowMs), 60_000);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
