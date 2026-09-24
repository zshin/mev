import { JEV_MODEL, type JevHealth } from "@/lib/jev/contract";

type KeyEnv = {
  TYPESAFE_API_KEY?: string | undefined;
  [key: string]: string | undefined;
};

/** Trimmed key, or undefined when the desk should stay on the local surface. */
export function readTypesafeApiKey(env: KeyEnv): string | undefined {
  const raw = env.TYPESAFE_API_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

/** Reports whether a key is set. The returned object never contains the key. */
export function jevHealth(env: KeyEnv): JevHealth {
  return { configured: readTypesafeApiKey(env) !== undefined, model: JEV_MODEL };
}
