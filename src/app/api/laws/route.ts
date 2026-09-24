import { loadLaws } from "@/lib/laws/loadLaws";

export async function GET() {
  const laws = await loadLaws();
  return Response.json(laws);
}
