import { closedResult, hostResultSchema, type DeskState, type HostResult } from "@/lib/jev/contract";

/** Browser call to this app's route. The TypeSafe key stays on the server. */
export async function requestLiveChoice(
  state: DeskState,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<HostResult> {
  try {
    const response = await fetchImpl("/api/jev", {
      method: "POST",
      cache: "no-store",
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(state),
    });
    const json: unknown = await response.json();
    const parsed = hostResultSchema.safeParse(json);
    if (!parsed.success) return closedResult("malformed", 0);
    return parsed.data;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return closedResult("unavailable", 0);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
