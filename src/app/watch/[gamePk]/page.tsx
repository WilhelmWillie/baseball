import { Viewer } from "@/components/Viewer";
import { DEMO_GAME_PK } from "@/lib/sim/feed";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ gamePk: string }>;
  searchParams: Promise<{ at?: string }>;
}) {
  const { gamePk } = await params;
  const { at } = await searchParams;
  const isDemo = gamePk === "demo" || Number(gamePk) === DEMO_GAME_PK;
  // ?at=<seconds> jumps into the simulated game part-way through.
  const offset = isDemo ? Math.max(0, Number(at ?? 0) || 0) : 0;
  return <Viewer gamePk={isDemo ? "demo" : gamePk} isDemo={isDemo} demoOffset={offset} />;
}
