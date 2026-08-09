import type {
  MlbBoxscoreTeam,
  MlbLiveFeed,
  MlbPersonRef,
  MlbPlay,
  MlbPlayEvent,
  MlbPlayer,
  MlbRunner,
} from "@/lib/mlb/types";
import {
  AWAY_ROSTER,
  AWAY_TEAM,
  HOME_ROSTER,
  HOME_TEAM,
  SCRIPT,
  pitchesFor,
  type PitchCode,
  type ScriptedAtBat,
  type SimRosterEntry,
} from "./script";

export const DEMO_GAME_PK = 747001;

const SECONDS_PER_PITCH = 4.5;
const SECONDS_AFTER_PLAY = 3;

/** Inverse of the Gameday hit-coordinate mapping, so the demo feed carries
 *  the same raw coordinate space a real game does. */
function toHitCoordinates(angleDeg: number, distance: number): { coordX: number; coordY: number } {
  const theta = (angleDeg * Math.PI) / 180;
  const lateral = Math.sin(theta) * distance;
  const depth = Math.cos(theta) * distance;
  return {
    coordX: lateral / 2.29 + 125.42,
    coordY: 198.27 - depth / 2.29,
  };
}

const PITCH_TYPES = [
  { code: "FF", description: "Four-Seam Fastball", speed: 96.4 },
  { code: "SL", description: "Slider", speed: 87.1 },
  { code: "CH", description: "Changeup", speed: 88.6 },
  { code: "CU", description: "Curveball", speed: 80.2 },
  { code: "SI", description: "Sinker", speed: 94.8 },
];

interface PitchPresentation {
  callCode: string;
  callDescription: string;
  description: string;
  isStrike: boolean;
  isBall: boolean;
  isInPlay: boolean;
}

const PITCH_PRESENTATION: Record<PitchCode, PitchPresentation> = {
  B: { callCode: "B", callDescription: "Ball", description: "Ball", isStrike: false, isBall: true, isInPlay: false },
  C: { callCode: "C", callDescription: "Called Strike", description: "Called Strike", isStrike: true, isBall: false, isInPlay: false },
  S: { callCode: "S", callDescription: "Swinging Strike", description: "Swinging Strike", isStrike: true, isBall: false, isInPlay: false },
  F: { callCode: "F", callDescription: "Foul", description: "Foul", isStrike: true, isBall: false, isInPlay: false },
  X: { callCode: "X", callDescription: "In play", description: "In play, no out", isStrike: false, isBall: false, isInPlay: true },
};

/** Deterministic pseudo-random in [0,1) so every replay looks identical. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function plateLocation(code: PitchCode, seed: number): { pX: number; pZ: number } {
  const jitter = (n: number) => (rand(seed + n) - 0.5) * 2;
  if (code === "B") {
    const side = rand(seed) > 0.5 ? 1 : -1;
    return { pX: side * (0.95 + rand(seed + 3) * 0.7), pZ: 1.6 + rand(seed + 4) * 2.4 };
  }
  return { pX: jitter(1) * 0.62, pZ: 2.5 + jitter(2) * 0.72 };
}

interface SimState {
  inning: number;
  isTop: boolean;
  outs: number;
  score: { home: number; away: number };
  hits: { home: number; away: number };
  errors: { home: number; away: number };
  /** Runner occupying each base, or null. */
  bases: [SimRosterEntry | null, SimRosterEntry | null, SimRosterEntry | null];
  lineup: { home: number; away: number };
  innings: Array<{ home: number; away: number }>;
}

function personRef(p: SimRosterEntry): MlbPersonRef {
  return { id: p.id, fullName: p.fullName };
}

interface BuiltPlay {
  play: MlbPlay;
  /** Wall-clock offset (seconds) at which each play event becomes visible. */
  eventTimes: number[];
  completeTime: number;
  /** State captured after the play, used to rebuild the linescore. */
  after: SimState;
}

function cloneState(s: SimState): SimState {
  return {
    ...s,
    score: { ...s.score },
    hits: { ...s.hits },
    errors: { ...s.errors },
    bases: [...s.bases] as SimState["bases"],
    lineup: { ...s.lineup },
    innings: s.innings.map((i) => ({ ...i })),
  };
}

const EVENT_META: Record<
  string,
  { event: string; eventType: string; isOut: boolean }
> = {
  strikeout_swinging: { event: "Strikeout", eventType: "strikeout", isOut: true },
  strikeout_looking: { event: "Strikeout", eventType: "strikeout", isOut: true },
  walk: { event: "Walk", eventType: "walk", isOut: false },
  single: { event: "Single", eventType: "single", isOut: false },
  double: { event: "Double", eventType: "double", isOut: false },
  triple: { event: "Triple", eventType: "triple", isOut: false },
  home_run: { event: "Home Run", eventType: "home_run", isOut: false },
  flyout: { event: "Flyout", eventType: "field_out", isOut: true },
  groundout: { event: "Groundout", eventType: "field_out", isOut: true },
  lineout: { event: "Lineout", eventType: "field_out", isOut: true },
  double_play: { event: "Grounded Into DP", eventType: "grounded_into_double_play", isOut: true },
  sac_fly: { event: "Sac Fly", eventType: "sac_fly", isOut: true },
  error: { event: "Field Error", eventType: "field_error", isOut: false },
};

function fieldName(angle: number): string {
  if (angle < -30) return "left field";
  if (angle < -10) return "left center field";
  if (angle < 10) return "center field";
  if (angle < 30) return "right center field";
  return "right field";
}

function baseCode(slot: number): string {
  return slot === 0 ? "1B" : slot === 1 ? "2B" : slot === 2 ? "3B" : "score";
}

/**
 * Advance the base state for one scripted at-bat and produce MLB-shaped runner
 * records describing what happened.
 */
function applyOutcome(
  state: SimState,
  batter: SimRosterEntry,
  atBat: ScriptedAtBat,
): { runners: MlbRunner[]; rbi: number; description: string; outsRecorded: number } {
  const meta = EVENT_META[atBat.result];
  const runners: MlbRunner[] = [];
  const battingSide = state.isTop ? "away" : "home";
  let rbi = 0;
  let outsRecorded = 0;

  const push = (
    person: SimRosterEntry,
    startSlot: number | null,
    endSlot: number | null,
    isOut: boolean,
    outBase?: string,
  ) => {
    const start = startSlot === null ? null : baseCode(startSlot);
    const scored = endSlot !== null && endSlot >= 3;
    runners.push({
      movement: {
        originBase: start,
        start,
        end: isOut ? null : scored ? "score" : endSlot === null ? null : baseCode(endSlot),
        outBase: isOut ? outBase ?? null : null,
        isOut,
        outNumber: isOut ? state.outs + outsRecorded + 1 : null,
      },
      details: {
        event: meta.event,
        eventType: meta.eventType,
        movementReason: null,
        runner: personRef(person),
        isScoringEvent: scored,
        rbi: scored,
        earned: scored,
        playIndex: 0,
      },
    });
    if (scored) {
      state.score[battingSide] += 1;
      const frame = state.innings[state.inning - 1];
      if (frame) frame[battingSide] += 1;
      rbi += 1;
    }
    if (isOut) outsRecorded += 1;
  };

  // Move existing runners from the lead base backward so slots free up first.
  const advanceAll = (bases: number) => {
    for (let slot = 2; slot >= 0; slot--) {
      const runner = state.bases[slot];
      if (!runner) continue;
      const target = slot + bases;
      state.bases[slot] = null;
      if (target >= 3) push(runner, slot, 3, false);
      else {
        push(runner, slot, target, false);
        state.bases[target] = runner;
      }
    }
  };

  const forceWalk = () => {
    // Only forced runners move.
    if (state.bases[0]) {
      if (state.bases[1]) {
        if (state.bases[2]) {
          push(state.bases[2], 2, 3, false);
          state.bases[2] = null;
        }
        push(state.bases[1], 1, 2, false);
        state.bases[2] = state.bases[1];
        state.bases[1] = null;
      }
      push(state.bases[0], 0, 1, false);
      state.bases[1] = state.bases[0];
      state.bases[0] = null;
    }
  };

  const where = fieldName(atBat.angle);

  switch (atBat.result) {
    case "single":
    case "error": {
      advanceAll(1);
      push(batter, null, 0, false);
      state.bases[0] = batter;
      if (atBat.result === "single") state.hits[battingSide] += 1;
      else state.errors[state.isTop ? "home" : "away"] += 1;
      break;
    }
    case "double": {
      advanceAll(2);
      push(batter, null, 1, false);
      state.bases[1] = batter;
      state.hits[battingSide] += 1;
      break;
    }
    case "triple": {
      advanceAll(3);
      push(batter, null, 2, false);
      state.bases[2] = batter;
      state.hits[battingSide] += 1;
      break;
    }
    case "home_run": {
      advanceAll(3);
      push(batter, null, 3, false);
      state.hits[battingSide] += 1;
      break;
    }
    case "walk": {
      forceWalk();
      push(batter, null, 0, false);
      state.bases[0] = batter;
      break;
    }
    case "sac_fly": {
      if (state.bases[2]) {
        push(state.bases[2], 2, 3, false);
        state.bases[2] = null;
      }
      push(batter, null, null, true, "1B");
      break;
    }
    case "double_play": {
      const lead = state.bases[0];
      if (lead) {
        push(lead, 0, null, true, "2B");
        state.bases[0] = null;
      }
      push(batter, null, null, true, "1B");
      break;
    }
    default: {
      // Strikeouts and routine outs: the batter is retired, runners hold.
      push(batter, null, null, true, "1B");
      break;
    }
  }

  let description: string;
  switch (atBat.result) {
    case "strikeout_swinging":
      description = `${batter.fullName} strikes out swinging.`;
      break;
    case "strikeout_looking":
      description = `${batter.fullName} called out on strikes.`;
      break;
    case "walk":
      description = `${batter.fullName} walks.`;
      break;
    case "single":
      description = `${batter.fullName} singles on a line drive to ${where}.`;
      break;
    case "double":
      description = `${batter.fullName} doubles on a fly ball to ${where}.`;
      break;
    case "triple":
      description = `${batter.fullName} triples on a line drive to ${where}.`;
      break;
    case "home_run":
      description = `${batter.fullName} homers on a fly ball to ${where}. (${Math.round(atBat.distance)} ft)`;
      break;
    case "flyout":
      description = `${batter.fullName} flies out to ${where}.`;
      break;
    case "lineout":
      description = `${batter.fullName} lines out to ${where}.`;
      break;
    case "groundout":
      description = `${batter.fullName} grounds out to ${where}.`;
      break;
    case "double_play":
      description = `${batter.fullName} grounds into a double play.`;
      break;
    case "sac_fly":
      description = `${batter.fullName} hits a sacrifice fly to ${where}.`;
      break;
    case "error":
      description = `${batter.fullName} reaches on a fielding error to ${where}.`;
      break;
    default:
      description = `${batter.fullName} ${atBat.result}.`;
  }

  return { runners, rbi, description, outsRecorded };
}

function buildPlayEvents(
  atBat: ScriptedAtBat,
  seedBase: number,
  startTime: number,
): { events: MlbPlayEvent[]; times: number[] } {
  const codes = pitchesFor(atBat);
  const events: MlbPlayEvent[] = [];
  const times: number[] = [];
  let balls = 0;
  let strikes = 0;

  codes.forEach((code, i) => {
    const seed = seedBase + i * 17;
    const pitchType = PITCH_TYPES[Math.floor(rand(seed) * PITCH_TYPES.length)];
    const presentation = PITCH_PRESENTATION[code];
    const loc = plateLocation(code, seed);
    const countBefore = { balls, strikes, outs: 0 };

    const event: MlbPlayEvent = {
      index: i,
      playId: `demo-${seedBase}-${i}`,
      pitchNumber: i + 1,
      isPitch: true,
      type: "pitch",
      count: countBefore,
      details: {
        call: { code: presentation.callCode, description: presentation.callDescription },
        description: presentation.description,
        code: presentation.callCode,
        isInPlay: presentation.isInPlay,
        isStrike: presentation.isStrike,
        isBall: presentation.isBall,
        type: { code: pitchType.code, description: pitchType.description },
      },
      pitchData: {
        startSpeed: Math.round((pitchType.speed + (rand(seed + 5) - 0.5) * 3) * 10) / 10,
        strikeZoneTop: 3.42,
        strikeZoneBottom: 1.59,
        coordinates: { pX: loc.pX, pZ: loc.pZ },
      },
    };

    if (code === "X") {
      event.hitData = {
        launchSpeed: atBat.launchSpeed,
        launchAngle: atBat.launchAngle,
        totalDistance: atBat.distance,
        trajectory:
          (atBat.launchAngle ?? 0) < 5
            ? "ground_ball"
            : (atBat.launchAngle ?? 0) < 20
              ? "line_drive"
              : "fly_ball",
        coordinates: toHitCoordinates(atBat.angle, atBat.distance),
      };
    }

    if (code === "B") balls++;
    else if (code === "X") {
      /* count unchanged */
    } else if (strikes < 2 || code !== "F") strikes++;

    events.push(event);
    times.push(startTime + (i + 1) * SECONDS_PER_PITCH);
  });

  return { events, times };
}

function nextBatter(state: SimState): SimRosterEntry {
  const side = state.isTop ? "away" : "home";
  const list = side === "away" ? AWAY_ROSTER : HOME_ROSTER;
  const idx = state.lineup[side] % 9;
  state.lineup[side] = (state.lineup[side] + 1) % 9;
  return list[idx];
}

function initialState(): SimState {
  return {
    inning: 1,
    isTop: true,
    outs: 0,
    score: { home: 0, away: 0 },
    hits: { home: 0, away: 0 },
    errors: { home: 0, away: 0 },
    bases: [null, null, null],
    lineup: { home: 0, away: 0 },
    innings: Array.from({ length: 9 }, () => ({ home: 0, away: 0 })),
  };
}

/** Build the whole scripted game once; slicing by time is then trivial. */
function buildGame(): { plays: BuiltPlay[]; totalSeconds: number } {
  const state = initialState();
  const plays: BuiltPlay[] = [];
  let clock = 0;
  let atBatIndex = 0;

  for (let i = 0; i < SCRIPT.length; i++) {
    const atBat = SCRIPT[i];
    const batter = nextBatter(state);
    const pitcher = (state.isTop ? HOME_ROSTER : AWAY_ROSTER)[8];
    const startTime = clock;
    const { events, times } = buildPlayEvents(atBat, i * 97 + 11, startTime);

    // A steal lands between pitches as its own action event.
    if (atBat.steal && state.bases[0]) {
      const runner = state.bases[0];
      const toSlot = atBat.steal === "second" ? 1 : 2;
      const insertAt = Math.max(1, Math.floor(events.length / 2));
      const action: MlbPlayEvent = {
        index: events.length,
        type: "action",
        isPitch: false,
        details: {
          event: "Stolen Base 2B",
          eventType: "stolen_base_2b",
          description: `${runner.fullName} steals (1) 2nd base.`,
        },
      };
      events.splice(insertAt, 0, action);
      times.splice(insertAt, 0, times[insertAt - 1] + 1.6);
      events.forEach((e, idx) => (e.index = idx));
      state.bases[0] = null;
      state.bases[toSlot] = runner;
    }

    const beforeOuts = state.outs;
    const stateForPlay = state;
    const { runners, rbi, description, outsRecorded } = applyOutcome(stateForPlay, batter, atBat);
    state.outs = beforeOuts + outsRecorded;

    const meta = EVENT_META[atBat.result];
    const completeTime = (times[times.length - 1] ?? startTime) + 1.2;

    const play: MlbPlay = {
      result: {
        type: "atBat",
        event: meta.event,
        eventType: meta.eventType,
        description,
        rbi,
        awayScore: state.score.away,
        homeScore: state.score.home,
        isOut: meta.isOut,
      },
      about: {
        atBatIndex,
        halfInning: state.isTop ? "top" : "bottom",
        isTopInning: state.isTop,
        inning: state.inning,
        isComplete: true,
        isScoringPlay: rbi > 0,
        hasOut: outsRecorded > 0,
      },
      count: { balls: 0, strikes: 0, outs: state.outs },
      matchup: {
        batter: personRef(batter),
        batSide: { code: batter.batSide },
        pitcher: personRef(pitcher),
        pitchHand: { code: pitcher.pitchHand },
      },
      runners,
      playEvents: events,
      atBatIndex,
    };

    plays.push({
      play,
      eventTimes: times,
      completeTime,
      after: cloneState(state),
    });

    clock = completeTime + SECONDS_AFTER_PLAY;
    atBatIndex++;

    if (state.outs >= 3) {
      state.outs = 0;
      state.bases = [null, null, null];
      if (!state.isTop) state.inning += 1;
      state.isTop = !state.isTop;
      clock += 6;
    }
  }

  return { plays, totalSeconds: clock };
}

const GAME = buildGame();

function boxscoreTeam(
  team: typeof HOME_TEAM,
  players: SimRosterEntry[],
): MlbBoxscoreTeam {
  const map: Record<string, { person: MlbPersonRef; jerseyNumber: string; position: { abbreviation: string } }> = {};
  for (const p of players) {
    map[`ID${p.id}`] = {
      person: personRef(p),
      jerseyNumber: p.number,
      position: { abbreviation: p.position },
    };
  }
  return {
    team,
    players: map,
    batters: players.slice(0, 9).map((p) => p.id),
    pitchers: [players[8].id],
    bench: players.slice(9, 14).map((p) => p.id),
    bullpen: players.slice(14).map((p) => p.id),
    battingOrder: players.slice(0, 9).map((p) => p.id),
  };
}

function playersDict(): Record<string, MlbPlayer> {
  const dict: Record<string, MlbPlayer> = {};
  for (const p of [...AWAY_ROSTER, ...HOME_ROSTER]) {
    const [firstName, ...rest] = p.fullName.split(" ");
    dict[`ID${p.id}`] = {
      id: p.id,
      fullName: p.fullName,
      firstName,
      lastName: rest.join(" "),
      primaryNumber: p.number,
      boxscoreName: rest.join(" ") || firstName,
      primaryPosition: { abbreviation: p.position, code: "", name: p.position, type: "" },
      batSide: { code: p.batSide },
      pitchHand: { code: p.pitchHand },
    };
  }
  return dict;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/**
 * Render the scripted game as it stands `elapsedSeconds` in. Pitches appear one
 * at a time and plays complete a beat later, exactly like the real feed.
 */
export function buildDemoFeed(elapsedSeconds: number): MlbLiveFeed {
  const t = Math.max(0, elapsedSeconds);
  const allPlays: MlbPlay[] = [];
  let state = initialState();
  let currentPlay: MlbPlay | undefined;
  let nextUp: MlbPlay | undefined;

  for (let i = 0; i < GAME.plays.length; i++) {
    const built = GAME.plays[i];
    const firstTime = built.eventTimes[0] ?? 0;
    if (t < firstTime) break;

    const visibleCount = built.eventTimes.filter((time) => time <= t).length;
    const isComplete = t >= built.completeTime;
    const events = (built.play.playEvents ?? []).slice(0, visibleCount);

    const play: MlbPlay = {
      ...built.play,
      playEvents: events,
      about: { ...built.play.about, isComplete },
      // Until the play completes, MLB has not published the outcome.
      result: isComplete ? built.play.result : { type: "atBat" },
      runners: isComplete ? built.play.runners : [],
      count: isComplete
        ? built.play.count
        : {
            balls: events.filter((e) => e.details?.isBall).length,
            strikes: Math.min(2, events.filter((e) => e.details?.isStrike).length),
            outs: state.outs,
          },
    };
    allPlays.push(play);
    currentPlay = play;
    if (isComplete) {
      state = built.after;
      // Between at-bats the real feed already names the next hitter.
      nextUp = GAME.plays[i + 1]?.play;
    } else {
      nextUp = undefined;
    }
  }

  const inningsPlayed = Math.max(1, state.inning);
  const fieldingRoster = state.isTop ? HOME_ROSTER : AWAY_ROSTER;
  const battingRoster = state.isTop ? AWAY_ROSTER : HOME_ROSTER;

  const activePlay = currentPlay;
  const batterId = (nextUp ?? activePlay)?.matchup?.batter?.id;
  const batter = battingRoster.find((p) => p.id === batterId) ?? battingRoster[0];
  const onDeck = battingRoster[(battingRoster.indexOf(batter) + 1) % 9];

  const defenseByPosition: Record<string, SimRosterEntry | undefined> = {};
  for (const p of fieldingRoster.slice(0, 9)) defenseByPosition[p.position] = p;

  const liveCount = activePlay && !activePlay.about?.isComplete ? activePlay.count : { balls: 0, strikes: 0, outs: state.outs };

  const started = t > 0;
  const finished = t > GAME.totalSeconds + 10;

  return {
    gamePk: DEMO_GAME_PK,
    metaData: { timeStamp: new Date().toISOString() },
    gameData: {
      game: { pk: DEMO_GAME_PK, type: "R", season: String(new Date().getFullYear()) },
      datetime: { dateTime: new Date().toISOString() },
      status: {
        abstractGameState: finished ? "Final" : started ? "Live" : "Preview",
        codedGameState: finished ? "F" : started ? "I" : "P",
        detailedState: finished ? "Final" : started ? "In Progress" : "Scheduled",
        abstractGameCode: finished ? "F" : started ? "L" : "P",
      },
      teams: { away: AWAY_TEAM, home: HOME_TEAM },
      players: playersDict(),
      venue: { name: "Demo Park" },
    },
    liveData: {
      plays: { allPlays, currentPlay: activePlay },
      linescore: {
        currentInning: state.inning,
        currentInningOrdinal: ORDINALS[Math.min(8, state.inning - 1)],
        inningState: state.isTop ? "Top" : "Bottom",
        inningHalf: state.isTop ? "Top" : "Bottom",
        isTopInning: state.isTop,
        scheduledInnings: 9,
        innings: state.innings.slice(0, inningsPlayed).map((frame, i) => ({
          num: i + 1,
          ordinalNum: ORDINALS[i],
          home: { runs: frame.home },
          away: { runs: frame.away },
        })),
        teams: {
          home: { runs: state.score.home, hits: state.hits.home, errors: state.errors.home },
          away: { runs: state.score.away, hits: state.hits.away, errors: state.errors.away },
        },
        defense: {
          pitcher: defenseByPosition.P ? personRef(defenseByPosition.P) : undefined,
          catcher: defenseByPosition.C ? personRef(defenseByPosition.C) : undefined,
          first: defenseByPosition["1B"] ? personRef(defenseByPosition["1B"]) : undefined,
          second: defenseByPosition["2B"] ? personRef(defenseByPosition["2B"]) : undefined,
          third: defenseByPosition["3B"] ? personRef(defenseByPosition["3B"]) : undefined,
          shortstop: defenseByPosition.SS ? personRef(defenseByPosition.SS) : undefined,
          left: defenseByPosition.LF ? personRef(defenseByPosition.LF) : undefined,
          center: defenseByPosition.CF ? personRef(defenseByPosition.CF) : undefined,
          right: defenseByPosition.RF ? personRef(defenseByPosition.RF) : undefined,
          team: state.isTop ? HOME_TEAM : AWAY_TEAM,
        },
        offense: {
          batter: personRef(batter),
          onDeck: personRef(onDeck),
          first: state.bases[0] ? personRef(state.bases[0]) : undefined,
          second: state.bases[1] ? personRef(state.bases[1]) : undefined,
          third: state.bases[2] ? personRef(state.bases[2]) : undefined,
          team: state.isTop ? AWAY_TEAM : HOME_TEAM,
        },
        balls: liveCount?.balls ?? 0,
        strikes: liveCount?.strikes ?? 0,
        outs: state.outs,
      },
      boxscore: {
        teams: {
          away: boxscoreTeam(AWAY_TEAM, AWAY_ROSTER),
          home: boxscoreTeam(HOME_TEAM, HOME_ROSTER),
        },
      },
    },
  };
}

export const DEMO_TOTAL_SECONDS = GAME.totalSeconds;

export function demoSummary(elapsedSeconds: number) {
  const feed = buildDemoFeed(elapsedSeconds);
  const ls = feed.liveData?.linescore;
  return {
    gamePk: DEMO_GAME_PK,
    state: "live" as const,
    statusText: "Demo Game",
    startTime: null,
    venue: "Demo Park",
    home: {
      id: HOME_TEAM.id,
      name: HOME_TEAM.teamName,
      abbrev: HOME_TEAM.abbreviation,
      score: ls?.teams?.home?.runs ?? 0,
      palette: { abbrev: HOME_TEAM.abbreviation, primary: "#005A9C", secondary: "#EF3E42" },
    },
    away: {
      id: AWAY_TEAM.id,
      name: AWAY_TEAM.teamName,
      abbrev: AWAY_TEAM.abbreviation,
      score: ls?.teams?.away?.runs ?? 0,
      palette: { abbrev: AWAY_TEAM.abbreviation, primary: "#FD5A1E", secondary: "#27251F" },
    },
    inning: ls?.currentInning ?? 1,
    inningOrdinal: ls?.currentInningOrdinal ?? "1st",
    isTopInning: ls?.isTopInning ?? true,
    outs: ls?.outs ?? 0,
    isDemo: true,
  };
}
