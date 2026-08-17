import { NextResponse } from "next/server";
import { fetchLiveFeed } from "@/lib/mlb/client";
import { buildClip, type ClipBundle } from "@/lib/replay/clip";

export const dynamic = "force-dynamic";

/**
 * One plate appearance, as a recording the client can play.
 *
 * Cut on demand rather than stored. A clip is `(gamePk, atBatIndex)` and
 * nothing else, so there is no database here and no publish step: the play is
 * rebuilt out of the game's feed every time, which is also why a link minted
 * during a live game still works long after the game ends.
 */

/**
 * Reconstructing a game to cut one at-bat out of it is the expensive part, and
 * a clip that spreads is asked for the same at-bat over and over. Same shape as
 * the live-feed proxy's cache next door, keyed by the clip rather than the game.
 */
const CACHE_LIMIT = 64;
const cache = new Map<string, ClipBundle>();

function remember(key: string, bundle: ClipBundle): void {
  cache.set(key, bundle);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gamePk: string; atBatIndex: string }> },
) {
  const { gamePk: rawGame, atBatIndex: rawAtBat } = await params;
  const gamePk = Number(rawGame);
  const atBatIndex = Number(rawAtBat);
  if (!Number.isInteger(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid gamePk" }, { status: 400 });
  }
  if (!Number.isInteger(atBatIndex) || atBatIndex < 0) {
    return NextResponse.json({ error: "Invalid at-bat" }, { status: 400 });
  }

  const key = `${gamePk}:${atBatIndex}`;
  const hit = cache.get(key);
  if (hit) {
    return NextResponse.json(hit, { headers: { "Cache-Control": cacheControl(true) } });
  }

  try {
    const feed = await fetchLiveFeed(gamePk);
    const bundle = buildClip(feed, atBatIndex);
    if (!bundle) {
      // Either there is no such at-bat, or it is still being played. Both are
      // "nothing to watch here" as far as a link is concerned.
      return NextResponse.json({ error: "No such play" }, { status: 404 });
    }

    // A finished game's plays are settled for good; a live game's most recent
    // one can still be amended by a replay review, so only cache what cannot
    // change under us.
    const isFinal = feed.gameData?.status?.abstractGameState === "Final";
    if (isFinal) remember(key, bundle);
    return NextResponse.json(bundle, { headers: { "Cache-Control": cacheControl(isFinal) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * A finished play never changes, so its clip can be cached as hard as anything
 * gets. During a live game the play the clip came from is complete but still
 * reviewable, which is worth a short window rather than none.
 */
function cacheControl(isFinal: boolean): string {
  return isFinal
    ? "public, max-age=31536000, immutable"
    : "public, max-age=60, stale-while-revalidate=600";
}
