/**
 * Check that a season's games can be rebuilt from their feeds.
 *
 *   npm run validate-season                        opening day → today
 *   npm run validate-season -- --from 2026-06-01   a narrower window
 *   npm run validate-season -- --from 2026-06-01 --to 2026-06-07
 *   npm run validate-season -- --every 7           one day in seven, as a sweep
 *
 * `/watch/<gamePk>` rebuilds a finished game in the browser out of MLB's final
 * feed, with no recording behind it. That makes `reconstructFrames` load-bearing
 * for every game ever played rather than for the handful anybody thought to
 * publish, and this is how we find out - before somebody following a link does -
 * which games it cannot rebuild.
 *
 * It runs the same `validateFrames` the recorder runs, which walks a game
 * through the real `buildSnapshot`/`extractEvents` path. Serial by design: a
 * full season is ~1,950 feeds of ~800 KB, and there is no hurry worth being
 * rude to a free API over.
 *
 * Needs outbound access to statsapi.mlb.com.
 */
import { writeFileSync } from "node:fs";
import { easternDate, fetchLiveFeed, fetchSchedule, isFinalStatus } from "@/lib/mlb/client";
import type { MlbScheduleGame } from "@/lib/mlb/types";
import { SEASON_OPENING_DAY, shiftDay } from "@/lib/game/schedule";
import { dedupeFrames } from "@/lib/replay/encode";
import { reconstructFrames } from "@/lib/replay/reconstruct";
import { validateFrames } from "@/lib/replay/validate";

/** Game types worth checking: the season proper, plus October and the All-Star Game. */
const TYPES = new Set(["R", "F", "D", "L", "W", "A"]);

interface Args {
  from: string;
  to: string;
  every: number;
  out?: string;
  help: boolean;
}

interface Failure {
  gamePk: number;
  date: string;
  matchup: string;
  reason: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: SEASON_OPENING_DAY, to: easternDate(), every: 1, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--from") args.from = requireValue(arg, argv[++i]);
    else if (arg === "--to") args.to = requireValue(arg, argv[++i]);
    else if (arg === "--every") args.every = Number(requireValue(arg, argv[++i]));
    else if (arg === "--out") args.out = requireValue(arg, argv[++i]);
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!Number.isInteger(args.every) || args.every < 1) throw new Error("--every needs a whole number of days");
  return args;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${flag} needs a value`);
  return value;
}

function usage(): void {
  console.log(
    [
      "Check that a season's games can be rebuilt from their feeds.",
      "",
      "  npm run validate-season",
      "  npm run validate-season -- --from 2026-06-01 --to 2026-06-07",
      "  npm run validate-season -- --every 7",
      "",
      "Options:",
      `  --from <YYYY-MM-DD>  first day (default: ${SEASON_OPENING_DAY})`,
      "  --to <YYYY-MM-DD>    last day (default: today, US Eastern)",
      "  --every <n>          check one day in every n, as a sweep",
      "  --out <file.json>    write the failures somewhere",
    ].join("\n"),
  );
}

function matchupOf(game: MlbScheduleGame): string {
  const away = game.teams?.away?.team?.abbreviation ?? "???";
  const home = game.teams?.home?.team?.abbreviation ?? "???";
  return `${away} @ ${home}`;
}

async function check(game: MlbScheduleGame, date: string): Promise<Failure | null> {
  const matchup = matchupOf(game);
  try {
    const feed = await fetchLiveFeed(game.gamePk);
    const frames = dedupeFrames(reconstructFrames(feed));
    if (frames.length === 0) {
      return { gamePk: game.gamePk, date, matchup, reason: "no frames" };
    }
    const report = validateFrames(frames, feed);
    if (!report.ok) {
      return { gamePk: game.gamePk, date, matchup, reason: report.errors.join(" | ") };
    }
    return null;
  } catch (error) {
    return {
      gamePk: game.gamePk,
      date,
      matchup,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  console.log(
    `Checking ${args.from} → ${args.to}` +
      (args.every > 1 ? `, one day in ${args.every}` : "") +
      "\n",
  );

  const failures: Failure[] = [];
  let days = 0;
  let checked = 0;
  const started = Date.now();

  for (let date = args.from; date <= args.to; date = shiftDay(date, args.every)) {
    days += 1;
    let games: MlbScheduleGame[];
    try {
      games = await fetchSchedule(date, date);
    } catch (error) {
      console.log(`${date}  schedule unavailable: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    const playable = games.filter((game) => isFinalStatus(game) && TYPES.has(game.gameType ?? ""));
    if (playable.length === 0) continue;

    const bad: Failure[] = [];
    for (const game of playable) {
      const failure = await check(game, date);
      checked += 1;
      if (failure) {
        bad.push(failure);
        failures.push(failure);
      }
    }

    console.log(
      `${date}  ${String(playable.length).padStart(2)} game(s)  ` +
        (bad.length === 0
          ? "all rebuilt"
          : `${bad.length} FAILED: ${bad.map((f) => `${f.gamePk} ${f.matchup}`).join(", ")}`),
    );
    for (const failure of bad) console.log(`    ${failure.gamePk}: ${failure.reason}`);
  }

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    [
      "",
      `  days     ${days}`,
      `  games    ${checked}`,
      `  failed   ${failures.length}`,
      `  elapsed  ${minutes} min`,
    ].join("\n"),
  );

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ from: args.from, to: args.to, failures }, null, 2));
    console.log(`\n  failures written to ${args.out}`);
  }

  // A failing game is a game somebody can open and be shown nothing, so this
  // exits non-zero: it is meant to be runnable as a check, not only read.
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
