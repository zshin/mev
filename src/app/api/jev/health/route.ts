import { jevHealth } from "@/lib/jev/keyStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(jevHealth({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY }));
}
