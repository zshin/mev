import { Dashboard } from "@/components/Dashboard";
import { loadLaws } from "@/lib/laws/loadLaws";

export default async function Home() {
  const laws = await loadLaws();
  return <Dashboard laws={laws} />;
}
