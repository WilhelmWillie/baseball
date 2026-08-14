import { NextResponse } from "next/server";
import { fetchLiveFeed } from "@/lib/mlb/client";
import { buildDemoFeed, DEMO_GAME_PK } from "@/lib/sim/feed";

export const dynamic = "force-dynamic";

/**
 * Short-lived cache so several viewers on one game do not multiply the load we
 * put on the Stats API.
 */
const CACHE_MS = 3000;
const cache = new Map<number, { at: number; body: unknown }>();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gamePk: string }> },
) {
  const { gamePk: raw } = await params;

  if (raw === "demo" || Number(raw) === DEMO_GAME_PK) {
    const query = new URL(request.url).searchParams;
    const elapsed = Number(query.get("t") ?? "0");
    // Time of day and weather are overridable so the lighting can be seen
    // without waiting for a real game to be played at dusk in the rain.
    const hour = Number(query.get("hour"));
    // How long the demo sits on a result before publishing it, so the slow
    // feed the pitch/result fusion has to survive can be reproduced on demand.
    const lag = Number(query.get("lag"));
    return NextResponse.json(
      buildDemoFeed(
        Number.isFinite(elapsed) ? elapsed : 0,
        {
          hour: Number.isFinite(hour) && query.has("hour") ? hour : undefined,
          condition: query.get("wx") ?? undefined,
          wind: query.get("wind") ?? undefined,
        },
        Number.isFinite(lag) && query.has("lag") ? lag : undefined,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const gamePk = Number(raw);
  if (!Number.isInteger(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid gamePk" }, { status: 400 });
  }

  const hit = cache.get(gamePk);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.body, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const feed = await fetchLiveFeed(gamePk);
    cache.set(gamePk, { at: Date.now(), body: feed });
    if (cache.size > 32) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
