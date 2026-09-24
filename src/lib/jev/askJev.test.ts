import assert from "node:assert/strict";
import test from "node:test";

import { askJev, JEV_ENDPOINT } from "@/lib/jev/askJev";
import { TAPE_CRITERIA, TAPE_QUESTION, type DeskState } from "@/lib/jev/contract";

const KEY = "test-key-should-not-leak-xyz";

const state: DeskState = {
  symbol: "BTCUSDT",
  lastPrice: 100,
  momentumBps: 2,
  imbalance: 0.4,
  volatilityBps: 1.2,
  shockBps: 0.2,
  regime: "trend",
  inventory: 0,
  cooldownMs: 60_000,
  cashRoomUsd: 10_000,
  capsRemaining: { symbolLongUsd: 1_500, symbolShortUsd: 1_500, grossUsd: 3_000, maxTradeUsd: 200 },
};

function choiceBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "jev-1.13.0",
    answers: {
      [TAPE_QUESTION]: {
        type: "choice",
        choice: "act_buy",
        probabilities: { act_buy: 0.82, act_sell: 0.04, wait: 0.1, escalate: 0.04 },
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 120, output_tokens: 20 },
    ...overrides,
  };
}

function jsonFetch(status: number, body: unknown, headers?: HeadersInit): { fetchImpl: typeof fetch; seen: () => { url: string; init: RequestInit } | null } {
  let captured: { url: string; init: RequestInit } | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    captured = { url: String(input), init: init ?? {} };
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers });
  };
  return { fetchImpl, seen: () => captured };
}

test("a Choice answer becomes the selected option and its probability", async () => {
  const mocked = jsonFetch(200, choiceBody());
  const result = await askJev({ state, apiKey: KEY, fetchImpl: mocked.fetchImpl });
  assert.equal(result.type, "choice");
  if (result.type !== "choice") return;
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.action, "act_buy");
  assert.equal(result.probability, 0.82);
  assert.equal(result.optionScores.wait, 0.1);
  assert.equal(result.confidence, 0.8);
  assert.equal(JSON.stringify(result).includes(KEY), false);

  const seen = mocked.seen();
  assert.ok(seen);
  if (!seen) return;
  assert.equal(seen.url, JEV_ENDPOINT);
  const headers = new Headers(seen.init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${KEY}`);
  const body = JSON.parse(String(seen.init.body)) as {
    model: string;
    state: DeskState;
    questions: Record<string, { type: string; criteria: Record<string, string> }>;
  };
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state.symbol, "BTCUSDT");
  assert.equal(body.questions[TAPE_QUESTION]?.type, "choice");
  assert.deepEqual(Object.keys(body.questions[TAPE_QUESTION]?.criteria ?? {}), Object.keys(TAPE_CRITERIA));
  assert.equal(String(seen.init.body).includes(KEY), false);
});

test("missing key fails closed and does not call the network", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("no");
  };
  const missing = await askJev({ state, apiKey: undefined, fetchImpl });
  const blank = await askJev({ state, apiKey: "  ", fetchImpl });
  assert.equal(missing.type, "closed");
  assert.equal(blank.type, "closed");
  if (missing.type === "closed") assert.equal(missing.reason, "missing-key");
  if (blank.type === "closed") assert.equal(blank.reason, "missing-key");
  assert.equal(called, false);
});

test("http failures fail closed without copying the body", async () => {
  const denied = jsonFetch(401, { error: KEY, authorization: `Bearer ${KEY}` });
  const deniedResult = await askJev({ state, apiKey: KEY, fetchImpl: denied.fetchImpl });
  assert.equal(deniedResult.type, "closed");
  if (deniedResult.type === "closed") assert.equal(deniedResult.reason, "unauthorized");
  assert.equal(JSON.stringify(deniedResult).includes(KEY), false);

  const limited = jsonFetch(429, { message: KEY }, { "retry-after": "2" });
  const limitedResult = await askJev({ state, apiKey: KEY, fetchImpl: limited.fetchImpl });
  assert.equal(limitedResult.type, "closed");
  if (limitedResult.type === "closed") {
    assert.equal(limitedResult.reason, "rate-limited");
    assert.equal(limitedResult.retryAfterMs, 2_000);
  }

  const limitedWithoutHint = jsonFetch(429, { message: KEY });
  const limitedWithoutHintResult = await askJev({
    state,
    apiKey: KEY,
    fetchImpl: limitedWithoutHint.fetchImpl,
  });
  assert.equal(limitedWithoutHintResult.type, "closed");
  if (limitedWithoutHintResult.type === "closed") {
    assert.equal(limitedWithoutHintResult.reason, "rate-limited");
    assert.equal(limitedWithoutHintResult.retryAfterMs, 10_000);
  }

  const down = jsonFetch(503, KEY);
  const downResult = await askJev({ state, apiKey: KEY, fetchImpl: down.fetchImpl });
  assert.equal(downResult.type, "closed");
  if (downResult.type === "closed") assert.equal(downResult.reason, "unavailable");

  const rejected = jsonFetch(422, { field: "questions.tape" });
  const rejectedResult = await askJev({ state, apiKey: KEY, fetchImpl: rejected.fetchImpl });
  assert.equal(rejectedResult.type, "closed");
  if (rejectedResult.type === "closed") assert.equal(rejectedResult.reason, "rejected");
});

test("malformed Choice payloads fail closed", async () => {
  const cases: unknown[] = [
    "not-json",
    { model: "jev-1.13.0", answers: {} },
    choiceBody({
      answers: {
        tape: {
          type: "choice",
          choice: "act_buy",
          probabilities: { act_buy: 0.2, act_sell: 0.1, wait: 0.6, escalate: 0.1 },
          confidence: 0.4,
        },
      },
    }),
    choiceBody({
      answers: {
        tape: {
          type: "choice",
          choice: "act_buy",
          probabilities: { act_buy: 0.9, act_sell: 0.2, wait: 0.2, escalate: 0.2 },
          confidence: 0.4,
        },
      },
    }),
    choiceBody({
      answers: {
        tape: {
          type: "choice",
          choice: "hold",
          probabilities: { act_buy: 0.25, act_sell: 0.25, wait: 0.25, escalate: 0.25 },
        },
      },
    }),
  ];
  for (const body of cases) {
    const mocked = jsonFetch(200, body);
    const result = await askJev({ state, apiKey: KEY, fetchImpl: mocked.fetchImpl });
    assert.equal(result.type, "closed", JSON.stringify(body));
    if (result.type === "closed") assert.equal(result.reason, "malformed");
    assert.equal(JSON.stringify(result).includes(KEY), false);
  }
});

test("a thrown transport error fails closed and drops the message", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error(`network down ${KEY}`);
  };
  const result = await askJev({ state, apiKey: KEY, fetchImpl });
  assert.equal(result.type, "closed");
  if (result.type === "closed") assert.equal(result.reason, "unavailable");
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("timeout fails closed", async () => {
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      init?.signal?.addEventListener("abort", abort, { once: true });
    });
  const result = await askJev({ state, apiKey: KEY, fetchImpl, timeoutMs: 20 });
  assert.equal(result.type, "closed");
  if (result.type === "closed") assert.equal(result.reason, "timeout");
});

test("a cancelled caller aborts without a closed timeout", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("no");
  };
  const signal = new AbortController();
  signal.abort();
  const result = await askJev({ state, apiKey: KEY, fetchImpl, signal: signal.signal });
  assert.equal(result.type, "aborted");
  assert.equal(called, false);
});
