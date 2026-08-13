import { Vector3 } from "three";
import {
  BASE_ORDER,
  BASE_POSITIONS,
  FIELDING_SPOTS,
  MOUND_HEIGHT,
  POSITION_KEYS,
  RUBBER_DEPTH,
  batterOffset,
  batterSpot,
  fp,
  onDeckSpot,
  playableSpot,
  standingSpot,
  wallDistance,
  type BaseId,
  type PositionKey,
} from "@/lib/field/geometry";
import type { SoundName } from "@/lib/audio/sfx";
import { seatCamera, type CameraView, type Shot } from "./views";
import { Fx } from "./particles";
import { pitchArc } from "./pitches";
import {
  GLOVE_HEIGHT,
  heatOf,
  planBattedBall,
  type BattedPlan,
} from "./batted";
import { foulBallFor, runnerProgress } from "@/lib/game/events";
import type {
  GameSnapshot,
  NormalizedEvent,
  PitchEvent,
  PlayResultEvent,
  PlayerRef,
  RunnerMove,
  TeamSide,
} from "@/lib/game/types";

export type Pose =
  | "idle"
  | "ready"
  | "run"
  | "windup"
  | "throw"
  | "swing"
  | "catch"
  | "walk"
  | "celebrate"
  | "dejected"
  /** Hands on hips, head down - a pitcher who has just given one up. */
  | "annoyed"
  /** Laid out full stretch at a ball going past. */
  | "dive"
  | "crouch";

export interface Actor {
  key: string;
  playerId: number;
  name: string;
  shortName: string;
  number?: string;
  side: TeamSide;
  role: "fielder" | "batter" | "ondeck" | "runner";
  positionKey?: PositionKey;
  /** Which side of the plate they hit from, so the ear flap faces the pitcher. */
  batSide?: "R" | "L";
  /** Resting spot the actor returns to. */
  home: Vector3;
  position: Vector3;
  facing: number;
  pose: Pose;
  /** 0..1 through the current pose, for limb animation. */
  poseT: number;
  visible: boolean;
  /** 0 = solid, 1 = beamed out. Retired players dematerialise. */
  dissolve: number;
  /**
   * Set while an actor is resolving *in* from a beam - a new batter stepping
   * up, or a side taking the field after the change of innings. Its `dissolve`
   * counts back down to 0 every frame in `update`, which is the one direction
   * every other user of `dissolve` never drives it: they all count up to a
   * departure. Kept separate so a beam-in and a beam-out never fight.
   */
  arriving: boolean;
  label: string | null;
}

export interface BallState {
  position: Vector3;
  visible: boolean;
  /** Radius scale, so a pitch reads smaller than a towering fly. */
  scale: number;
  trail: Vector3[];
}

/**
 * The shot vocabulary of the broadcast view. Broadcasts do not ease between
 * angles - they cut - and they change lenses to say something about the moment:
 * tight on the pitcher with two strikes, low down the line off the bat, wide
 * when the ball is gone. The fixed seats a viewer can switch to instead live in
 * `views.ts`; while one of those is chosen this shot list still runs, it is
 * simply not what the rig is looking through.
 */
export type CameraMode =
  /**
   * The centre-field camera: out past the mound, up over the batter's eye,
   * behind the pitcher and looking in at the hitter. Every pitch a real
   * broadcast shows is framed from here, and it is the shot this one returns
   * to whenever it has nothing better to be doing.
   */
  | "center"
  | "wide"
  | "ball"
  | "base"
  /** Low and tight down the third-base line, looking out with the ball. */
  | "low"
  /** Long lens from behind the plate, framed on the pitcher. */
  | "mound"
  /** Over the catcher, tight on the hitter. */
  | "slot"
  /** Field level down the first-base line, looking back in at the plate. */
  | "line"
  /** High in the third-base stands, across the diamond. */
  | "bowl"
  /** Travels with whichever actor `cameraFollowKey` names. */
  | "follow";

/** How long a shot holds before anything less urgent may replace it. */
const SHOT_HOLD: Partial<Record<CameraMode, number>> = {
  low: 1.1,
  mound: 0.9,
  slot: 0.9,
  wide: 1.2,
  line: 0.9,
  bowl: 0.9,
  follow: 1,
};

/**
 * Angles the broadcast wanders to while nothing is happening, in the order it
 * takes them. A real feed fills the twenty-odd seconds between pitches with the
 * dugout, the runner at first, a wide of the park - never for long, and never
 * so often that you lose track of where the game is.
 */
const IDLE_SHOTS: CameraMode[] = ["mound", "line", "base", "bowl", "slot", "wide"];

/** How long after a play ends before the camera settles back on the pitch. */
const IDLE_SETTLE = 0.9;
/**
 * How long the game has to have been quiet before the broadcast looks away,
 * and how long it stays away. Seven seconds is past the point where a pitch was
 * about to be thrown, so a cutaway only ever starts in a genuine lull.
 */
const IDLE_CUTAWAY_AFTER = 7;
const IDLE_CUTAWAY_HOLD = 4.5;
/**
 * And the wall-clock gap between one cutaway and the next. This one is not
 * measured in idle time but in real seconds since the camera last came back,
 * which is what keeps the rate down: a real game leaves twenty-odd seconds
 * between pitches, and a feed that used every one of them would be cutting away
 * once a pitch. Roughly every other lull is the right amount of restlessness.
 */
const IDLE_CUTAWAY_GAP = 26;

/**
 * The change of sides. The whole club beams out, the park sits empty for a
 * beat, and whoever is up next beams back in once the feed says who that is -
 * three separate things, but only the first one is a timed animation. The
 * other two happen whenever `applySnapshot` next runs, which is out of this
 * clock's hands.
 */
const INNING_BEAM_OUT = 0.7;
const INNING_HOLD = 2.0;
/** How long a freshly beamed-in actor takes to solidify. */
const MATERIALIZE_TIME = 0.6;
/**
 * After a batter is retired, how long the field holds - long enough for the
 * beam-out to finish and a beat to land on it - before the camera cuts back to
 * the pitcher for the next hitter.
 */
const POST_OUT_PAUSE = 1.1;

export interface CallOut {
  text: string;
  detail?: string;
  tone: "neutral" | "good" | "bad" | "big";
  at: number;
}

/**
 * The throwing motion, in seconds, and how far into it the ball leaves the
 * hand. Release sits early: the arm whips over quickly and then spends most of
 * the pose decelerating through the follow-through.
 */
const THROW_TIME = 0.62;
const THROW_RELEASE = 0.32;

/**
 * The pitch used to be laid out in real feet - released at 5.9 and crossing the
 * plate around 2.5 - while the players are cartoon scale, a little over twice
 * life size. The ball therefore left the pitcher's knee and crossed at the
 * hitter's shins. These map a real height, in feet, onto the figures instead:
 * `PLATE_RISE` and `PLATE_BASE` are fitted so the knees and the letters of the
 * batting stance land on 1.6 and 3.4 feet, the real strike zone.
 */
const PLATE_RISE = 2.59;
const PLATE_BASE = -0.39;

function zoneHeight(feet: number): number {
  return Math.max(0.5, PLATE_BASE + feet * PLATE_RISE);
}

/**
 * Where the ball leaves the hand, measured off the throwing pose rather than
 * guessed: at `THROW_RELEASE` the pitcher's hand is here, a little in front of
 * the rubber and up at the top of the arm slot.
 */
const RELEASE_HEIGHT = 11.0;
const RELEASE_DEPTH = RUBBER_DEPTH - 2 - 4.7;
const RELEASE_LATERAL = 2.3;
const PLATE_DEPTH = 1.35;
/**
 * Where the bat meets the ball, out in front of the plate. It shifts toward
 * whichever box the hitter is in: he stands further off the plate than a real
 * one does - see `batterSpot` - and a contact point nailed to the middle of the
 * plate would be a foot and a half past the end of his bat.
 */
function contactPoint(batSide: "R" | "L"): Vector3 {
  return fp(batterOffset(batSide) * 0.28, 2.6, 6.4);
}

/**
 * Seconds a runner takes to cover one base. A real sprint home-to-first is
 * about 4.3s. These are still quicker than life, but the point of the whole
 * animation is that a viewer can follow what happened, and a double that is
 * over before you have found the ball has not communicated anything.
 */
const RUN_PER_BASE = 2.6;
const TROT_PER_BASE = 3.4;

/**
 * How long a swing takes, and how far ahead of contact it begins. Lengthened
 * from the original 0.55s/0.2s lead so there is room for a visible coil before
 * the bat fires - a swing that only starts a fifth of a second out reads as a
 * flinch rather than a hitter starting his load.
 */
const SWING_TIME = 0.62;
const SWING_LEAD = 0.27;

/** A walk is not a race. */
const WALK_PER_BASE = 4.2;

function yawToward(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * MLB's `linescore.inningState` reads "Top", "Middle", "Bottom" or "End". The
 * two middles are the between-halves breaks - "Middle" after the top half,
 * "End" after the bottom - which on a broadcast is where the commercial goes
 * and the field sits empty. That is the signal the intermission holds on.
 */
function isBetweenInnings(inningState: string | undefined): boolean {
  return inningState === "Middle" || inningState === "End";
}

/** The count after a pitch lands. `pitch.count` is the count before it. */
function countAfter(pitch: PitchEvent): { balls: number; strikes: number } {
  const { balls, strikes } = pitch.count;
  // A scoreboard never shows ball four or strike three - the play result
  // resets the count a moment later.
  switch (pitch.outcome) {
    case "ball":
      return { balls: Math.min(3, balls + 1), strikes };
    case "called_strike":
    case "swinging_strike":
    case "foul":
      return { balls, strikes: Math.min(2, strikes + 1) };
    default:
      return { balls, strikes };
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Position along the basepaths. 0 = home, 1 = first, ... 4 = scored. */
export function basePathPoint(progress: number, bow = 0): Vector3 {
  const p = Math.max(0, Math.min(4, progress));
  const i = Math.min(3, Math.floor(p));
  const f = p - i;
  const from = BASE_POSITIONS[BASE_ORDER[i % 4]];
  const to = BASE_POSITIONS[BASE_ORDER[(i + 1) % 4]];
  const point = from.clone().lerp(to, f);
  if (bow > 0) {
    // Runners round the bag in an arc rather than cutting the corner.
    const outward = point.clone().sub(fp(0, 63.64)).setY(0);
    if (outward.lengthSq() > 0) {
      outward.normalize().multiplyScalar(bow * Math.sin(f * Math.PI) * 6);
      point.add(outward);
    }
  }
  return point;
}

/**
 * How much each outcome moves the crowd, and which side it favours.
 * Plays not listed here (walks, hit batsmen) pass without a reaction.
 */
const CROWD_WEIGHT: Partial<
  Record<PlayResultEvent["kind"], { magnitude: number; favorsBatter: boolean }>
> = {
  home_run: { magnitude: 1, favorsBatter: true },
  triple: { magnitude: 0.9, favorsBatter: true },
  double: { magnitude: 0.72, favorsBatter: true },
  single: { magnitude: 0.55, favorsBatter: true },
  error: { magnitude: 0.45, favorsBatter: true },
  sac_fly: { magnitude: 0.55, favorsBatter: true },
  strikeout: { magnitude: 0.62, favorsBatter: false },
  field_out: { magnitude: 0.45, favorsBatter: false },
  double_play: { magnitude: 0.85, favorsBatter: false },
  generic: { magnitude: 0.35, favorsBatter: false },
};

/**
 * Plays where the defence retired the batter with the ball they hit. Anything
 * else means the ball was not caught, and has to reach the ground.
 */
const CAUGHT_KINDS = new Set<PlayResultEvent["kind"]>([
  "field_out",
  "double_play",
  "sac_fly",
]);

/** Plays where the batter actually got a hit off the pitcher. */
const HIT_KINDS = new Set<PlayResultEvent["kind"]>([
  "single",
  "double",
  "triple",
  "home_run",
]);

interface RunnerTrack {
  actorKey: string;
  from: number;
  to: number;
  start: number;
  end: number;
  isOut: boolean;
  scored: boolean;
  /** Awarded the base rather than running for it. */
  walking: boolean;
}

/**
 * Fires a callback the first time an animation passes a given moment. Sounds
 * are cued off the animation clock, not off event arrival, so the crack lands
 * with the swing rather than with the poll that reported it.
 */
class Cue {
  private fired = new Set<string>();
  at(key: string, t: number, when: number, run: () => void) {
    if (t < when || this.fired.has(key)) return;
    this.fired.add(key);
    run();
  }
}

interface Anim {
  duration: number;
  /** Advance the animation. `t` is seconds since it started. */
  update(t: number, dt: number): void;
  onStart?(): void;
  onEnd?(): void;
  label: string;
}

export class Director {
  actors = new Map<string, Actor>();
  /** Confetti and fireworks. */
  fx = new Fx();
  ball: BallState = {
    position: fp(0, 60, 5),
    visible: false,
    scale: 1,
    trail: [],
  };
  cameraMode: CameraMode = "center";
  /** How hard the ball camera pans off the broadcast framing, 0..1. */
  cameraFollow = 0.35;
  cameraFocus = fp(0, 60, 4);
  cameraPosition = fp(0, -84, 44);
  /**
   * Bumped every time the shot changes on a cut rather than a move. The rig
   * watches it and snaps, which is the whole difference between a broadcast
   * and a security camera.
   */
  cameraCut = 0;
  /** Actor the `follow` shot travels with. */
  cameraFollowKey: string | null = null;
  /** Decaying knock on the lens after a hard-hit ball. */
  cameraShake = 0;
  /**
   * The latest stir of the stands, for the crowd to play out. `home` and `away`
   * are signed excitement, roughly -1..1: positive is elated, negative dejected,
   * and the two are opposite because a park's two allegiances feel a play in
   * opposite directions. Set at the same post-outcome instant the cheer sounds,
   * never before, so the crowd cannot give a big play away. `<Crowd>` watches
   * `crowdReactionId` the way `<Actors>` watches `rosterVersion` and starts a
   * fresh reaction whenever it changes. See `stirCrowd`.
   */
  crowdReaction: { home: number; away: number; at: number } | null = null;
  crowdReactionId = 0;
  callout: CallOut | null = null;
  snapshot: GameSnapshot | null = null;
  /** Set while an animation is playing, so the store holds back new state. */
  busy = false;
  queueLength = 0;
  /** Bumped whenever the actor roster changes, so React can re-render. */
  rosterVersion = 0;

  /**
   * Fired as each animation resolves so the scoreboard advances in step with
   * what is on screen, rather than jumping ahead to the feed's latest state.
   */
  onCount?: (count: { balls: number; strikes: number }) => void;
  onPlayResolved?: (result: PlayResultEvent) => void;
  /** Fired at the moment a sound should be heard, not when an event arrives. */
  onSound?: (name: SoundName, intensity?: number) => void;

  private queue: NormalizedEvent[] = [];
  private current: Anim | null = null;
  private currentTime = 0;
  private currentStart = 0;
  private idleTime = 0;
  private shotStart = 0;
  /** Counts pitches, so the pre-pitch shot varies without being random. */
  private pitchCount = 0;
  /** Where in `IDLE_SHOTS` the next cutaway comes from. */
  private idleShot = 0;
  /** `idleTime` at which the camera comes back from the cutaway it is on. */
  private idleCutEnd = 0;
  private onIdleCutaway = false;
  /** Wall clock at which the last cutaway ended, for the gap between them. */
  private lastCutawayAt = 0;
  /**
   * True from the moment the side beams out until the next roster lands. The
   * park is empty for however long that takes, so the idle camera is told to
   * hold rather than go wandering off to a shot of nobody.
   */
  private awaitingReturn = false;
  /**
   * Which side was on the field when the half ended, i.e. the one that just
   * beamed out. While we wait, a snapshot that still shows *this* side fielding
   * with the inning already over is a stale reading of the half we just left -
   * it must not be allowed to beam the departed side straight back in. The new
   * half's snapshot (the other side fielding) is what releases the hold.
   */
  private awaitingSide: TeamSide | null = null;
  /**
   * Set by the store the moment the feed reports the game final, so the third
   * out that ends it plays as an ending rather than a change of sides - there
   * is no side to bring back on. Best-effort: a feed that is slow to mark the
   * game over falls back to an empty park under the final scoreboard, which the
   * game-over overlay covers.
   */
  gameOver = false;

  /**
   * True from the moment the field starts emptying on the third out until the
   * next side has beamed back on - the whole between-innings break. The
   * intermission overlay polls this the way the callout HUD polls `callout`, so
   * it never has to run off a React render.
   */
  get intermission(): boolean {
    return this.awaitingReturn;
  }

  constructor() {
    this.fx.onBurst = (intensity) => this.onSound?.("firework", intensity);
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /**
   * Translate "who did something good" into what the home crowd does about it.
   * `favorsBatter` is whether the play helped the batting side.
   */
  private crowdVoice(
    favorsBatter: boolean,
    magnitude: number,
  ): { sound: SoundName; intensity: number } {
    const homeIsBatting = this.snapshot?.battingSide === "home";
    const goodForHome = favorsBatter === homeIsBatting;
    if (!goodForHome) {
      return { sound: "groan", intensity: magnitude };
    }
    return {
      sound: magnitude >= 0.9 ? "bigCheer" : "cheer",
      intensity: magnitude,
    };
  }

  /**
   * Stir the stands. Same reading of the play as `crowdVoice` - `favorsBatter`
   * against who is batting tells us whether it was good for the home club - only
   * this comes out as a signed number the seats can move to rather than a sound:
   * the home side gets `+magnitude` when it went their way and `-magnitude` when
   * it did not, and the visitors get the opposite. Called from the play's own
   * reaction cue, so it lands after the outcome is settled, not off the bat.
   */
  private stirCrowd(favorsBatter: boolean, magnitude: number) {
    const homeIsBatting = this.snapshot?.battingSide === "home";
    const goodForHome = favorsBatter === homeIsBatting;
    const home = goodForHome ? magnitude : -magnitude;
    this.crowdReaction = { home, away: -home, at: this.now() };
    this.crowdReactionId += 1;
  }

  /** Palette of whichever club is celebrating. */
  private celebrationColors(): string[] {
    const side = this.snapshot?.battingSide ?? "home";
    const team = this.snapshot?.teams[side];
    return team ? [team.palette.primary, team.palette.secondary] : ["#ffd447", "#ffffff"];
  }

  /**
   * Paper over the infield when a run scores - for the home club only. A park
   * does not fire its cannons for the visitors, same as the fireworks.
   */
  private throwConfetti(amount = 150) {
    if (this.snapshot?.battingSide !== "home") return;
    this.fx.burstConfetti(fp(0, 8, 12), amount, this.celebrationColors());
  }

  /**
   * Shells over the outfield. The park only sets these off for its own club -
   * a visiting home run does not get a light show, it gets a groan.
   */
  private launchFireworks(count: number) {
    if (this.snapshot?.battingSide !== "home") return;
    this.fx.fireworkShow(fp(0, 230, 6), count, this.celebrationColors());
    this.onSound?.("launch");
  }

  /**
   * Change the shot. `cut` jumps rather than eases; a shot that has not yet
   * served out its hold refuses to be replaced, so nothing strobes between two
   * angles when several things happen at once.
   */
  private setShot(mode: CameraMode, opts: { cut?: boolean; force?: boolean; follow?: string } = {}) {
    if (mode === this.cameraMode) {
      if (opts.follow) this.cameraFollowKey = opts.follow;
      return;
    }
    const hold = SHOT_HOLD[this.cameraMode] ?? 0;
    if (!opts.force && hold > 0 && this.now() - this.shotStart < hold * 1000) return;
    this.cameraMode = mode;
    this.shotStart = this.now();
    this.cameraFollowKey = opts.follow ?? null;
    if (opts.cut) this.cameraCut += 1;
  }

  /** A hard-hit ball knocks the lens. `amount` is 0..1. */
  private knockCamera(amount: number) {
    this.cameraShake = Math.max(this.cameraShake, amount);
  }

  /**
   * Retire a player with a transporter beam in their own club's colour. The
   * `dissolve` ramp on the actor and the particles are separate: the effect
   * fires once, the ramp runs every frame.
   */
  private beamOut(actor: Actor) {
    const color = this.snapshot?.teams[actor.side]?.palette.primary ?? "#8ce0ff";
    this.fx.beam(actor.position.clone(), color);
    this.onSound?.("beam");
  }

  /**
   * The same effect across a whole roster at once - the change of sides,
   * rather than one retired runner. One "beam" cue stands for the lot; eleven
   * of them going off in the same tenth of a second would not read as eleven,
   * it would just read as loud.
   */
  private beamRoster(actors: Actor[]) {
    for (const actor of actors) {
      const color = this.snapshot?.teams[actor.side]?.palette.primary ?? "#8ce0ff";
      this.fx.beam(actor.position.clone(), color);
    }
    if (actors.length > 0) this.onSound?.("beam");
  }

  /**
   * Replace the world with authoritative state. Only called when idle.
   *
   * When this lands the roster back after a change of sides, the new defense
   * does not simply appear: it beams in the same way a retired runner beams
   * out, just in reverse, and `update` carries the actual fade - this only
   * lights the fuse.
   */
  applySnapshot(snapshot: GameSnapshot) {
    // Holding the park empty between halves. The broadcast's own signal for
    // this is `inningState`: "Middle" is the break after the top half, "End"
    // the break after the bottom - the windows a real feed spends in
    // commercial with an empty field. While the feed says we are in one, the
    // park stays empty however long it lasts; play resuming (a live "Top" or
    // "Bottom") is what brings the next side on. See `intermission`.
    if (this.awaitingReturn && isBetweenInnings(snapshot.inningState)) {
      this.snapshot = snapshot;
      return;
    }
    // A safety net for the instant before the feed catches up to the break: a
    // snapshot still showing the side that just left fielding with the inning
    // already three-out over is a stale reading of the half we came out of -
    // let it through and it beams the departed team straight back on for a
    // frame. A reversal (the out overturned, count back under three) is not
    // stale: the same side belongs back on, and this lets them return.
    if (
      this.awaitingReturn &&
      this.awaitingSide &&
      snapshot.fieldingSide === this.awaitingSide &&
      snapshot.count.outs >= 3
    ) {
      this.snapshot = snapshot;
      return;
    }

    const prevBatterId = this.actors.get("bat")?.playerId;
    const hadWorld = this.actors.size > 0;
    this.snapshot = snapshot;
    const materializing = this.awaitingReturn;
    this.awaitingReturn = false;
    this.awaitingSide = null;
    const seen = new Set<string>();
    const batSide = snapshot.batter?.batSide ?? "R";

    for (const key of POSITION_KEYS) {
      const player = snapshot.defense[key];
      if (!player) continue;
      const actorKey = `def:${key}`;
      seen.add(actorKey);
      const isCatcher = key === "catcher";
      const spot = FIELDING_SPOTS[key];
      this.upsert(actorKey, player, {
        role: "fielder",
        positionKey: key,
        home: spot,
        // The catcher squats facing the mound; everyone else faces the plate.
        facing: isCatcher ? yawToward(spot, fp(0, 60)) : yawToward(spot, fp(0, 0)),
        pose: isCatcher ? "crouch" : "ready",
      });
    }

    if (snapshot.batter) {
      seen.add("bat");
      const spot = batterSpot(batSide);
      this.upsert("bat", snapshot.batter, {
        role: "batter",
        home: spot,
        facing: batSide === "R" ? Math.PI / 2 : -Math.PI / 2,
        pose: "ready",
      });
    }

    if (snapshot.onDeck) {
      seen.add("deck");
      const spot = onDeckSpot(batSide);
      this.upsert("deck", snapshot.onDeck, {
        role: "ondeck",
        home: spot,
        facing: yawToward(spot, fp(0, 0)),
        pose: "idle",
      });
    }

    for (const base of ["first", "second", "third"] as const) {
      const runner = snapshot.runners[base];
      if (!runner) continue;
      const actorKey = `run:${base}`;
      seen.add(actorKey);
      const spot = standingSpot(base);
      this.upsert(actorKey, runner, {
        role: "runner",
        home: spot,
        facing: yawToward(spot, basePathPoint(BASE_ORDER.indexOf(base) + 1)),
        pose: "ready",
      });
    }

    let changed = false;
    for (const key of [...this.actors.keys()]) {
      if (!seen.has(key)) {
        this.actors.delete(key);
        changed = true;
      }
    }
    if (changed) this.rosterVersion++;

    if (materializing) {
      // The park was empty a moment ago. Every actor `upsert` just placed
      // solid and visible gets pulled back to fully dissolved and flagged
      // arriving, so there is something for the transporter effect to resolve
      // out of - the fade back to solid then runs one frame at a time in
      // `update`, whether or not the game has already thrown the next pitch.
      const arriving = [...this.actors.values()];
      for (const actor of arriving) {
        actor.dissolve = 1;
        actor.arriving = true;
      }
      this.beamRoster(arriving);
      const half = snapshot.isTopInning ? "Top" : "Bottom";
      this.setCallout("PLAY BALL", "neutral", `${half} ${snapshot.inningOrdinal}`);
      this.setShot("center", { cut: true, force: true });
    } else if (hadWorld && snapshot.batter && prevBatterId !== snapshot.batter.id) {
      // A new hitter is at the plate. Rather than pop the last one out and the
      // next one in, beam the newcomer up the way the retired batter beamed
      // away - the same effect run backwards. Only on a genuine change of
      // hitter, never between pitches to the same one, and never on the very
      // first snapshot when the whole world is being placed at once.
      const bat = this.actors.get("bat");
      if (bat) {
        bat.dissolve = 1;
        bat.arriving = true;
        this.beamRoster([bat]);
      }
    }
  }

  private upsert(
    key: string,
    player: PlayerRef,
    config: {
      role: Actor["role"];
      home: Vector3;
      facing: number;
      pose: Pose;
      positionKey?: PositionKey;
    },
  ) {
    const existing = this.actors.get(key);
    if (existing && existing.playerId === player.id) {
      existing.home = config.home.clone();
      existing.position.copy(config.home);
      existing.facing = config.facing;
      existing.pose = config.pose;
      existing.poseT = 0;
      existing.visible = true;
      existing.dissolve = 0;
      existing.arriving = false;
      existing.role = config.role;
      existing.positionKey = config.positionKey;
      return;
    }
    this.actors.set(key, {
      key,
      playerId: player.id,
      name: player.name,
      shortName: player.shortName,
      number: player.number,
      side: player.side,
      batSide: player.batSide,
      role: config.role,
      positionKey: config.positionKey,
      home: config.home.clone(),
      position: config.home.clone(),
      facing: config.facing,
      pose: config.pose,
      poseT: 0,
      visible: true,
      dissolve: 0,
      arriving: false,
      label: null,
    });
    this.rosterVersion++;
  }

  enqueue(events: NormalizedEvent[]) {
    this.queue.push(...events);
    // A long backlog means we fell behind (tab was hidden, feed hiccup).
    // Drop the play-by-play detail and keep the outcomes.
    if (this.queue.length > 14) {
      this.queue = this.queue.filter((e) => e.type !== "pitch").slice(-8);
    }
    this.queueLength = this.queue.length;
  }

  clearQueue() {
    this.fx.clear();
    this.queue = [];
    this.current = null;
    this.currentTime = 0;
    this.queueLength = 0;
    this.busy = false;
  }

  isIdle(): boolean {
    return !this.current && this.queue.length === 0;
  }

  update(dt: number) {
    // Animations are timed against the wall clock, not accumulated frame
    // deltas. A slow frame rate then costs smoothness rather than putting the
    // whole game into slow motion and backing the event queue up forever.
    const now = this.now();

    if (this.current) {
      this.currentTime = (now - this.currentStart) / 1000;
      this.current.update(this.currentTime, dt);
      if (this.currentTime >= this.current.duration) {
        this.current.onEnd?.();
        this.current = null;
        this.currentTime = 0;
      }
    }

    if (!this.current && this.queue.length > 0) {
      const anim = this.compileNext();
      if (anim) {
        this.current = anim;
        this.currentTime = 0;
        this.currentStart = this.now();
        this.idleTime = 0;
        this.resetIdleCamera();
        anim.onStart?.();
        anim.update(0, 0);
      }
    }

    this.busy = !this.isIdle();
    this.queueLength = this.queue.length;
    // The knock on the lens dies away over about half a second.
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);

    // Beam-ins resolve every frame, busy or idle. Play often resumes the
    // instant a side lands - a pitch starts before the field is idle again - so
    // leaving the fade to the idle path is what left the new fielders hanging
    // as tiny half-beamed models through the first pitch of the half.
    for (const actor of this.actors.values()) {
      if (!actor.arriving) continue;
      actor.dissolve = Math.max(0, actor.dissolve - dt / MATERIALIZE_TIME);
      if (actor.dissolve <= 0) actor.arriving = false;
    }

    if (this.isIdle()) {
      this.idleTime += dt;
      this.restIdle(dt);
    }

    if (this.callout && Date.now() - this.callout.at > 4200) {
      this.callout = null;
    }

    // Trail fades even when the ball is parked.
    if (this.ball.trail.length > 0 && !this.ball.visible) {
      this.ball.trail.length = Math.max(0, this.ball.trail.length - 1);
    }
  }

  /** Gentle drift back to resting positions between plays. */
  private restIdle(dt: number) {
    const k = Math.min(1, dt * 3);
    for (const actor of this.actors.values()) {
      if (!actor.visible) continue;
      actor.position.lerp(actor.home, k);
      if (
        actor.pose === "run" ||
        actor.pose === "walk" ||
        actor.pose === "throw" ||
        actor.pose === "swing" ||
        actor.pose === "dive" ||
        actor.pose === "annoyed" ||
        actor.pose === "celebrate"
      ) {
        actor.poseT += dt;
        // A reaction is worth holding; a movement is not.
        const hold = actor.pose === "annoyed" || actor.pose === "celebrate" ? 3.2 : 0.6;
        if (actor.poseT > hold) {
          actor.pose =
            actor.positionKey === "catcher"
              ? "crouch"
              : actor.role === "fielder"
                ? "ready"
                : "idle";
          actor.poseT = 0;
        }
      } else {
        actor.poseT += dt;
      }
    }
    this.idleCamera();
    if (this.ball.visible && this.idleTime > 1.2) {
      this.ball.visible = false;
    }
  }

  /**
   * What the broadcast looks at while it waits. The play ends, the shot cuts
   * home to centre field, and then - only if the game stays quiet for a good
   * while longer - it takes a few seconds somewhere else before coming back.
   *
   * The pacing is the point. Cutting away every couple of seconds would read as
   * a screensaver rather than a broadcast, and a viewer who looks up mid-cutaway
   * should still be back on the pitch well before it is thrown.
   */
  private idleCamera() {
    if (this.idleTime < IDLE_SETTLE) return;

    // The field is empty and nobody is warming up: hold on whatever shot the
    // change of sides cut to instead of wandering off to a base with no
    // runner on it or a mound with no pitcher.
    if (this.awaitingReturn) return;

    if (this.onIdleCutaway) {
      if (this.idleTime < this.idleCutEnd) return;
      this.endIdleCutaway();
      this.setShot("center", { cut: true, force: true });
      return;
    }

    // Coming out of a play: home first, and the lull is measured from there.
    if (this.cameraMode !== "center") {
      this.setShot("center", { cut: true, force: true });
      return;
    }

    if (this.idleTime < IDLE_CUTAWAY_AFTER) return;
    if (this.now() - this.lastCutawayAt < IDLE_CUTAWAY_GAP * 1000) return;
    // The runner at first is only a shot when there is one; with the bases
    // empty it is a picture of a base.
    const shots = this.snapshot?.runners.first
      ? IDLE_SHOTS
      : IDLE_SHOTS.filter((mode) => mode !== "base");
    const shot = shots[this.idleShot % shots.length];
    this.idleShot += 1;
    this.onIdleCutaway = true;
    this.idleCutEnd = this.idleTime + IDLE_CUTAWAY_HOLD;
    this.setShot(shot, { cut: true, force: true });
  }

  private endIdleCutaway() {
    this.onIdleCutaway = false;
    this.lastCutawayAt = this.now();
  }

  /**
   * Something is about to happen. Whatever the camera had wandered off to, the
   * play's own shot takes over from here - and a cutaway the game interrupted
   * still counts as one, so the next is a full gap away rather than immediately
   * after the pitch that cut it short.
   */
  private resetIdleCamera() {
    if (this.onIdleCutaway) this.endIdleCutaway();
  }

  private compileNext(): Anim | null {
    const next = this.queue.shift();
    if (!next) return null;

    switch (next.type) {
      case "pitch": {
        // A ball in play flows straight into its result, so compile them as one.
        if (next.startsPlay && this.queue[0]?.type === "play_result") {
          const result = this.queue.shift() as PlayResultEvent;
          return this.compileAtBat(next, result);
        }
        return this.compilePitch(next);
      }
      case "play_result":
        return this.compileResult(next);
      case "action":
        return this.compileAction(next);
      case "inning_change":
        return this.compileInningChange(next);
      default:
        return null;
    }
  }

  private setCallout(text: string, tone: CallOut["tone"], detail?: string) {
    this.callout = { text, tone, detail, at: Date.now() };
  }

  private pitcher(): Actor | undefined {
    return this.actors.get("def:pitcher");
  }

  private batter(): Actor | undefined {
    return this.actors.get("bat");
  }

  private releasePoint(): Vector3 {
    const hand = this.snapshot?.defense.pitcher?.pitchHand ?? "R";
    // Arm side: a right-hander's hand comes over the third-base side of the
    // rubber, which is negative lateral here.
    return fp(hand === "R" ? -RELEASE_LATERAL : RELEASE_LATERAL, RELEASE_DEPTH, RELEASE_HEIGHT);
  }

  /**
   * Windup, flight to the plate, and the reaction. Returns the time at which
   * the ball reaches the plate so callers can chain contact onto it.
   *
   * The windup, the arm coming over, and the ball leaving the hand are three
   * separate instants. They used to be two: the ball appeared at the release
   * point on the same frame the throwing motion began, which put it in the air
   * while the arm was still cocked behind the pitcher's head.
   */
  private pitchFlight(pitch: PitchEvent): {
    windupEnd: number;
    releaseAt: number;
    plateTime: number;
    update: (t: number) => void;
  } {
    const cue = new Cue();
    const windupEnd = 0.62;
    // The arm needs a moment to come over before the ball can leave it.
    const releaseAt = windupEnd + THROW_TIME * THROW_RELEASE;
    const release = this.releasePoint();
    const plate = fp(pitch.plate.x * PLATE_RISE, PLATE_DEPTH, zoneHeight(pitch.plate.z));
    const hand = this.snapshot?.defense.pitcher?.pitchHand ?? "R";
    const arc = pitchArc(release, plate, pitch.pitchType, pitch.speed, hand);
    const plateTime = releaseAt + arc.flightTime;

    return {
      windupEnd,
      releaseAt,
      plateTime,
      update: (t: number) => {
        const pitcher = this.pitcher();
        if (pitcher) {
          if (t < windupEnd) {
            pitcher.pose = "windup";
            pitcher.poseT = clamp01(t / windupEnd);
          } else if (t < plateTime + 0.6) {
            pitcher.pose = "throw";
            pitcher.poseT = clamp01((t - windupEnd) / THROW_TIME);
          }
        }

        if (t < releaseAt) {
          this.ball.visible = false;
          return;
        }
        cue.at("release", t, releaseAt, () => {
          this.onSound?.("pitch");
          // The stride foot lands in front of the rubber and kicks up the mound.
          this.fx.puff(fp(0, RELEASE_DEPTH - 5, 0.6), 9, { spread: 3.4, lift: 2.6, size: 0.85 });
        });
        if (t <= plateTime) {
          const u = clamp01((t - releaseAt) / arc.flightTime);
          const inv = 1 - u;
          this.ball.position
            .copy(release)
            .multiplyScalar(inv * inv)
            .addScaledVector(arc.control, 2 * inv * u)
            .addScaledVector(plate, u * u);
          if (arc.wobble) {
            // A knuckleball has no break to speak of, just no idea where it is
            // going. Faded in so it never disturbs the release point.
            this.ball.position.x += Math.sin(u * 11.3) * arc.wobble * u * inv * 2;
            this.ball.position.y += Math.sin(u * 8.7 + 1.9) * arc.wobble * u * inv * 1.4;
          }
          this.ball.visible = true;
          this.ball.scale = 1.9;
          this.pushTrail();
        }
      },
    };
  }

  private pushTrail() {
    this.ball.trail.push(this.ball.position.clone());
    if (this.ball.trail.length > 14) this.ball.trail.shift();
  }

  /**
   * Drives the swing. It starts before the ball arrives and follows through
   * after it, so `swingStart` leads contact - a swing that stops dead the
   * instant the ball is struck reads as a mistimed one.
   */
  private swingAt(t: number, swingStart: number, contact: boolean) {
    const batter = this.batter();
    if (!batter) return;
    if (t < swingStart) return;
    if (t < swingStart + SWING_TIME) {
      // Once the batter has taken off for first, running wins.
      if (batter.pose === "run") return;
      batter.pose = "swing";
      batter.poseT = clamp01((t - swingStart) / SWING_TIME);
    } else if (!contact && batter.pose === "swing") {
      batter.pose = "ready";
    }
  }

  private compilePitch(pitch: PitchEvent): Anim {
    const cue = new Cue();
    const flight = this.pitchFlight(pitch);
    const swings =
      pitch.outcome === "swinging_strike" || pitch.outcome === "foul";
    const foul = pitch.outcome === "foul" ? foulBallFor(pitch) : null;
    // The catcher's mitt, which sits at the bottom of the zone.
    const mittSpot = fp(0, -5.5, zoneHeight(1.4));
    const tail = foul ? 1.5 : 0.75;
    const duration = flight.plateTime + tail;

    return {
      label: `pitch:${pitch.id}`,
      duration,
      onStart: () => {
        this.pitchCount += 1;
        // Whoever is hitting is solid again: the previous batter may have been
        // beamed out with the queue still backed up behind them.
        const hitter = this.batter();
        if (hitter) {
          hitter.dissolve = 0;
          hitter.arriving = false;
          hitter.visible = true;
        }
        // Two strikes is worth a tight look at the hitter; every fourth pitch
        // otherwise gets the long lens on the pitcher, cut back at release.
        // Everything else is thrown from centre field, the way every pitch on
        // television is - and it cuts there, whether it is coming back from a
        // cutaway or from the last play.
        if (pitch.count.strikes >= 2) this.setShot("slot", { cut: true, force: true });
        else if (this.pitchCount % 4 === 0) this.setShot("mound", { cut: true, force: true });
        else this.setShot("center", { cut: true, force: true });
      },
      update: (t) => {
        flight.update(t);
        if (this.cameraMode === "mound") {
          cue.at("cutback", t, flight.releaseAt, () =>
            this.setShot("center", { cut: true, force: true }),
          );
        }
        if (swings || pitch.outcome === "in_play") {
          this.swingAt(t, flight.plateTime - SWING_LEAD, false);
        }

        cue.at("plate", t, flight.plateTime, () => {
          if (foul) this.onSound?.("foul");
          else this.onSound?.("mitt");
        });

        if (t > flight.plateTime) {
          const u = clamp01((t - flight.plateTime) / (foul ? 1.1 : 0.32));
          if (foul) {
            // Foul: kick the ball up and back out of play.
            const target = fp(foul.lateral, foul.depth, 0);
            const p = fp(pitch.plate.x * PLATE_RISE, PLATE_DEPTH, zoneHeight(pitch.plate.z))
              .lerp(target, easeOut(u));
            p.y = Math.max(0.5, zoneHeight(pitch.plate.z) + 46 * u * (1 - u) * 2.2 - u * u * 2);
            this.ball.position.copy(p);
            this.ball.visible = true;
            this.pushTrail();
          } else {
            this.ball.position.lerp(mittSpot, Math.min(1, u * 1.4));
            this.ball.visible = u < 0.9;
          }
        }
      },
      onEnd: () => {
        const speed = pitch.speed ? `${Math.round(pitch.speed)} MPH` : undefined;
        const detail = [pitch.pitchType, speed].filter(Boolean).join(" · ");
        switch (pitch.outcome) {
          case "ball":
            this.setCallout("BALL", "neutral", detail);
            break;
          case "called_strike":
            this.setCallout("STRIKE", "bad", detail || "Called");
            break;
          case "swinging_strike":
            this.setCallout("SWING & MISS", "bad", detail);
            break;
          case "foul":
            this.setCallout("FOUL", "neutral", detail);
            break;
          case "hit_by_pitch":
            this.setCallout("HIT BY PITCH", "neutral", detail);
            break;
          default:
            break;
        }
        this.ball.visible = false;
        this.onCount?.(countAfter(pitch));
      },
    };
  }

  /** A pitch that was put in play, plus everything that followed. */
  /** Which box the hitter is standing in, for anything aimed at the plate. */
  private batSide(): "R" | "L" {
    return this.snapshot?.batter?.batSide ?? "R";
  }

  private compileAtBat(pitch: PitchEvent, result: PlayResultEvent): Anim {
    const cue = new Cue();
    const flight = this.pitchFlight(pitch);
    const contactAt = flight.plateTime;
    const inner = this.compileResult(result);

    return {
      label: `atbat:${result.id}`,
      duration: contactAt + inner.duration,
      onStart: () => inner.onStart?.(),
      update: (t, dt) => {
        cue.at("crack", t, contactAt, () => {
          this.onSound?.("crack");
          // Chips of dirt off the back foot as the hitter turns on it.
          this.fx.spray(contactPoint(this.batSide()).setY(0.5), new Vector3(0, 1, 0.2), 10, 0.55);
          // The camera reacts to contact the way a crowd does, and how hard the
          // ball was hit is most of that reaction.
          const heat = result.ball ? heatOf(result.ball) : 0;
          const big = result.kind === "home_run" || result.kind === "triple";
          this.knockCamera(big ? 0.85 : result.ball ? 0.2 + heat * 0.55 : 0.2);
          // A ball scalded on a line deserves the same angle a home run gets:
          // nothing sells a screamer like a camera at the height it is
          // travelling at.
          const screamer = result.ball?.trajectory === "line_drive" && heat > 0.72;
          if (big || screamer) this.setShot("low", { cut: true, force: true });
        });
        if (t <= contactAt) {
          flight.update(t);
        } else {
          // `dt` used to be passed as zero here, which froze every pose that
          // advances on it: runners never took a stride on any batted ball,
          // because every batted ball comes through this wrapper.
          inner.update(t - contactAt, dt);
        }
        // The swing runs to its finish rather than stopping dead at contact -
        // it starts before the ball arrives and follows through after it.
        this.swingAt(t, contactAt - SWING_LEAD, true);
      },
      onEnd: () => inner.onEnd?.(),
    };
  }

  /**
   * The batted ball, the defense converging on it, and every runner move.
   * The returned animation always starts at t = 0.
   */
  private compileResult(result: PlayResultEvent): Anim {
    const ball = result.ball;
    const tracks = this.prepareRunners(result);

    /**
     * Was the ball caught on the fly? This is the difference between a hit and
     * an out, and it used to be missing: every batted ball ended with the
     * fielder playing a catch at the landing spot, so a clean single looked
     * exactly like a flyout. A ball that is not caught has to reach the
     * ground, bounce, and be run down.
     */
    const caughtInAir =
      !!ball &&
      !ball.isHomeRun &&
      CAUGHT_KINDS.has(result.kind) &&
      ball.trajectory !== "ground_ball" &&
      ball.trajectory !== "bunt";

    // Everything about the flight - the shape of the carry, where it first
    // comes down, how it bounces out, who runs it down and who it beats on the
    // way - is worked out once, up front. See `./batted`.
    const plan: BattedPlan | null = ball
      ? planBattedBall(ball, {
          contact: contactPoint(this.batSide()),
          caught: caughtInAir,
          hit: HIT_KINDS.has(result.kind),
        })
      : null;

    const landing = plan ? plan.landing : null;
    const ballDuration = plan ? plan.carryTime : 0;
    const gatherAt = plan ? plan.gatherTime : 0;
    const throwStart = plan ? gatherAt + 0.4 : 0;
    const throwEnd = throwStart + 0.6;
    /** Where the ball ends up after the hops and the roll. */
    const restPoint = plan ? plan.rest : null;
    const fielderKey = plan && !ball?.isHomeRun ? `def:${plan.fielder}` : null;

    // A runner cannot be out before the play that retires him. Pushing the
    // out tracks past the catch (or past the throw arriving) is what stops a
    // flyout resolving while the ball is still in the air.
    if (ball) {
      const settled = caughtInAir ? ballDuration : throwEnd;
      for (const track of tracks) {
        if (track.isOut) track.end = Math.max(track.end, settled + 0.2);
      }
    }
    const runnerEnd = tracks.reduce((max, r) => Math.max(max, r.end), 0);

    // Where a throw goes: the base an out was recorded at, else first.
    const outTrack = tracks.find((r) => r.isOut);
    const throwTarget = outTrack
      ? basePathPoint(outTrack.to).setY(2.5)
      : BASE_POSITIONS.first.clone().setY(2.5);

    // Long enough after the call for the beam-out to finish playing.
    const holdAfter = result.kind === "home_run" ? 4.2 : 2.4;
    let duration = Math.max(runnerEnd, ball ? throwEnd : 0.4) + holdAfter;

    const cue = new Cue();
    /** Where the chasing defender and the diving one started from. */
    let chaseFrom: Vector3 | null = null;
    let diveFrom: Vector3 | null = null;

    /**
     * When the call goes up. Naming the play the instant it starts gives away
     * every outcome worth waiting for - a double play, a triple, a ball off
     * the wall - so the callout waits until the diamond has settled it. A home
     * run is the exception: it is decided the moment the ball clears.
     */
    const revealAt = ball
      ? ball.isHomeRun
        ? ballDuration + 0.3
        : Math.max(runnerEnd, throwEnd)
      : 0.45;

    /** A strikeout is an out with nobody running: the batter simply leaves. */
    const retiresBatter = result.kind === "strikeout";

    // When the last man retired on this play has finished beaming off the
    // field. Retired players (a runner thrown out, or the strikeout victim)
    // start their beam 0.3s after they are settled and are gone 0.65s later.
    // A play with nobody out leaves this null - there is no send-off to wait on.
    const outEnds = tracks.filter((tr) => tr.isOut).map((tr) => tr.end + 0.95);
    if (retiresBatter) outEnds.push(revealAt + 0.95);
    const retireEnd = outEnds.length ? Math.max(...outEnds) : null;

    // Does this play end the half-inning? The third out is the trigger for the
    // change of sides, not the feed's linescore catching up a beat later. Not
    // when the game itself is over - there is no side to bring back on, so that
    // third out is left to the game-over overlay instead.
    const endsHalf = result.outsAfter >= 3 && !this.gameOver;

    // The choreography of the change of sides, hung off the end of the play: a
    // beat after the last out, the side in the field beams away together, the
    // park holds empty, and `applySnapshot` brings the next half on once the
    // feed says who they are. `awaitingReturn` covers the wait; see there.
    const settleAt = retireEnd ?? Math.max(runnerEnd, ball ? throwEnd : 0.45);
    const fieldBeamStart = settleAt + 0.6;
    const intermissionEnd = fieldBeamStart + INNING_BEAM_OUT + INNING_HOLD;
    let departingField: Actor[] | null = null;

    if (endsHalf) {
      duration = Math.max(duration, intermissionEnd);
    } else if (retireEnd !== null) {
      // Hold on the retired hitter long enough to see him go, then cut back to
      // the pitcher for the next one rather than snapping away at the out.
      duration = Math.max(duration, retireEnd + POST_OUT_PAUSE + 0.6);
    }

    // The crowd is the home crowd: it cheers what is good for the home club and
    // groans at everything else, whichever side made the play.
    const weight = CROWD_WEIGHT[result.kind];
    const reaction = weight
      ? {
          at:
            result.kind === "home_run"
              ? ballDuration * 0.8
              : weight.favorsBatter
                ? ballDuration
                : Math.max(0.15, ballDuration),
          favorsBatter: weight.favorsBatter,
          magnitude: weight.magnitude,
          ...this.crowdVoice(weight.favorsBatter, weight.magnitude),
        }
      : null;

    return {
      label: `result:${result.id}`,
      duration,
      onStart: () => {
        if (ball) {
          // A ball that never gets above the infielders' heads needs the
          // diamond in shot to read at all; one in the air can be chased.
          this.cameraFollow =
            result.kind === "home_run" ? 0.6 : plan && plan.apex < 14 ? 0.22 : 0.32;
          this.setShot("ball");
        }
      },
      update: (t, dt) => {
        cue.at("reveal", t, revealAt, () => this.announce(result));
        // A strikeout retires the batter without anybody running anywhere, so
        // it gets the same send-off a runner thrown out on the bases does.
        if (retiresBatter) {
          const batter = this.batter();
          if (batter) {
            cue.at("beam:batter", t, revealAt + 0.3, () => this.beamOut(batter));
            batter.dissolve = clamp01((t - revealAt - 0.3) / 0.5);
            batter.visible = t < revealAt + 0.95;
          }
        }
        if (reaction) {
          cue.at("reaction", t, reaction.at, () => {
            this.onSound?.(reaction.sound, reaction.intensity);
            // The stands move to the same beat the cheer sounds on - after the
            // outcome is settled, so they never tip a big play early.
            this.stirCrowd(reaction.favorsBatter, reaction.magnitude);
            // A home run gets its show started while the ball is still up.
            if (result.kind === "home_run") this.launchFireworks(5);
          });
        }
        // Every run that crosses the plate brings out the confetti.
        for (const track of tracks) {
          if (!track.scored) continue;
          cue.at(`score:${track.actorKey}`, t, track.end, () => {
            const voice = this.crowdVoice(true, 0.8);
            this.onSound?.(voice.sound, voice.intensity);
            // A run crossing re-erupts the stands, on top of any hit reaction.
            this.stirCrowd(true, 0.85);
            this.throwConfetti(result.kind === "home_run" ? 200 : 140);
            this.launchFireworks(result.kind === "home_run" ? 7 : 3);
          });
        }

        // --- Ball ---
        if (ball && plan && landing) {
          if (t <= gatherAt) {
            // One path covers the carry, the hops and the roll: the plan knows
            // where the ball is at any moment, and how long it stays down there
            // waiting to be picked up.
            this.ball.position.copy(plan.at(t));
            this.ball.visible = true;
            this.ball.scale = 2.8;
            this.pushTrail();
            // Every time it strikes the dirt it says so and throws some of it.
            plan.bounces.forEach((when, i) => {
              cue.at(`bounce:${i}`, t, when, () => {
                const fade = i === 0 ? 1 : 0.45;
                this.onSound?.("mitt", 0.3 * fade);
                const where = this.ball.position.clone().setY(0.4);
                this.fx.spray(
                  where,
                  where.clone().setY(0).normalize().setY(0.8),
                  Math.round((8 + 10 * plan.heat) * fade),
                  (0.5 + 0.4 * plan.heat) * fade,
                );
              });
            });
          } else if (ball.isHomeRun) {
            // Carry it into the seats.
            const u = clamp01((t - ballDuration) / 1.2);
            const beyond = landing
              .clone()
              .setY(0)
              .multiplyScalar(1 + 0.16 * u);
            this.ball.position.set(beyond.x, Math.max(1, 26 * (1 - u)), beyond.z);
            this.ball.visible = true;
            this.pushTrail();
          } else if (t <= throwEnd) {
            // Gathered: it is in a glove now, not lying in the grass.
            const held = restPoint ?? landing;
            this.ball.position.copy(held).setY(caughtInAir ? GLOVE_HEIGHT : 3.2);
            if (t >= throwStart) {
              const u = clamp01((t - throwStart) / (throwEnd - throwStart));
              const p = held.clone().setY(3.2).lerp(throwTarget, easeInOut(u));
              p.y = 3.2 + 6 * u * (1 - u) * 4;
              this.ball.position.copy(p);
              this.pushTrail();
            }
          } else {
            this.ball.visible = false;
          }
        }

        // --- Defense ---
        if (fielderKey && landing) {
          const fielder = this.actors.get(fielderKey);
          if (fielder) {
            // He runs a route rather than being dragged toward the ball a
            // fraction at a time: he leaves his own spot, and he arrives at the
            // moment the ball is gathered, which is what makes a ball in the
            // gap cost more than one hit straight at him.
            chaseFrom ??= fielder.position.clone();
            const u = clamp01(t / Math.max(0.35, gatherAt));
            // A ball at the wall would otherwise walk the fielder through it.
            const target = playableSpot((restPoint ?? landing).clone().setY(0));
            fielder.position.copy(chaseFrom).lerp(target, easeOut(u));
            fielder.facing = yawToward(
              fielder.position,
              target.distanceTo(fielder.position) > 1 ? target : fp(0, 0),
            );
            if (t < gatherAt) {
              fielder.pose = "run";
              fielder.poseT = (fielder.poseT + dt * 1.6) % 1;
            } else if (t < throwStart) {
              cue.at("field", t, gatherAt, () =>
                this.fx.puff(fielder.position.clone(), 7, { spread: 3.2, lift: 2, size: 0.8 }),
              );
              fielder.pose = "catch";
              fielder.poseT = clamp01((t - gatherAt) / 0.25);
            } else if (t < throwEnd) {
              fielder.pose = "throw";
              fielder.poseT = clamp01((t - throwStart) / 0.55);
            } else if (fielder.pose === "throw" || fielder.pose === "catch") {
              // Only ever undoing our own pose: a pitcher who fielded the ball
              // and then wore the hit is sulking about it, and standing him
              // back up every frame is not an improvement.
              fielder.pose = "ready";
            }
          }
        }

        // A ball that got through went past somebody: whoever it beat breaks
        // on it, lays out, and comes up with a handful of infield dirt. This is
        // most of what makes a ground-ball single look like one rather than
        // like a routine play that happened to be scored a hit.
        if (plan?.beaten) {
          const diver = this.actors.get(`def:${plan.beaten.key}`);
          if (diver) {
            const lunge = Math.max(0.12, plan.beaten.at - 0.16);
            diveFrom ??= diver.position.clone();
            const u = clamp01(t / lunge);
            diver.position.copy(diveFrom).lerp(plan.beaten.spot, easeOut(u));
            diver.facing = yawToward(diveFrom, plan.beaten.spot);
            if (t < lunge) {
              diver.pose = "run";
              diver.poseT = (diver.poseT + dt * 2.1) % 1;
            } else if (t < lunge + 1.5) {
              cue.at("dive", t, lunge, () =>
                this.fx.puff(diver.position.clone(), 16, { spread: 6, lift: 2.4, size: 1 }),
              );
              diver.pose = "dive";
              diver.poseT = clamp01((t - lunge) / 0.85);
            } else if (diver.pose === "dive") {
              // Back on his feet, watching it go.
              diver.pose = "ready";
            }
          }
        }

        // --- Runners ---
        for (const track of tracks) {
          const actor = this.actors.get(track.actorKey);
          if (!actor) continue;
          if (t < track.start) continue;
          const u = clamp01((t - track.start) / Math.max(0.001, track.end - track.start));
          const progress = track.from + (track.to - track.from) * easeInOut(u);
          const bow = track.to - track.from > 1 ? 1 : 0;
          const point = basePathPoint(progress, bow);
          const ahead = basePathPoint(Math.min(4, progress + 0.08), bow);
          actor.position.set(point.x, 0, point.z);
          actor.facing = yawToward(actor.position, ahead);
          actor.visible = true;
          if (u < 1) {
            actor.pose = track.walking ? "walk" : "run";
            actor.poseT = (actor.poseT + dt * (track.walking ? 0.75 : 1.9)) % 1;
          } else {
            // Spikes into the bag. A runner who was thrown out slid hardest.
            cue.at(`slide:${track.actorKey}`, t, track.end, () =>
              this.fx.puff(actor.position.clone(), track.isOut ? 22 : 13, {
                spread: track.isOut ? 8 : 5.5,
                lift: 3,
                size: 1.15,
              }),
            );
            // A hitter who just pulled up safe at a bag has a word for the
            // dugout about it.
            const safeAtBase = !track.isOut && !track.scored && HIT_KINDS.has(result.kind);
            actor.pose = track.isOut
              ? "dejected"
              : track.scored
                ? "celebrate"
                : safeAtBase
                  ? "celebrate"
                  : "ready";
            if (safeAtBase) actor.poseT = clamp01((t - track.end) / 1.4);
            if (track.isOut) {
              // Beamed off the field rather than simply switched off.
              cue.at(`beam:${track.actorKey}`, t, track.end + 0.3, () => this.beamOut(actor));
              actor.dissolve = clamp01((t - track.end - 0.3) / 0.5);
              actor.visible = t < track.end + 0.95;
            }
            if (track.scored) actor.visible = t < track.end + 0.9;
          }
        }

        // --- Reactions ---
        // The pitcher wears a hit, and the hitter enjoys one.
        if (HIT_KINDS.has(result.kind)) {
          cue.at("sulk", t, revealAt, () => {
            const pitcher = this.pitcher();
            if (pitcher) {
              pitcher.pose = "annoyed";
              pitcher.poseT = 0;
            }
          });
        }

        // --- Change of sides ---
        // The third out empties the field. A beat after the last man is gone,
        // whoever is still standing there beams away together and the park
        // holds empty until the next half's roster lands through
        // `applySnapshot`. This owns the leaving and the wait; the arrival is
        // out of this clock's hands.
        if (endsHalf) {
          cue.at("changeSides", t, fieldBeamStart, () => {
            this.awaitingReturn = true;
            this.awaitingSide = this.snapshot?.fieldingSide ?? null;
            this.setShot("wide", { cut: true, force: true });
            this.setCallout("SIDE RETIRED", "neutral", "Change of sides");
            departingField = [...this.actors.values()].filter((a) => a.visible);
            this.beamRoster(departingField);
          });
          if (departingField) {
            const u = clamp01((t - fieldBeamStart) / INNING_BEAM_OUT);
            for (const actor of departingField) {
              actor.dissolve = u;
              if (u >= 1) actor.visible = false;
            }
          }
        }

        // --- Camera ---
        // A home run is three shots: low off the bat, wide as it leaves, then
        // back to the plate for the trot. The change of sides owns the camera
        // once it starts, so the returns-to-the-pitcher below stand down for it.
        if (result.kind === "home_run") {
          cue.at("hr:wide", t, ballDuration + 0.85, () =>
            this.setShot("wide", { cut: true, force: true }),
          );
          cue.at("hr:trot", t, ballDuration + 3.4, () => {
            const trot = tracks.find((track) => track.scored);
            this.setShot("follow", { cut: true, force: true, follow: trot?.actorKey });
          });
        } else if (endsHalf) {
          // Handled by the change-of-sides cut above.
        } else if (retireEnd !== null) {
          // An out that keeps the half alive: watch the retired man beam off,
          // let it breathe, then cut back to the pitcher for the next hitter -
          // the long lens on a strikeout, centre field otherwise.
          cue.at("post-out", t, retireEnd + POST_OUT_PAUSE, () =>
            this.setShot(retiresBatter ? "mound" : "center", { cut: true, force: true }),
          );
        } else if (ball && t > throwEnd) {
          // A hit: the throw is caught and the play is over, back to the pitch
          // camera. A cut, not a glide - centre field is three hundred feet
          // from wherever the ball was, and sliding there would take all day.
          this.setShot("center", { cut: true });
        }
      },
      onEnd: () => {
        this.ball.visible = false;
        for (const track of tracks) {
          const actor = this.actors.get(track.actorKey);
          if (actor && (track.isOut || track.scored)) actor.visible = false;
        }
        // The whole field left on the third out - make sure none of them are
        // left behind half-beamed if the animation was cut short.
        if (endsHalf && departingField) {
          for (const actor of departingField) {
            actor.dissolve = 1;
            actor.visible = false;
          }
        }
        this.onPlayResolved?.(result);
      },
    };
  }

  /**
   * Bind each runner move to an actor. Existing actors are reused where we can
   * so nobody pops out of existence mid-stride.
   */
  private prepareRunners(result: PlayResultEvent): RunnerTrack[] {
    const tracks: RunnerTrack[] = [];
    const moves = [...result.runners].sort((a, b) => {
      const pa = runnerProgress(a);
      const pb = runnerProgress(b);
      return pb.from - pa.from; // Lead runners break first.
    });

    // A strikeout retires the batter at the plate. The feed still lists him as
    // a runner who was put out, but running to first and being called out
    // there is not what happened - he simply leaves.
    const strikeout = result.kind === "strikeout";
    const walked = result.kind === "walk" || result.kind === "hit_by_pitch";

    for (const move of moves) {
      const { from, to } = runnerProgress(move);
      if (to === from && !move.isScoring && move.to !== "out") continue;
      if (strikeout && from === 0) continue;
      const actorKey = this.actorKeyForRunner(move, from);
      if (!actorKey) continue;

      const bases = Math.max(0.5, to - from);
      // Nobody runs on a walk - they drop the bat and stroll down to first.
      const perBase = walked
        ? WALK_PER_BASE
        : result.kind === "home_run"
          ? TROT_PER_BASE
          : RUN_PER_BASE;
      const start = from === 0 ? 0.12 : 0.02;
      tracks.push({
        actorKey,
        from,
        to,
        start,
        end: start + bases * perBase,
        isOut: move.to === "out",
        scored: move.isScoring,
        walking: walked,
      });
    }
    return tracks;
  }

  private actorKeyForRunner(move: RunnerMove, fromProgress: number): string | null {
    const batting = this.snapshot?.battingSide ?? "away";
    // Already on the field somewhere? Only the batting side can be running the
    // bases, and a fielder never is - without that guard a stray id match could
    // put a defender on the basepaths, wearing the wrong uniform and the wrong
    // species.
    for (const [key, actor] of this.actors) {
      if (actor.role === "fielder" || actor.side !== batting) continue;
      if (actor.playerId === move.playerId) return key;
    }
    // The batter becoming a runner.
    const batter = this.batter();
    if (fromProgress === 0 && batter) return "bat";

    // Fall back to a transient actor so unknown runners still animate.
    const side = batting;
    const key = `mv:${move.playerId}`;
    const spot = basePathPoint(fromProgress);
    this.upsert(
      key,
      {
        id: move.playerId,
        name: move.name,
        shortName: move.name.split(" ").slice(-1)[0],
        side,
      },
      { role: "runner", home: spot, facing: 0, pose: "run" },
    );
    return key;
  }

  private announce(result: PlayResultEvent) {
    const map: Partial<Record<PlayResultEvent["kind"], [string, CallOut["tone"]]>> = {
      single: ["SINGLE", "good"],
      double: ["DOUBLE", "good"],
      triple: ["TRIPLE", "big"],
      home_run: ["HOME RUN!", "big"],
      walk: ["WALK", "neutral"],
      strikeout: ["STRIKEOUT", "bad"],
      field_out: ["OUT", "bad"],
      double_play: ["DOUBLE PLAY", "bad"],
      error: ["ERROR", "neutral"],
      hit_by_pitch: ["HIT BY PITCH", "neutral"],
      sac_fly: ["SAC FLY", "good"],
    };
    const entry = map[result.kind] ?? [result.event.toUpperCase(), "neutral" as const];
    const extra =
      result.ball?.launchSpeed && result.ball.distance > 100
        ? `${Math.round(result.ball.launchSpeed)} MPH · ${Math.round(result.ball.distance)} FT`
        : result.description;
    this.setCallout(entry[0], entry[1], extra);
  }

  private compileAction(event: NormalizedEvent & { type: "action" }): Anim {
    const isSteal = /steal/i.test(event.eventType) || /steals/i.test(event.description);
    const duration = isSteal ? 2.6 : 0.9;
    const cue = new Cue();
    let track: RunnerTrack | null = null;

    if (isSteal) {
      // Move the trailing runner up one base.
      const order: Array<[string, number]> = [
        ["run:third", 3],
        ["run:second", 2],
        ["run:first", 1],
      ];
      const target = /3rd|third/i.test(event.description)
        ? order.find(([k]) => k === "run:second")
        : order.find(([k]) => k === "run:first");
      if (target && this.actors.has(target[0])) {
        track = {
          actorKey: target[0],
          from: target[1],
          to: target[1] + 1,
          start: 0,
          end: 2.1,
          isOut: false,
          scored: false,
          walking: false,
        };
      }
    }

    return {
      label: `action:${event.id}`,
      duration,
      update: (t, dt) => {
        // Same rule as a batted ball: let the runner get there first.
        cue.at("reveal", t, duration * 0.8, () => {
          if (event.description) {
            this.setCallout(isSteal ? "STOLEN BASE" : "PLAY", "good", event.description);
          }
        });
        if (!track) return;
        const actor = this.actors.get(track.actorKey);
        if (!actor) return;
        const u = clamp01(t / (track.end - track.start));
        const point = basePathPoint(track.from + (track.to - track.from) * easeInOut(u));
        actor.position.set(point.x, 0, point.z);
        actor.pose = u < 1 ? "run" : "ready";
        actor.poseT = (actor.poseT + dt * 1.9) % 1;
      },
    };
  }

  /**
   * The change of sides, as a fallback. The third out normally drives this
   * straight off the play result (see `compileResult`), which is prompter and
   * survives the feed's linescore lagging a beat behind the out. By the time
   * this linescore-derived event arrives, the new half is usually already on
   * the field - so it stands down unless the transition somehow has not
   * happened yet (a half that ended on something other than a batter retired,
   * say a runner caught stealing, which never reaches `compileResult`).
   */
  private compileInningChange(event: NormalizedEvent & { type: "inning_change" }): Anim {
    // Who fields in the half we are changing *to*. Top of an inning, the home
    // side takes the field; the bottom, the visitors do.
    const targetFieldingSide: TeamSide = event.isTopInning ? "home" : "away";
    const fielderSide = this.pitcher()?.side ?? this.anyFielderSide();
    // Already handled if the third-out path is mid-change, or if the field
    // already shows the side that fields in the new half.
    const redundant = this.awaitingReturn || fielderSide === targetFieldingSide;

    // Whoever is actually on screen right now - only used on the fallback path.
    const departing = redundant
      ? []
      : [...this.actors.values()].filter((actor) => actor.visible);
    const duration = redundant ? 0.2 : INNING_BEAM_OUT + INNING_HOLD;

    return {
      label: `inning:${event.id}`,
      duration,
      onStart: () => {
        if (redundant) return;
        this.setCallout(event.description.toUpperCase(), "neutral", "Change of sides");
        this.setShot("wide", { cut: true, force: true });
        this.awaitingReturn = true;
        this.awaitingSide = this.snapshot?.fieldingSide ?? fielderSide;
        if (departing.length > 0) this.beamRoster(departing);
      },
      update: (t) => {
        if (redundant || t >= INNING_BEAM_OUT) return;
        const u = clamp01(t / INNING_BEAM_OUT);
        for (const actor of departing) {
          actor.dissolve = u;
          if (u >= 1) actor.visible = false;
        }
      },
      onEnd: () => {
        for (const actor of departing) {
          actor.dissolve = 1;
          actor.visible = false;
        }
      },
    };
  }

  /** The club currently in the field, read off any fielder we can find. */
  private anyFielderSide(): TeamSide | null {
    for (const actor of this.actors.values()) {
      if (actor.role === "fielder") return actor.side;
    }
    return null;
  }

  /**
   * Desired camera placement. `view` is the seat the viewer picked: anything
   * other than "broadcast" ignores the shot list and holds that vantage, so the
   * game plays out in front of a camera that never cuts.
   *
   * The broadcast's home shot is `center`, and every branch below is somewhere
   * it goes and comes back from.
   */
  desiredCamera(view: CameraView = "broadcast"): Shot {
    if (view !== "broadcast") {
      return seatCamera(view, this.ball.visible ? this.ball.position : null);
    }
    switch (this.cameraMode) {
      case "wide":
        return {
          position: fp(64, -142, 108),
          target: fp(0, 132, 6),
          lerp: 1.1,
        };
      case "ball": {
        // A broadcast-style tracking shot: the camera holds behind the plate,
        // drifts slightly toward the ball's side, and keeps it centered.
        const ball = this.ball.position;
        // Drift off the broadcast framing toward the ball rather than chasing
        // it outright - the diamond has to stay in shot to read the play.
        const follow = this.cameraFollow;
        const target = fp(0, 140, 6).lerp(ball, follow);
        return {
          position: fp(ball.x * follow * 0.22, -104, 74),
          target,
          lerp: 3.0,
        };
      }
      case "base":
        // The runner at first, from the seats down the line. Aimed at chest
        // height rather than at the bag itself, which used to put the bag in
        // the middle of frame and everybody standing near it out of the top.
        return {
          position: fp(100, 30, 14),
          target: fp(62, 64, 7.6),
          lerp: 2,
          fov: 32,
          fixed: true,
        };
      case "low": {
        // Low down the third-base line, looking out with the ball. Nothing
        // sells distance like a camera at eye level under a rising fly.
        // Aimed under the ball rather than at it, so the ball sits high in
        // frame with the park beneath it instead of against bare sky.
        const ball = this.ball.position;
        const target = new Vector3(ball.x * 0.82, ball.y * 0.5 + 8, ball.z * 0.82);
        return { position: fp(-62, -18, 13), target, lerp: 2.6 };
      }
      case "mound":
        // Long lens from high behind the plate, framed on the pitcher. Up at
        // the back of the bowl rather than down at field level: from low
        // behind the catcher, a figure drawn at 2.4x life size twenty feet
        // away *is* the shot, and the pitcher it was supposed to be about
        // disappears behind his helmet.
        return {
          position: fp(4, -56, 30),
          target: fp(0, 58, 7.4),
          lerp: 2.1,
          fov: 26,
          fixed: true,
        };
      case "slot":
        // Over the catcher's shoulder, tight on the hitter.
        return { position: fp(13, -21, 12), target: fp(-2, 8, 6.5), lerp: 2.3, fixed: true };
      case "line":
        // Field level by the first-base dugout, square on the hitter from his
        // open side. The mound falls outside the frame, which is the point -
        // this one is about the swing, not the pitch.
        return {
          position: fp(58, -8, 11),
          target: fp(-6, -2, 8),
          lerp: 2,
          fov: 34,
          fixed: true,
        };
      case "bowl":
        // High in the third-base stands, across the diamond and out toward
        // right field, with a few rows of crowd along the near edge of frame.
        return { position: fp(-166, -26, 74), target: fp(-6, 36, 6), lerp: 1.4 };
      case "follow": {
        const actor = this.cameraFollowKey ? this.actors.get(this.cameraFollowKey) : undefined;
        const at = actor ? actor.position : fp(0, 40, 0);
        return {
          position: new Vector3(at.x + 40, 30, at.z + 54),
          target: new Vector3(at.x, 9, at.z),
          lerp: 3.4,
        };
      }
      case "center":
      default: {
        // The centre-field camera, and the thing that makes it that shot rather
        // than a shot from behind the mound: it stands well off the
        // pitcher-to-plate line, out in left-centre. Sitting on the line puts
        // the hitter directly behind the pitcher, and the two stack into one
        // silhouette however high the camera goes. From out here the pitcher
        // falls to the left of frame with his back to the lens and the hitter,
        // catcher and umpire sit to the right of him, which is the composition
        // every broadcast opens on.
        //
        // How far round is set by the infield, not by taste. Coming round to
        // the left swings the sightline to the plate over the shortstop and
        // then across the third baseman, and their offset from that line does
        // not shrink with distance the way the lens does - so no amount of
        // backing off helps. Standing in *shallow* centre does, though: from
        // just behind second base the middle infielders are level with the
        // camera and the corner ones are out at the edges of a much wider
        // frame, so thirteen degrees is affordable here where eleven was the
        // limit from two hundred and thirty feet.
        //
        // Being closer also lets it come down. A camera far enough back to need
        // a long lens has to be high, or the pitcher covers the hitter; from in
        // here the two are separated across the frame instead, and the shot can
        // sit low enough to look along the ground rather than down at it.
        return {
          position: fp(-35, 155, 32),
          target: fp(-2, 31.5, 6),
          lerp: 1.8,
          fov: 20,
          // Already aimed at the hitter. Dragging it toward the middle of the
          // infield on a phone would point it at the grass in front of the
          // mound and stand everybody up along the top edge of the frame.
          fixed: true,
        };
      }
    }
  }
}

export const HOME_RUN_WALL = (theta: number) => wallDistance(theta);
export const MOUND_Y = MOUND_HEIGHT;
export type { BaseId };
