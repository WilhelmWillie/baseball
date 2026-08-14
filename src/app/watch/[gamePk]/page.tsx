import { Viewer, type ViewerMode } from "@/components/Viewer";
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
    replay?: string;
  }>;
}) {
  const { gamePk } = await params;
  const { at, hour, wx, wind, replay } = await searchParams;

  const isDemo = gamePk === "demo" || Number(gamePk) === DEMO_GAME_PK;
  // A recorded game is finished by definition, so `?replay=1` can never collide
  // with the same gamePk being live.
  const isReplay = !isDemo && (replay === "1" || replay === "true");
  const mode: ViewerMode = isDemo ? "demo" : isReplay ? "replay" : "live";

  // ?at=<seconds> jumps part-way in - into the simulated game, or into a
  // recording's play-time - and ?hour= / ?wx= / ?wind= put the demo under any
  // sky you like.
  const offset = Math.max(0, Number(at ?? 0) || 0);
  const demoQuery = Object.entries({ hour, wx, wind })
    .filter(([, value]) => value)
    .map(([key, value]) => `&${key}=${encodeURIComponent(value as string)}`)
    .join("");

  return (
    <Viewer
      gamePk={isDemo ? "demo" : gamePk}
      mode={mode}
      demoOffset={isDemo ? offset : 0}
      demoQuery={demoQuery}
      startSeconds={isReplay ? offset : 0}
    />
  );
}
