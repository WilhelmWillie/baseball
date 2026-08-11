import { Vector3 } from "three";
import {
  BASE_ORDER,
  BASE_POSITIONS,
  FIELDING_SPOTS,
  MOUND_HEIGHT,
  POSITION_KEYS,
  RUBBER_DEPTH,
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
import { foulBallFor, runnerProgress } from "@/lib/game/events";
import type {
  BattedBall,
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
  | "broadcast"
  | "wide"
  | "ball"
  | "base"
  /** Low and tight down the third-base line, looking out with the ball. */
  | "low"
  /** Long lens from behind the plate, framed on the pitcher. */
  | "mound"
  /** Over the catcher, tight on the hitter. */
  | "slot"
  /** Travels with whichever actor `cameraFollowKey` names. */
  | "follow";

/** How long a shot holds before anything less urgent may replace it. */
const SHOT_HOLD: Partial<Record<CameraMode, number>> = {
  low: 1.1,
  mound: 0.9,
  slot: 0.9,
  wide: 1.2,
  follow: 1,
};

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
const CONTACT = fp(0, 2.6, 6.4);

/**
 * Seconds a runner takes to cover one base. A real sprint home-to-first is
 * about 4.3s. These are still quicker than life, but the point of the whole
 * animation is that a viewer can follow what happened, and a double that is
 * over before you have found the ball has not communicated anything.
 */
const RUN_PER_BASE = 2.6;
const TROT_PER_BASE = 3.4;

/** How long a swing takes, and how far ahead of contact it begins. */
const SWING_TIME = 0.55;
const SWING_LEAD = 0.2;

/** A walk is not a race. */
const WALK_PER_BASE = 4.2;

function yawToward(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
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

function apexFor(ball: BattedBall): number {
  if (ball.isHomeRun) return 78 + Math.min(60, ball.distance / 8);
  switch (ball.trajectory) {
    case "ground_ball":
      return 2.5;
    case "bunt":
      return 3;
    case "line_drive":
      return 11;
    case "popup":
      return 95;
    case "fly_ball":
      return 42 + Math.min(50, ball.distance / 7);
    default:
      return Math.max(6, Math.min(70, ball.distance / 6));
  }
}

/**
 * How long the ball is in the air. Deliberately longer than the physics would
 * give: hang time is the part of a batted ball a viewer actually reads - where
 * it is going, who is chasing it, whether it will drop - and rushing it turns
 * every play into a blur.
 */
function flightDuration(ball: BattedBall): number {
  if (ball.isHomeRun) return 4.2;
  switch (ball.trajectory) {
    case "ground_ball":
    case "bunt":
      return 1.7;
    case "line_drive":
      return 1.9;
    case "popup":
      return 4.0;
    case "fly_ball":
      return 3.4;
    default:
      return 2.6;
  }
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

/** Where the ball sits when it is lying on the grass, and glove height. */
const BALL_RADIUS = 0.45;
const GLOVE_HEIGHT = 5.4;
/** How high the first hop carries. */
const HOP_HEIGHT = 7;

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
  cameraMode: CameraMode = "broadcast";
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

  /** Replace the world with authoritative state. Only called when idle. */
  applySnapshot(snapshot: GameSnapshot) {
    this.snapshot = snapshot;
    const seen = new Set<string>();
    const batSide = snapshot.batter?.batSide ?? "R";

    for (const key of POSITION_KEYS) {
      const player = snapshot.defense[key];
      if (!player) continue;
      const actorKey = `def:${key}`;
      seen.add(actorKey);
      const spot = FIELDING_SPOTS[key];
      const isCatcher = key === "catcher";
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
        anim.onStart?.();
        anim.update(0, 0);
      }
    }

    this.busy = !this.isIdle();
    this.queueLength = this.queue.length;
    // The knock on the lens dies away over about half a second.
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);

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
    // Everything settles back to the broadcast framing between plays, and it
    // cuts there rather than drifting across the park.
    if (this.idleTime > 0.9 && this.cameraMode !== "broadcast") {
      this.setShot("broadcast", { cut: true });
    }
    if (this.ball.visible && this.idleTime > 1.2) {
      this.ball.visible = false;
    }
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
    const catcherSpot = fp(0, -5.5, zoneHeight(1.4));
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
          hitter.visible = true;
        }
        // Two strikes is worth a tight look at the hitter; every fourth pitch
        // otherwise gets the long lens on the pitcher, cut back at release.
        if (pitch.count.strikes >= 2) this.setShot("slot", { cut: true, force: true });
        else if (this.pitchCount % 4 === 0) this.setShot("mound", { cut: true, force: true });
        else this.setShot("broadcast", { force: true });
      },
      update: (t) => {
        flight.update(t);
        if (this.cameraMode === "mound") {
          cue.at("cutback", t, flight.releaseAt, () =>
            this.setShot("broadcast", { cut: true, force: true }),
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
            this.ball.position.lerp(catcherSpot, Math.min(1, u * 1.4));
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
          this.fx.spray(CONTACT.clone().setY(0.5), new Vector3(0, 1, 0.2), 10, 0.55);
          // The camera reacts to contact the way a crowd does.
          const big = result.kind === "home_run" || result.kind === "triple";
          this.knockCamera(big ? 0.85 : result.ball ? 0.4 : 0.2);
          if (big) this.setShot("low", { cut: true, force: true });
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

    const landing = ball ? fp(ball.lateral, ball.depth, 0) : null;
    const ballDuration = ball ? flightDuration(ball) : 0;
    const apex = ball ? apexFor(ball) : 0;
    const fielderKey = ball && !ball.isHomeRun ? `def:${ball.fielder}` : null;

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

    // How long the ball spends bouncing and rolling before it is gathered.
    const groundTime = ball && !caughtInAir && !ball.isHomeRun ? 1.15 : 0;
    const gatherAt = ballDuration + groundTime;
    const throwStart = ball ? gatherAt + 0.4 : 0;
    const throwEnd = throwStart + 0.6;
    /** Where the ball ends up after the hop and the roll. */
    const restPoint =
      landing && groundTime > 0
        ? landing.clone().multiplyScalar(1.09)
        : landing;

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
    const duration = Math.max(runnerEnd, ball ? throwEnd : 0.4) + holdAfter;

    const startPoint = CONTACT.clone();
    const cue = new Cue();
    let landed = false;

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
          ...this.crowdVoice(weight.favorsBatter, weight.magnitude),
        }
      : null;

    return {
      label: `result:${result.id}`,
      duration,
      onStart: () => {
        if (ball) {
          this.cameraFollow = result.kind === "home_run" ? 0.6 : 0.32;
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
            this.throwConfetti(result.kind === "home_run" ? 200 : 140);
            this.launchFireworks(result.kind === "home_run" ? 7 : 3);
          });
        }

        // --- Ball ---
        if (ball && landing) {
          if (t <= ballDuration) {
            const u = clamp01(t / ballDuration);
            const flat = startPoint.clone().lerp(landing, u);
            // A ball that is caught finishes at the glove; one that is not
            // finishes on the ground, which is what makes the difference
            // legible from any camera.
            const endHeight = caughtInAir ? GLOVE_HEIGHT : BALL_RADIUS;
            const height = ball.isHomeRun
              ? apex * Math.sin(Math.PI * Math.min(1, u * 0.92)) + 2
              : apex * 4 * u * (1 - u) + startPoint.y * (1 - u) + endHeight * u;
            this.ball.position.set(flat.x, Math.max(BALL_RADIUS, height), flat.z);
            this.ball.visible = true;
            this.ball.scale = 2.8;
            this.pushTrail();
          } else if (!ball.isHomeRun && t <= gatherAt && groundTime > 0 && restPoint) {
            // On the deck: two decaying hops while it rolls out, so the ball is
            // visibly *down* rather than teleporting into somebody's glove.
            const u = clamp01((t - ballDuration) / groundTime);
            const flat = landing.clone().lerp(restPoint, easeOut(u));
            const hop =
              Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u) * (1 - u) * HOP_HEIGHT;
            this.ball.position.set(flat.x, BALL_RADIUS + hop, flat.z);
            this.ball.visible = true;
            this.pushTrail();
            cue.at("bounce", t, ballDuration, () => {
              this.onSound?.("mitt", 0.25);
              this.fx.spray(
                landing.clone().setY(0.4),
                landing.clone().setY(0).normalize().setY(0.8),
                14,
                0.8,
              );
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
            const held = restPoint ?? landing;
            if (!landed) {
              landed = true;
              this.ball.position.copy(held).setY(caughtInAir ? GLOVE_HEIGHT : BALL_RADIUS);
            }
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
            const u = clamp01(t / Math.max(0.35, gatherAt));
            // A ball at the wall would otherwise walk the fielder through it.
            const target = playableSpot((restPoint ?? landing).clone().setY(0));
            fielder.position.lerp(target, Math.min(1, u * 0.16 + dt * 2.2));
            fielder.facing = yawToward(fielder.position, target.distanceTo(fielder.position) > 1 ? target : fp(0, 0));
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
            } else {
              fielder.pose = "ready";
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

        // --- Camera ---
        // A home run is three shots: low off the bat, wide as it leaves, then
        // back to the plate for the trot. A strikeout is one, on the pitcher.
        if (result.kind === "home_run") {
          cue.at("hr:wide", t, ballDuration + 0.85, () =>
            this.setShot("wide", { cut: true, force: true }),
          );
          cue.at("hr:trot", t, ballDuration + 3.4, () => {
            const trot = tracks.find((track) => track.scored);
            this.setShot("follow", { cut: true, force: true, follow: trot?.actorKey });
          });
        } else if (!ball) {
          cue.at("react", t, 0.4, () => {
            if (result.kind === "strikeout") this.setShot("mound", { cut: true, force: true });
          });
        } else if (t > throwEnd) {
          this.setShot("broadcast");
        }
      },
      onEnd: () => {
        this.ball.visible = false;
        for (const track of tracks) {
          const actor = this.actors.get(track.actorKey);
          if (actor && (track.isOut || track.scored)) actor.visible = false;
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

  private compileInningChange(event: NormalizedEvent & { type: "inning_change" }): Anim {
    return {
      label: `inning:${event.id}`,
      duration: 1.8,
      onStart: () => {
        this.setCallout(event.description.toUpperCase(), "neutral", "Teams change sides");
        this.setShot("wide", { cut: true, force: true });
      },
      update: () => {},
      onEnd: () => {
        this.setShot("broadcast", { cut: true, force: true });
      },
    };
  }

  /**
   * Desired camera placement. `view` is the seat the viewer picked: anything
   * other than "broadcast" ignores the shot list and holds that vantage, so the
   * game plays out in front of a camera that never cuts.
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
        return { position: fp(78, 16, 34), target: BASE_POSITIONS.first.clone(), lerp: 2 };
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
        // Long lens from behind the plate, framed on the pitcher.
        return { position: fp(3, -34, 11), target: fp(0, 55, 5.5), lerp: 2.1 };
      case "slot":
        // Over the catcher's shoulder, tight on the hitter.
        return { position: fp(13, -21, 12), target: fp(1, 7, 5), lerp: 2.3 };
      case "follow": {
        const actor = this.cameraFollowKey ? this.actors.get(this.cameraFollowKey) : undefined;
        const at = actor ? actor.position : fp(0, 40, 0);
        return {
          position: new Vector3(at.x + 40, 30, at.z + 54),
          target: new Vector3(at.x, 9, at.z),
          lerp: 3.4,
        };
      }
      default:
        return {
          position: fp(0, -78, 55),
          target: fp(0, 100, 4),
          lerp: 1.6,
        };
    }
  }
}

export const HOME_RUN_WALL = (theta: number) => wallDistance(theta);
export const MOUND_Y = MOUND_HEIGHT;
export type { BaseId };
