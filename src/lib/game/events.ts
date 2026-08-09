import {
  BASE_ORDER,
  clampToField,
  hitCoordinatesToField,
  nearestFielder,
  wallDistance,
  type BaseId,
} from "@/lib/field/geometry";
import type { MlbLiveFeed, MlbPlay, MlbPlayEvent, MlbRunner } from "@/lib/mlb/types";
import type {
  ActionEvent,
  BattedBall,
  FeedCursor,
  InningChangeEvent,
  NormalizedEvent,
  PitchEvent,
  PitchOutcome,
  PlayResultEvent,
  RunnerMove,
} from "./types";

/** Stable hash so a given play always synthesizes the same trajectory. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function baseFromCode(code: string | null | undefined): BaseId | null {
  switch (code) {
    case "1B":
      return "first";
    case "2B":
      return "second";
    case "3B":
      return "third";
    case "4B":
    case "score":
      return "home";
    default:
      return null;
  }
}

/** Linear progress around the bases: home 0, first 1, ... scored 4. */
function progressOf(code: string | null | undefined): number {
  switch (code) {
    case "1B":
      return 1;
    case "2B":
      return 2;
    case "3B":
      return 3;
    case "4B":
    case "score":
      return 4;
    default:
      return 0;
  }
}

export function runnerProgress(move: RunnerMove): { from: number; to: number } {
  const from = BASE_ORDER.indexOf(move.from);
  if (move.to === "out") {
    return { from, to: move.outAt ? BASE_ORDER.indexOf(move.outAt) : from + 1 };
  }
  return { from, to: move.isScoring ? 4 : BASE_ORDER.indexOf(move.to) };
}

/**
 * A play's `runners` array carries one entry per credited movement, so a single
 * runner can appear several times. Collapse to one move per runner: the
 * furthest base they reached, or the base they were retired at.
 */
export function normalizeRunners(runners: MlbRunner[] | undefined): RunnerMove[] {
  if (!runners?.length) return [];
  const byId = new Map<number, RunnerMove & { _fromP: number; _toP: number }>();

  for (const runner of runners) {
    const person = runner.details?.runner;
    if (!person?.id) continue;
    const startCode = runner.movement?.originBase ?? runner.movement?.start ?? null;
    const startP = progressOf(startCode);
    const existing = byId.get(person.id);

    if (!existing) {
      byId.set(person.id, {
        playerId: person.id,
        name: person.fullName ?? "Runner",
        from: baseFromCode(startCode) ?? "home",
        to: "home",
        isScoring: false,
        _fromP: startP,
        _toP: startP,
      });
    } else if (startP < existing._fromP) {
      existing.from = baseFromCode(startCode) ?? "home";
      existing._fromP = startP;
    }

    const entry = byId.get(person.id)!;
    if (entry.to === "out") continue; // Retired: nothing after this matters.

    if (runner.movement?.isOut) {
      const outAt = baseFromCode(runner.movement.outBase);
      entry.to = "out";
      entry.outAt = outAt ?? undefined;
      entry._toP = progressOf(runner.movement.outBase);
      entry.isScoring = false;
      continue;
    }

    const endP = progressOf(runner.movement?.end);
    if (endP >= entry._toP) {
      entry._toP = endP;
      entry.isScoring = endP === 4;
      entry.to = entry.isScoring ? "home" : baseFromCode(runner.movement?.end) ?? entry.to;
    }
  }

  return [...byId.values()]
    .filter((m) => m.to === "out" || m._toP !== m._fromP || m.isScoring)
    .map((entry): RunnerMove => ({
      playerId: entry.playerId,
      name: entry.name,
      from: entry.from,
      to: entry.to,
      outAt: entry.outAt,
      isScoring: entry.isScoring,
    }));
}

const TRAJECTORY_MAP: Record<string, BattedBall["trajectory"]> = {
  ground_ball: "ground_ball",
  line_drive: "line_drive",
  fly_ball: "fly_ball",
  popup: "popup",
  bunt_grounder: "bunt",
  bunt_popup: "bunt",
  bunt_line_drive: "bunt",
};

/** Rough spray angle implied by the play description, in radians. */
function angleFromDescription(text: string, seed: number): number | null {
  const t = text.toLowerCase();
  const jitter = (seed - 0.5) * 0.12;
  if (/left center|left-center/.test(t)) return -0.38 + jitter;
  if (/right center|right-center/.test(t)) return 0.38 + jitter;
  if (/left field|left fielder|to left|shortstop|third base/.test(t)) return -0.62 + jitter;
  if (/right field|right fielder|to right|second base|first base/.test(t)) return 0.62 + jitter;
  if (/center field|center fielder|to center|pitcher/.test(t)) return 0 + jitter;
  return null;
}

function battedBallFrom(
  play: MlbPlay,
  event: MlbPlayEvent | undefined,
  seed: number,
  opts: { isHomeRun: boolean; isFoul: boolean; batSide: "R" | "L" },
): BattedBall {
  const hit = event?.hitData;
  const description = play.result?.description ?? event?.details?.description ?? "";
  let lateral: number | null = null;
  let depth: number | null = null;

  const coordX = hit?.coordinates?.coordX;
  const coordY = hit?.coordinates?.coordY;
  if (typeof coordX === "number" && typeof coordY === "number") {
    const mapped = hitCoordinatesToField(coordX, coordY);
    lateral = mapped.lateral;
    depth = mapped.depth;
  }

  const trajectory = TRAJECTORY_MAP[hit?.trajectory ?? ""] ?? "unknown";

  if (lateral == null || depth == null || (Math.abs(lateral) < 1 && depth < 1)) {
    // No usable coordinates - synthesize something plausible from the text.
    const angle =
      angleFromDescription(description, seed) ??
      (opts.batSide === "R" ? -0.35 : 0.35) + (seed - 0.5) * 0.5;
    const distance = opts.isHomeRun
      ? wallDistance(angle) + 20 + seed * 60
      : hit?.totalDistance ?? 150 + seed * 180;
    lateral = Math.sin(angle) * distance;
    depth = Math.cos(angle) * distance;
  }

  if (opts.isFoul) {
    // Push the ball outside the nearest foul line so it reads as foul.
    const side = lateral === 0 ? (opts.batSide === "R" ? -1 : 1) : Math.sign(lateral);
    const dist = Math.max(60, Math.hypot(lateral, depth));
    const angle = side * (Math.PI / 4 + 0.12 + seed * 0.5);
    lateral = Math.sin(angle) * dist;
    depth = Math.cos(angle) * dist;
  }

  const raw = { lateral, depth };
  const spot = opts.isHomeRun ? raw : clampToField(raw.lateral, raw.depth);
  const distance = hit?.totalDistance ?? Math.hypot(spot.lateral, spot.depth);

  return {
    lateral: spot.lateral,
    depth: spot.depth,
    distance,
    launchAngle: hit?.launchAngle,
    launchSpeed: hit?.launchSpeed,
    trajectory,
    isHomeRun: opts.isHomeRun,
    isFoul: opts.isFoul,
    fielder: nearestFielder(spot.lateral, spot.depth),
  };
}

function pitchOutcome(event: MlbPlayEvent): PitchOutcome {
  const d = event.details;
  if (d?.isInPlay) return "in_play";
  const code = d?.call?.code ?? d?.code;
  if (code === "H") return "hit_by_pitch";
  if (d?.isBall) return "ball";
  switch (code) {
    case "F":
    case "R":
    case "L":
    case "T":
    case "O":
      return "foul";
    case "S":
    case "W":
    case "M":
    case "Q":
      return "swinging_strike";
    case "C":
      return "called_strike";
    default:
      return d?.isStrike ? "called_strike" : "other";
  }
}

const KIND_MAP: Record<string, PlayResultEvent["kind"]> = {
  single: "single",
  double: "double",
  triple: "triple",
  home_run: "home_run",
  walk: "walk",
  intent_walk: "walk",
  strikeout: "strikeout",
  strike_out: "strikeout",
  strikeout_double_play: "strikeout",
  strikeout_triple_play: "strikeout",
  hit_by_pitch: "hit_by_pitch",
  field_out: "field_out",
  force_out: "field_out",
  fielders_choice: "field_out",
  fielders_choice_out: "field_out",
  sac_bunt: "field_out",
  sac_bunt_double_play: "double_play",
  grounded_into_double_play: "double_play",
  double_play: "double_play",
  triple_play: "double_play",
  field_error: "error",
  error: "error",
  sac_fly: "sac_fly",
  sac_fly_double_play: "sac_fly",
};

function kindOf(eventType: string | undefined): PlayResultEvent["kind"] {
  return KIND_MAP[eventType ?? ""] ?? "generic";
}

function batSideOf(play: MlbPlay): "R" | "L" {
  return play.matchup?.batSide?.code === "L" ? "L" : "R";
}

function atBatIndexOf(play: MlbPlay, fallback: number): number {
  return play.about?.atBatIndex ?? play.atBatIndex ?? fallback;
}

/** Position the cursor at the live edge without emitting anything. */
export function seedCursor(feed: MlbLiveFeed): FeedCursor {
  const plays = feed.liveData?.plays?.allPlays ?? [];
  const linescore = feed.liveData?.linescore;
  const last = plays[plays.length - 1];
  const lastIndex = last ? atBatIndexOf(last, plays.length - 1) : -1;
  const lastEvent = last?.playEvents?.length ? last.playEvents.length - 1 : -1;
  return {
    atBatIndex: lastIndex,
    eventIndex: lastEvent,
    completedAtBats: plays
      .filter((p) => p.about?.isComplete)
      .map((p, i) => atBatIndexOf(p, i)),
    inning: linescore?.currentInning ?? 1,
    isTopInning: linescore?.isTopInning ?? true,
  };
}

/**
 * Walk the feed forward from `cursor` and emit everything that is new.
 * Pitches stream as they land; a play's result is only emitted once MLB marks
 * the play complete, which is when runner movement is final.
 */
export function extractEvents(
  feed: MlbLiveFeed,
  cursor: FeedCursor,
): { events: NormalizedEvent[]; cursor: FeedCursor } {
  const plays = feed.liveData?.plays?.allPlays ?? [];
  const linescore = feed.liveData?.linescore;
  const events: NormalizedEvent[] = [];
  const completed = new Set(cursor.completedAtBats);

  let maxAtBat = cursor.atBatIndex;
  let maxEvent = cursor.eventIndex;

  for (let i = 0; i < plays.length; i++) {
    const play = plays[i];
    const atBatIndex = atBatIndexOf(play, i);
    if (atBatIndex < cursor.atBatIndex) continue;

    const playEvents = play.playEvents ?? [];
    const startFrom = atBatIndex === cursor.atBatIndex ? cursor.eventIndex : -1;
    const batSide = batSideOf(play);
    let sawInPlay = false;

    for (let j = 0; j < playEvents.length; j++) {
      const event = playEvents[j];
      const eventIndex = event.index ?? j;
      if (atBatIndex === cursor.atBatIndex && eventIndex <= startFrom) continue;

      if (event.isPitch) {
        const outcome = pitchOutcome(event);
        if (outcome === "in_play") sawInPlay = true;
        const pitch: PitchEvent = {
          id: `${atBatIndex}-${eventIndex}-pitch`,
          type: "pitch",
          atBatIndex,
          eventIndex,
          outcome,
          pitchType: event.details?.type?.description,
          speed: event.pitchData?.startSpeed,
          plate: {
            x: event.pitchData?.coordinates?.pX ?? 0,
            z: event.pitchData?.coordinates?.pZ ?? 2.5,
          },
          strikeZone: {
            top: event.pitchData?.strikeZoneTop ?? 3.4,
            bottom: event.pitchData?.strikeZoneBottom ?? 1.6,
          },
          batterId: play.matchup?.batter?.id,
          pitcherId: play.matchup?.pitcher?.id,
          batSide,
          description: event.details?.description ?? event.details?.call?.description ?? "Pitch",
          count: { balls: event.count?.balls ?? 0, strikes: event.count?.strikes ?? 0 },
          startsPlay: outcome === "in_play",
        };
        events.push(pitch);
      } else if (event.type === "action" || event.details?.event) {
        const action: ActionEvent = {
          id: `${atBatIndex}-${eventIndex}-action`,
          type: "action",
          atBatIndex,
          eventIndex,
          eventType: event.details?.eventType ?? "action",
          description: event.details?.description ?? event.details?.event ?? "",
          runners: [],
        };
        events.push(action);
      }

      if (atBatIndex >= maxAtBat) {
        maxAtBat = atBatIndex;
        maxEvent = eventIndex;
      }
    }

    if (play.about?.isComplete && !completed.has(atBatIndex)) {
      completed.add(atBatIndex);
      const eventType = play.result?.eventType;
      const kind = kindOf(eventType);
      const hitEvent = [...playEvents].reverse().find((e) => e.hitData);
      const seed = hash(`${atBatIndex}:${play.result?.description ?? ""}`);
      const hasContact = sawInPlay || Boolean(hitEvent);

      const result: PlayResultEvent = {
        id: `${atBatIndex}-result`,
        type: "play_result",
        atBatIndex,
        eventType: eventType ?? "unknown",
        event: play.result?.event ?? "Play",
        description: play.result?.description ?? play.result?.event ?? "",
        kind,
        ball: hasContact
          ? battedBallFrom(play, hitEvent, seed, {
              isHomeRun: kind === "home_run",
              isFoul: false,
              batSide,
            })
          : undefined,
        runners: normalizeRunners(play.runners),
        rbi: play.result?.rbi ?? 0,
        isScoringPlay: Boolean(play.about?.isScoringPlay),
        outsAfter: play.count?.outs ?? 0,
        scoreAfter: {
          home: play.result?.homeScore ?? 0,
          away: play.result?.awayScore ?? 0,
        },
      };
      events.push(result);
      if (atBatIndex > maxAtBat) maxAtBat = atBatIndex;
    }
  }

  const inning = linescore?.currentInning ?? cursor.inning;
  const isTopInning = linescore?.isTopInning ?? cursor.isTopInning;
  if (inning !== cursor.inning || isTopInning !== cursor.isTopInning) {
    const change: InningChangeEvent = {
      id: `inning-${inning}-${isTopInning ? "top" : "bot"}`,
      type: "inning_change",
      inning,
      isTopInning,
      description: `${isTopInning ? "Top" : "Bottom"} ${linescore?.currentInningOrdinal ?? inning}`,
    };
    events.push(change);
  }

  return {
    events,
    cursor: {
      atBatIndex: maxAtBat,
      eventIndex: maxEvent,
      // Only the tail matters; keep the list from growing without bound.
      completedAtBats: [...completed].slice(-40),
      inning,
      isTopInning,
    },
  };
}

/** Foul balls come through as pitches; build their trajectory on demand. */
export function foulBallFor(pitch: PitchEvent): BattedBall {
  const seed = hash(pitch.id);
  return battedBallFrom(
    {},
    undefined,
    seed,
    { isHomeRun: false, isFoul: true, batSide: pitch.batSide },
  );
}
