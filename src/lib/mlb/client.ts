import type { MlbLiveFeed, MlbSchedule, MlbScheduleGame } from "./types";

const BASE = "https://statsapi.mlb.com/api";

export class MlbApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MlbApiError";
  }
}

async function getJson<T>(url: string, revalidateSeconds: number): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "mlb-3d-viewer" },
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new MlbApiError(`MLB API responded ${res.status} for ${url}`, res.status);
  }
  return (await res.json()) as T;
}

/** The current baseball date - MLB's schedule day runs on US Eastern time. */
export function easternDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function fetchSchedule(startDate: string, endDate: string): Promise<MlbScheduleGame[]> {
  const url =
    `${BASE}/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}` +
    `&hydrate=team,linescore,venue,game(content(summary))`;
  const schedule = await getJson<MlbSchedule>(url, 20);
  const games: MlbScheduleGame[] = [];
  for (const date of schedule.dates ?? []) {
    for (const game of date.games ?? []) games.push(game);
  }
  return games;
}

/**
 * One game's schedule entry - teams, venue, status, score. Far cheaper than
 * the live feed when all that is wanted is who is playing.
 */
export async function fetchScheduleGame(gamePk: number): Promise<MlbScheduleGame | null> {
  const url = `${BASE}/v1/schedule?sportId=1&gamePk=${gamePk}&hydrate=team,linescore,venue`;
  const schedule = await getJson<MlbSchedule>(url, 60);
  for (const date of schedule.dates ?? []) {
    for (const game of date.games ?? []) {
      if (game.gamePk === gamePk) return game;
    }
  }
  return null;
}

export async function fetchLiveFeed(gamePk: number): Promise<MlbLiveFeed> {
  return getJson<MlbLiveFeed>(`${BASE}/v1.1/game/${gamePk}/feed/live`, 0);
}

export function isLiveStatus(game: MlbScheduleGame): boolean {
  const abstract = game.status?.abstractGameState;
  const coded = game.status?.codedGameState;
  // "I" = in progress, "M" = manager challenge, "P"/"PW" = warmup.
  return abstract === "Live" || coded === "I" || coded === "M";
}

export function isFinalStatus(game: MlbScheduleGame): boolean {
  return game.status?.abstractGameState === "Final";
}
