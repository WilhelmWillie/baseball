import { NextResponse } from "next/server";
import { fetchLiveFeed } from "@/lib/mlb/client";
import type { MlbLiveFeed } from "@/lib/mlb/types";

export const dynamic = "force-dynamic";

/**
 * Short-lived cache so several viewers on one game do not multiply the load we
 * put on the Stats API.
 */
const CACHE_MS = 3000;
const cache = new Map<number, { at: number; body: unknown }>();

/**
 * Finished games, kept apart from the live ones.
 *
 * A final feed is the whole of a replayable game - the browser rebuilds ~500
 * frames out of it - and it can never change again, so it has no business
 * expiring on a three-second timer meant for a game in progress. It is also
 * ~800 KB, and season browsing means people opening games nobody has watched in
 * months, so the entry that survives here is worth more than a live one.
 */
const FINAL_LIMIT = 24;
const finals = new Map<number, MlbLiveFeed>();

function isFinal(feed: MlbLiveFeed): boolean {
  const status = feed.gameData?.status;
  return (
    status?.abstractGameState === "Final" ||
    status?.codedGameState === "F" ||
    status?.codedGameState === "O"
  );
}

/**
 * A finished game never changes; a game in progress changes every pitch.
 *
 * The immutable half is what makes season-wide replay affordable: one viewer's
 * fetch is every subsequent viewer's cache hit, at the browser and at whatever
 * CDN sits in front of us, so the Stats API sees one read per game rather than
 * one per viewing. Same judgement `/api/clip` makes next door.
 */
function cacheControl(final: boolean): string {
  return final ? "public, max-age=31536000, immutable" : "no-store";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gamePk: string }> },
) {
  const { gamePk: raw } = await params;
  const gamePk = Number(raw);
  if (!Number.isInteger(gamePk) || gamePk <= 0) {
    return NextResponse.json({ error: "Invalid gamePk" }, { status: 400 });
  }

  const settled = finals.get(gamePk);
  if (settled) {
    return NextResponse.json(settled, { headers: { "Cache-Control": cacheControl(true) } });
  }

  const hit = cache.get(gamePk);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.body, { headers: { "Cache-Control": cacheControl(false) } });
  }

  try {
    const feed = await fetchLiveFeed(gamePk);
    const final = isFinal(feed);
    if (final) {
      finals.set(gamePk, feed);
      if (finals.size > FINAL_LIMIT) {
        // Insertion order is oldest-first, and every entry here is equally
        // valid forever, so the least recently *added* is the one to drop.
        const oldest = finals.keys().next().value;
        if (oldest !== undefined) finals.delete(oldest);
      }
      // A game that has just ended may still be sitting in the live cache with
      // its last pitch un-final; the settled copy supersedes it.
      cache.delete(gamePk);
    } else {
      cache.set(gamePk, { at: Date.now(), body: feed });
      if (cache.size > 32) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
    }
    return NextResponse.json(feed, { headers: { "Cache-Control": cacheControl(final) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
