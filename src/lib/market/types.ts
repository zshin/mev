export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

export type Symbol = (typeof SYMBOLS)[number];

export type TakerSide = "buy" | "sell";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketEvent =
  | {
      type: "trade";
      symbol: Symbol;
      price: number;
      qty: number;
      time: number;
      taker: TakerSide;
    }
  | {
      type: "kline";
      symbol: Symbol;
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      closed: boolean;
    };

export function isSymbol(value: string): value is Symbol {
  return (SYMBOLS as readonly string[]).includes(value);
}

export function baseAsset(symbol: Symbol): string {
  switch (symbol) {
    case "BTCUSDT":
      return "BTC";
    case "ETHUSDT":
      return "ETH";
    case "SOLUSDT":
      return "SOL";
    default: {
      const unreachable: never = symbol;
      return unreachable;
    }
  }
}
