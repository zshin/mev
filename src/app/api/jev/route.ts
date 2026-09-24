import { askJev, type AskJevResult } from "@/lib/jev/askJev";
import { closedResult, deskStateSchema, type HostResult } from "@/lib/jev/contract";
import { readTypesafeApiKey } from "@/lib/jev/keyStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(closedResult("malformed", 0));
  }
  const parsed = deskStateSchema.safeParse(body);
  if (!parsed.success) return Response.json(closedResult("malformed", 0));
  try {
    const result = await askJev({
      state: parsed.data,
      apiKey: readTypesafeApiKey({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY }),
      signal: request.signal,
    });
    return Response.json(hostResult(result));
  } catch {
    return Response.json(closedResult("unavailable", 0));
  }
}

function hostResult(result: AskJevResult): HostResult {
  switch (result.type) {
    case "choice":
    case "closed":
      return result;
    case "aborted":
      return closedResult("timeout", result.latencyMs);
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}
