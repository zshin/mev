import { z } from "zod";

import { isSymbol, type Candle, type MarketEvent, type Symbol } from "@/lib/market/types";

const REST_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"] as const;

const PREFERRED_WS = "wss://stream.binance.com:9443/ws";
const FALLBACK_WS = "wss://data-stream.binance.vision/ws";
const PREFERRED_GRACE_MS = 900;

const tradeMessage = z.object({
  e: z.literal("trade"),
  s: z.string(),
  p: z.string(),
  q: z.string(),
  T: z.number(),
  m: z.boolean(),
});

const klineMessage = z.object({
  e: z.literal("kline"),
  s: z.string(),
  k: z.object({
    t: z.number(),
    i: z.string(),
    o: z.string(),
    h: z.string(),
    l: z.string(),
    c: z.string(),
    x: z.boolean(),
  }),
});

const marketMessage = z.discriminatedUnion("e", [tradeMessage, klineMessage]);

const klineRow = z.tuple([z.number(), z.string(), z.string(), z.string(), z.string()]).rest(z.unknown());

export type StreamStatus =
  | { type: "connecting"; host: string }
  | { type: "live"; host: string }
  | { type: "reconnecting"; host: string }
  | { type: "closed"; reason: string };

function readPrice(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseMarketPayload(payload: unknown): MarketEvent | null {
  const parsed = marketMessage.safeParse(payload);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (!isSymbol(message.s)) return null;

  if (message.e === "trade") {
    const price = readPrice(message.p);
    const qty = Number(message.q);
    if (price === null || !Number.isFinite(qty) || qty < 0) return null;
    return {
      type: "trade",
      symbol: message.s,
      price,
      qty,
      time: message.T,
      taker: message.m ? "sell" : "buy",
    };
  }

  if (message.k.i !== "1s") return null;
  const open = readPrice(message.k.o);
  const high = readPrice(message.k.h);
  const low = readPrice(message.k.l);
  const close = readPrice(message.k.c);
  if (open === null || high === null || low === null || close === null) return null;
  return {
    type: "kline",
    symbol: message.s,
    time: Math.floor(message.k.t / 1000),
    open,
    high,
    low,
    close,
    closed: message.k.x,
  };
}

export function parseRestKlines(payload: unknown): Candle[] {
  const rows = z.array(z.array(z.unknown())).safeParse(payload);
  if (!rows.success) return [];
  const candles: Candle[] = [];
  for (const row of rows.data) {
    const parsed = klineRow.safeParse(row);
    if (!parsed.success) continue;
    const [openTime, openRaw, highRaw, lowRaw, closeRaw] = parsed.data;
    const open = readPrice(openRaw);
    const high = readPrice(highRaw);
    const low = readPrice(lowRaw);
    const close = readPrice(closeRaw);
    if (open === null || high === null || low === null || close === null) continue;
    candles.push({
      time: Math.floor(openTime / 1000),
      open,
      high,
      low,
      close,
    });
  }
  return candles;
}

const klineResponse = z.object({
  host: z.string(),
  candles: z.array(
    z.object({
      time: z.number(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
    }),
  ),
});

export async function fetchUpstreamCandles(
  symbol: Symbol,
  limit: number,
): Promise<{ candles: Candle[]; host: string }> {
  let lastStatus = "no response";
  for (const host of REST_HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${symbol}&interval=1s&limit=${limit}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      lastStatus = `${new URL(host).host} ${response.status}`;
      continue;
    }
    const payload: unknown = await response.json();
    const candles = parseRestKlines(payload);
    if (candles.length === 0) {
      lastStatus = `${new URL(host).host} empty klines`;
      continue;
    }
    return { candles, host: new URL(host).host };
  }
  throw new Error(`Bootstrap candles unavailable (${lastStatus})`);
}

export async function fetchCandles(
  symbol: Symbol,
  limit: number,
  signal: AbortSignal,
): Promise<{ candles: Candle[]; host: string }> {
  const response = await fetch(`/api/klines?symbol=${symbol}&limit=${limit}`, {
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error : `Bootstrap candles unavailable (${response.status})`);
  }
  const parsed = klineResponse.safeParse(payload);
  if (!parsed.success || parsed.data.candles.length === 0) {
    throw new Error("Bootstrap candles unavailable");
  }
  return parsed.data;
}

type OpenSocket = { socket: WebSocket; url: string };

function hostOf(url: string): string {
  return new URL(url).host;
}

function openPreferredSocket(signal: AbortSignal): Promise<OpenSocket> {
  return new Promise<OpenSocket>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }

    let settled = false;
    const sockets: WebSocket[] = [];
    let failures = 0;

    const finish = (pick: OpenSocket) => {
      if (settled) {
        pick.socket.close();
        return;
      }
      settled = true;
      for (const socket of sockets) {
        if (socket !== pick.socket) socket.close();
      }
      resolve(pick);
    };

    const fail = () => {
      failures += 1;
      if (!settled && failures >= 2) {
        settled = true;
        reject(new Error("Market socket failed to open"));
      }
    };

    const connect = (url: string, onOpen: (socket: WebSocket) => void) => {
      const socket = new WebSocket(url);
      sockets.push(socket);
      let reported = false;
      const reportFailure = () => {
        if (reported) return;
        reported = true;
        fail();
      };
      const timer = setTimeout(() => {
        socket.close();
        reportFailure();
      }, 4000);
      socket.onopen = () => {
        clearTimeout(timer);
        onOpen(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reportFailure();
      };
    };

    let fallback: WebSocket | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;

    connect(PREFERRED_WS, (socket) => {
      if (grace) clearTimeout(grace);
      finish({ socket, url: PREFERRED_WS });
    });

    connect(FALLBACK_WS, (socket) => {
      fallback = socket;
      grace = setTimeout(() => {
        if (fallback) finish({ socket: fallback, url: FALLBACK_WS });
      }, PREFERRED_GRACE_MS);
    });

    signal.addEventListener(
      "abort",
      () => {
        if (grace) clearTimeout(grace);
        for (const socket of sockets) socket.close();
        if (!settled) {
          settled = true;
          reject(new DOMException("aborted", "AbortError"));
        }
      },
      { once: true },
    );
  });
}

export async function streamMarket(options: {
  symbol: Symbol;
  signal: AbortSignal;
  onEvent: (event: MarketEvent) => void;
  onStatus: (status: StreamStatus) => void;
}): Promise<void> {
  let attempt = 0;
  let knownUrl: string | null = null;

  while (!options.signal.aborted) {
    const reconnecting = attempt > 0;
    try {
      const opened: OpenSocket = knownUrl
        ? await openKnownSocket(knownUrl, options.signal)
        : await openPreferredSocket(options.signal);
      knownUrl = opened.url;
      if (options.signal.aborted) {
        opened.socket.close();
        return;
      }
      const host = hostOf(opened.url);
      subscribe(opened.socket, options.symbol);
      options.onStatus({ type: "live", host });
      await readUntilClose(opened.socket, options.symbol, options.onEvent);
      if (options.signal.aborted) return;
      attempt += 1;
      options.onStatus({ type: "reconnecting", host });
      await delay(Math.min(8000, 400 * 2 ** Math.min(attempt, 4)), options.signal);
    } catch (error) {
      if (isAbort(error) || options.signal.aborted) return;
      attempt += 1;
      const host = knownUrl ? hostOf(knownUrl) : hostOf(FALLBACK_WS);
      options.onStatus({
        type: reconnecting ? "reconnecting" : "connecting",
        host,
      });
      await delay(Math.min(8000, 400 * 2 ** Math.min(attempt, 4)), options.signal);
    }
  }
}

function openKnownSocket(url: string, signal: AbortSignal): Promise<OpenSocket> {
  return new Promise<OpenSocket>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`timeout ${url}`));
    }, 4000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve({ socket, url });
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`socket error ${url}`));
    };
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        socket.close();
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function subscribe(socket: WebSocket, symbol: Symbol) {
  const stream = symbol.toLowerCase();
  socket.send(
    JSON.stringify({
      method: "SUBSCRIBE",
      params: [`${stream}@trade`, `${stream}@kline_1s`],
      id: 1,
    }),
  );
}

function readUntilClose(
  socket: WebSocket,
  symbol: Symbol,
  onEvent: (event: MarketEvent) => void,
): Promise<void> {
  return new Promise((resolve) => {
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      const marketEvent = parseMarketPayload(payload);
      if (!marketEvent || marketEvent.symbol !== symbol) return;
      onEvent(marketEvent);
    };
    socket.onclose = () => resolve();
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
