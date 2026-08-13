import { Viewer } from "@/components/Viewer";
import { DEMO_GAME_PK } from "@/lib/sim/feed";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ gamePk: string }>;
  searchParams: Promise<{
    at?: string;
    hour?: string;
    wx?: string;
    wind?: string;
    lag?: string;
  }>;
}) {
  const { gamePk } = await params;
  const { at, hour, wx, wind, lag } = await searchParams;
  const isDemo = gamePk === "demo" || Number(gamePk) === DEMO_GAME_PK;
  // ?at=<seconds> jumps into the simulated game part-way through, and
  // ?hour= / ?wx= / ?wind= put it under any sky you like. ?lag=<seconds> slows
  // the simulated feed's results down, which is how the pitch/result fusion is
  // tested against a feed that takes its time.
  const offset = isDemo ? Math.max(0, Number(at ?? 0) || 0) : 0;
  const demoQuery = Object.entries({ hour, wx, wind, lag })
    .filter(([, value]) => value)
    .map(([key, value]) => `&${key}=${encodeURIComponent(value as string)}`)
    .join("");
  return (
    <Viewer
      gamePk={isDemo ? "demo" : gamePk}
      isDemo={isDemo}
      demoOffset={offset}
      demoQuery={demoQuery}
    />
  );
}
