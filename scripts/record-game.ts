/**
 * Record a finished MLB game into a replayable fixture.
 *
 *   npm run record -- --date 2025-10-01 --list   list that day's finished games
 *   npm run record -- 775302                     record it
 *   npm run record -- 775302 --out /tmp/rec      write somewhere else
 *
 * Output lands in `public/recordings/v1/<gamePk>/` by default, which is where
 * the app reads recordings from in local development.
 *
 * Needs outbound access to statsapi.mlb.com. See `docs/RECORDING.md`.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { easternDate, fetchLiveFeed, fetchSchedule, isFinalStatus } from "@/lib/mlb/client";
import type { MlbLiveFeed } from "@/lib/mlb/types";
import {
  FRAMES_FILE,
  FRAME_FORMAT_VERSION,
  INDEX_FILE,
  MANIFEST_FILE,
  recordingPrefix,
  type RecordingIndexEntry,
  type RecordingManifest,
} from "@/lib/replay/format";
import {
  buildManifest,
  dedupeFrames,
  encodeFrames,
  serializeFrames,
  verifyEncoding,
} from "@/lib/replay/encode";
import { reconstructFrames } from "@/lib/replay/reconstruct";
import { validateFrames } from "@/lib/replay/validate";

const DEFAULT_OUT = "public/recordings";

interface Args {
  gamePk?: number;
  date?: string;
  from?: string;
  label?: string;
  list: boolean;
  out: string;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false, out: DEFAULT_OUT, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") args.list = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--date") args.date = requireValue(arg, argv[++i]);
    else if (arg === "--out") args.out = requireValue(arg, argv[++i]);
    else if (arg === "--from") args.from = requireValue(arg, argv[++i]);
    else if (arg === "--label") args.label = requireValue(arg, argv[++i]);
    else if (/^\d+$/.test(arg)) args.gamePk = Number(arg);
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return args;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("-")) throw new Error(`${flag} needs a value`);
  return value;
}

function usage(): void {
  console.log(
    [
      "Record a finished MLB game into a replayable fixture.",
      "",
      "  npm run record -- --date 2025-10-01 --list   list that day's finished games",
      "  npm run record -- 775302                     record it",
      "",
      "Options:",
      "  --date <YYYY-MM-DD>  schedule day to list (default: today, US Eastern)",
      "  --list               list games instead of recording",
      `  --out <dir>          output directory (default: ${DEFAULT_OUT})`,
      "  --from <file.json>   record from a saved live feed instead of fetching",
      '  --label "<name>"     what to call it, e.g. "2025 World Series Game 7"',
      "  --force              record even if the game is not final",
    ].join("\n"),
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function listGames(date: string): Promise<void> {
  const games = await fetchSchedule(date, date);
  if (games.length === 0) {
    console.log(`No games scheduled for ${date}.`);
    return;
  }
  console.log(`Games on ${date}:\n`);
  for (const game of games) {
    const away = game.teams?.away;
    const home = game.teams?.home;
    const final = isFinalStatus(game);
    console.log(
      `  ${String(game.gamePk).padEnd(8)} ` +
        `${(away?.team?.abbreviation ?? "???").padEnd(4)} ${String(away?.score ?? "-").padStart(2)} @ ` +
        `${(home?.team?.abbreviation ?? "???").padEnd(4)} ${String(home?.score ?? "-").padStart(2)}  ` +
        `${final ? "final" : (game.status?.detailedState ?? "")}`,
    );
  }
  console.log("\nRecord one with:  npm run record -- <gamePk>");
}

/** Rebuild the recorded-games index from whatever manifests are on disk. */
function writeIndex(outDir: string): number {
  const versionDir = join(outDir, `v${FRAME_FORMAT_VERSION}`);
  const entries: RecordingIndexEntry[] = [];
  for (const name of readdirSync(versionDir)) {
    const manifestPath = join(versionDir, name, MANIFEST_FILE);
    let manifest: RecordingManifest;
    try {
      if (!statSync(manifestPath).isFile()) continue;
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RecordingManifest;
    } catch {
      continue;
    }
    entries.push({
      gamePk: manifest.gamePk,
      date: manifest.game.date,
      venue: manifest.game.venue,
      label: manifest.game.label,
      home: manifest.game.home,
      away: manifest.game.away,
      frameCount: manifest.frameCount,
      durationMs: manifest.durationMs,
      source: manifest.source,
      recordedAt: manifest.recordedAt,
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.gamePk - a.gamePk);
  writeFileSync(join(versionDir, INDEX_FILE), JSON.stringify({ games: entries }, null, 2));
  return entries.length;
}

async function record(
  gamePk: number | undefined,
  outDir: string,
  force: boolean,
  from?: string,
  label?: string,
): Promise<void> {
  let final: MlbLiveFeed;
  if (from) {
    // A saved feed, for re-recording without hitting the API again.
    console.log(`Reading ${from}…`);
    final = JSON.parse(readFileSync(from, "utf8")) as MlbLiveFeed;
  } else {
    console.log(`Fetching game ${gamePk}…`);
    final = await fetchLiveFeed(gamePk as number);
  }

  const state = final.gameData?.status?.abstractGameState;
  const coded = final.gameData?.status?.codedGameState;
  const isFinished = state === "Final" || coded === "F" || coded === "O";
  if (!isFinished && !force) {
    console.error(
      `Game ${final.gamePk ?? gamePk} is "${final.gameData?.status?.detailedState ?? state}", not final.\n` +
        "Retroactive recording expects a finished game. Pass --force to record it anyway.",
    );
    process.exitCode = 1;
    return;
  }

  const away = final.gameData?.teams?.away?.abbreviation ?? "AWAY";
  const home = final.gameData?.teams?.home?.abbreviation ?? "HOME";
  console.log(
    `  ${away} @ ${home} — ${final.gameData?.datetime?.officialDate ?? "?"}` +
      (label ? ` — "${label}"` : ""),
  );

  console.log("Reconstructing the feed stream…");
  const all = reconstructFrames(final);
  const frames = dedupeFrames(all);
  if (frames.length === 0) {
    console.error("Reconstruction produced no frames — the feed has no plays.");
    process.exitCode = 1;
    return;
  }
  console.log(`  ${all.length} moments → ${frames.length} frames kept`);

  console.log("Validating against the normalizer…");
  const report = validateFrames(frames, final);
  for (const warning of report.warnings) console.log(`  warning: ${warning}`);
  for (const error of report.errors) console.error(`  error:   ${error}`);
  if (!report.ok) {
    console.error("\nValidation failed — not writing the recording.");
    process.exitCode = 1;
    return;
  }

  const manifest = buildManifest({ final, frames, source: "reconstructed", label });
  console.log("Encoding…");
  const lines = encodeFrames(manifest.gamePk, frames);

  console.log("Verifying the encoded stream rebuilds the frames…");
  const encodingErrors = verifyEncoding(lines, frames);
  for (const error of encodingErrors) console.error(`  error:   ${error}`);
  if (encodingErrors.length > 0) {
    console.error("\nEncoding check failed — not writing the recording.");
    process.exitCode = 1;
    return;
  }

  const framesBody = gzipSync(Buffer.from(serializeFrames(lines)), { level: 9 });
  const manifestBody = Buffer.from(JSON.stringify(manifest));

  const dir = join(outDir, recordingPrefix(manifest.gamePk));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FRAMES_FILE), framesBody);
  writeFileSync(join(dir, MANIFEST_FILE), manifestBody);
  const indexed = writeIndex(outDir);

  const rawBytes = Buffer.byteLength(JSON.stringify(final));
  console.log(
    [
      "",
      `  ${away} ${report.finalScore.away} @ ${home} ${report.finalScore.home}` +
        ` — ${report.innings} innings`,
      `  frames        ${report.counts.frames}`,
      `  at-bats       ${report.counts.atBats}`,
      `  pitches       ${report.counts.pitches}`,
      `  play results  ${report.counts.playResults}`,
      `  actions       ${report.counts.actions}`,
      `  real duration ${formatDuration(manifest.durationMs)}`,
      `  markers       ${manifest.markers.length}`,
      "",
      `  frames.ndjson.gz  ${formatBytes(framesBody.byteLength)}`,
      `  manifest.json     ${formatBytes(manifestBody.byteLength)}`,
      `  vs one raw feed   ${formatBytes(rawBytes)}` +
        ` (${(rawBytes / framesBody.byteLength).toFixed(1)}× the whole recording)`,
      "",
      `  written to ${dir}`,
      `  index now lists ${indexed} recording(s)`,
    ].join("\n"),
  );
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
  if (args.list || (!args.gamePk && !args.from && args.date)) {
    await listGames(args.date ?? easternDate());
    return;
  }
  if (!args.gamePk && !args.from) {
    usage();
    return;
  }
  await record(args.gamePk, args.out, args.force, args.from, args.label);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
