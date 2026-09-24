import { fetchUpstreamCandles } from "@/lib/market/binance";
import { isSymbol } from "@/lib/market/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  if (!isSymbol(symbol)) {
    return Response.json({ error: "Unknown symbol" }, { status: 400 });
  }
  const rawLimit = Number(url.searchParams.get("limit") ?? "180");
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(20, Math.floor(rawLimit))) : 180;
  try {
    const result = await fetchUpstreamCandles(symbol, limit);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap candles unavailable";
    return Response.json({ error: message }, { status: 502 });
  }
}
