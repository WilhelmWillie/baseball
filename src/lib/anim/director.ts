import { Vector3 } from "three";
import {
  BASE_ORDER,
  BASE_POSITIONS,
  FIELDING_SPOTS,
  MOUND_HEIGHT,
  POSITION_KEYS,
  batterSpot,
  fp,
  onDeckSpot,
  standingSpot,
  wallDistance,
  type BaseId,
  type PositionKey,
} from "@/lib/field/geometry";
import type { SoundName } from "@/lib/audio/sfx";
import { Fx } from "./particles";
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
  | "celebrate"
  | "dejected"
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
  /** Resting spot the actor returns to. */
  home: Vector3;
  position: Vector3;
  facing: number;
  pose: Pose;
  /** 0..1 through the current pose, for limb animation. */
  poseT: number;
  visible: boolean;
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
 * The shot vocabulary. Broadcasts do not ease between angles - they cut - and
 * they change lenses to say something about the moment: tight on the pitcher
 * with two strikes, low down the line off the bat, wide when the ball is gone.
 */
export type CameraMode =
  | "broadcast"
  | "wide"
  | "ball"
  | "base"
  | "free"
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

const RELEASE_HEIGHT = 5.9;
const RELEASE_DEPTH = 54.5;
const PLATE_DEPTH = 1.35;
const CONTACT = fp(0, 2.6, 3.1);

/**
 * Seconds a runner takes to cover one base. A real sprint home-to-first is
 * about 4.3s; these are quicker than life but slow enough to follow.
 */
const RUN_PER_BASE = 1.9;
const TROT_PER_BASE = 2.7;

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

function flightDuration(ball: BattedBall): number {
  if (ball.isHomeRun) return 3.1;
  switch (ball.trajectory) {
    case "ground_ball":
    case "bunt":
      return 1.15;
    case "line_drive":
      return 1.25;
    case "popup":
      return 3.0;
    case "fly_ball":
      return 2.5;
    default:
      return 1.8;
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

interface RunnerTrack {
  actorKey: string;
  from: number;
  to: number;
  start: number;
  end: number;
  isOut: boolean;
  scored: boolean;
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
  private freeCamera = false;
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

  /** Paper over the infield when a run scores. */
  private throwConfetti(amount = 150) {
    this.fx.burstConfetti(fp(0, 8, 12), amount, this.celebrationColors());
  }

  /** Shells over the outfield. `count` scales the size of the show. */
  private launchFireworks(count: number) {
    this.fx.fireworkShow(fp(0, 230, 6), count, this.celebrationColors());
    this.onSound?.("launch");
  }

  /**
   * Change the shot. `cut` jumps rather than eases; a shot that has not yet
   * served out its hold refuses to be replaced, so nothing strobes between two
   * angles when several things happen at once.
   */
  private setShot(mode: CameraMode, opts: { cut?: boolean; force?: boolean; follow?: string } = {}) {
    if (this.freeCamera) return;
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

  setFreeCamera(free: boolean) {
    this.freeCamera = free;
  }

  isFreeCamera() {
    return this.freeCamera;
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
      role: config.role,
      positionKey: config.positionKey,
      home: config.home.clone(),
      position: config.home.clone(),
      facing: config.facing,
      pose: config.pose,
      poseT: 0,
      visible: true,
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
      if (actor.pose === "run" || actor.pose === "throw" || actor.pose === "swing") {
        actor.poseT += dt;
        if (actor.poseT > 0.6) {
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
    return fp(hand === "R" ? -1.7 : 1.7, RELEASE_DEPTH, RELEASE_HEIGHT);
  }

  /**
   * Windup, flight to the plate, and the reaction. Returns the time at which
   * the ball reaches the plate so callers can chain contact onto it.
   */
  private pitchFlight(pitch: PitchEvent): {
    windupEnd: number;
    plateTime: number;
    update: (t: number) => void;
  } {
    const cue = new Cue();
    const windupEnd = 0.62;
    const plateTime = windupEnd + 0.46;
    const release = this.releasePoint();
    const plate = fp(pitch.plate.x, PLATE_DEPTH, Math.max(0.4, pitch.plate.z));
    // A control point off the straight line gives the pitch some late shape.
    const control = release
      .clone()
      .lerp(plate, 0.55)
      .add(new Vector3(pitch.plate.x * 0.5, 1.1, 0));

    return {
      windupEnd,
      plateTime,
      update: (t: number) => {
        const pitcher = this.pitcher();
        if (pitcher) {
          if (t < windupEnd) {
            pitcher.pose = "windup";
            pitcher.poseT = clamp01(t / windupEnd);
          } else if (t < plateTime + 0.5) {
            pitcher.pose = "throw";
            pitcher.poseT = clamp01((t - windupEnd) / 0.5);
          }
        }

        if (t < windupEnd) {
          this.ball.visible = false;
          return;
        }
        cue.at("release", t, windupEnd, () => {
          this.onSound?.("pitch");
          // The stride foot lands in front of the rubber and kicks up the mound.
          this.fx.puff(fp(0, RELEASE_DEPTH - 5, 0.6), 9, { spread: 3.4, lift: 2.6, size: 0.85 });
        });
        if (t <= plateTime) {
          const u = clamp01((t - windupEnd) / (plateTime - windupEnd));
          const inv = 1 - u;
          this.ball.position
            .copy(release)
            .multiplyScalar(inv * inv)
            .addScaledVector(control, 2 * inv * u)
            .addScaledVector(plate, u * u);
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

  private swingAt(t: number, swingStart: number, contact: boolean) {
    const batter = this.batter();
    if (!batter) return;
    if (t >= swingStart && t < swingStart + 0.55) {
      batter.pose = "swing";
      batter.poseT = clamp01((t - swingStart) / 0.55);
    } else if (t >= swingStart + 0.55 && !contact) {
      batter.pose = "ready";
    }
  }

  private compilePitch(pitch: PitchEvent): Anim {
    const cue = new Cue();
    const flight = this.pitchFlight(pitch);
    const swings =
      pitch.outcome === "swinging_strike" || pitch.outcome === "foul";
    const foul = pitch.outcome === "foul" ? foulBallFor(pitch) : null;
    const catcherSpot = fp(0, -5.5, 2.6);
    const tail = foul ? 1.5 : 0.75;
    const duration = flight.plateTime + tail;

    return {
      label: `pitch:${pitch.id}`,
      duration,
      onStart: () => {
        this.pitchCount += 1;
        // Two strikes is worth a tight look at the hitter; every fourth pitch
        // otherwise gets the long lens on the pitcher, cut back at release.
        if (pitch.count.strikes >= 2) this.setShot("slot", { cut: true, force: true });
        else if (this.pitchCount % 4 === 0) this.setShot("mound", { cut: true, force: true });
        else this.setShot("broadcast", { force: true });
      },
      update: (t) => {
        flight.update(t);
        if (this.cameraMode === "mound") {
          cue.at("cutback", t, flight.windupEnd, () =>
            this.setShot("broadcast", { cut: true, force: true }),
          );
        }
        if (swings || pitch.outcome === "in_play") {
          this.swingAt(t, flight.plateTime - 0.16, false);
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
            const p = fp(pitch.plate.x, PLATE_DEPTH, pitch.plate.z)
              .lerp(target, easeOut(u));
            p.y = Math.max(0.4, pitch.plate.z + 46 * u * (1 - u) * 2.2 - u * u * 2);
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
      update: (t) => {
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
          this.swingAt(t, contactAt - 0.16, true);
        } else {
          inner.update(t - contactAt, 0);
        }
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
    const runnerEnd = tracks.reduce((max, r) => Math.max(max, r.end), 0);

    const landing = ball ? fp(ball.lateral, ball.depth, 0) : null;
    const ballDuration = ball ? flightDuration(ball) : 0;
    const apex = ball ? apexFor(ball) : 0;
    const fielderKey = ball && !ball.isHomeRun ? `def:${ball.fielder}` : null;
    const throwStart = ball ? ballDuration + 0.25 : 0;
    const throwEnd = throwStart + 0.55;

    // Where a throw goes: the base an out was recorded at, else first.
    const outTrack = tracks.find((r) => r.isOut);
    const throwTarget = outTrack
      ? basePathPoint(outTrack.to).setY(2.5)
      : BASE_POSITIONS.first.clone().setY(2.5);

    const holdAfter = result.kind === "home_run" ? 3.4 : 0.9;
    const duration = Math.max(runnerEnd, ball ? throwEnd : 0.4) + holdAfter;

    const startPoint = CONTACT.clone();
    const cue = new Cue();
    let landed = false;

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
        this.announce(result);
      },
      update: (t, dt) => {
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
            const height = ball.isHomeRun
              ? apex * Math.sin(Math.PI * Math.min(1, u * 0.92)) + 2
              : apex * 4 * u * (1 - u) + 1.2;
            this.ball.position.set(flat.x, Math.max(0.45, height), flat.z);
            this.ball.visible = true;
            this.ball.scale = 2.8;
            this.pushTrail();
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
            if (!landed) {
              landed = true;
              this.ball.position.copy(landing).setY(0.6);
              // Dirt off the first hop, thrown on down the line the ball was
              // already travelling. A grounder digs in; a fly ball drops in.
              const skip = landing.clone().setY(0).normalize().setY(0.7);
              const hard = ball.trajectory === "ground_ball" || ball.trajectory === "line_drive";
              this.fx.spray(landing.clone().setY(0.4), skip, hard ? 16 : 8, hard ? 1 : 0.5);
            }
            if (t >= throwStart) {
              const u = clamp01((t - throwStart) / (throwEnd - throwStart));
              const p = landing.clone().setY(3.2).lerp(throwTarget, easeInOut(u));
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
            const u = clamp01(t / Math.max(0.35, ballDuration));
            const target = landing.clone().setY(0);
            fielder.position.lerp(target, Math.min(1, u * 0.16 + dt * 2.2));
            fielder.facing = yawToward(fielder.position, target.distanceTo(fielder.position) > 1 ? target : fp(0, 0));
            if (t < ballDuration) {
              fielder.pose = "run";
              fielder.poseT = (fielder.poseT + dt * 1.6) % 1;
            } else if (t < throwStart) {
              cue.at("field", t, ballDuration, () =>
                this.fx.puff(fielder.position.clone(), 7, { spread: 3.2, lift: 2, size: 0.8 }),
              );
              fielder.pose = "catch";
              fielder.poseT = clamp01((t - ballDuration) / 0.25);
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
            actor.pose = "run";
            actor.poseT = (actor.poseT + dt * 1.9) % 1;
          } else {
            // Spikes into the bag. A runner who was thrown out slid hardest.
            cue.at(`slide:${track.actorKey}`, t, track.end, () =>
              this.fx.puff(actor.position.clone(), track.isOut ? 22 : 13, {
                spread: track.isOut ? 8 : 5.5,
                lift: 3,
                size: 1.15,
              }),
            );
            actor.pose = track.isOut ? "dejected" : track.scored ? "celebrate" : "ready";
            if (track.isOut) actor.visible = t < track.end + 0.6;
            if (track.scored) actor.visible = t < track.end + 0.9;
          }
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

    for (const move of moves) {
      const { from, to } = runnerProgress(move);
      if (to === from && !move.isScoring && move.to !== "out") continue;
      const actorKey = this.actorKeyForRunner(move, from);
      if (!actorKey) continue;

      const bases = Math.max(0.5, to - from);
      const perBase = result.kind === "home_run" ? TROT_PER_BASE : RUN_PER_BASE;
      const start = from === 0 ? 0.12 : 0.02;
      tracks.push({
        actorKey,
        from,
        to,
        start,
        end: start + bases * perBase,
        isOut: move.to === "out",
        scored: move.isScoring,
      });
    }
    return tracks;
  }

  private actorKeyForRunner(move: RunnerMove, fromProgress: number): string | null {
    // Already on the field somewhere?
    for (const [key, actor] of this.actors) {
      if (actor.playerId === move.playerId) return key;
    }
    // The batter becoming a runner.
    const batter = this.batter();
    if (fromProgress === 0 && batter) return "bat";

    // Fall back to a transient actor so unknown runners still animate.
    const side = this.snapshot?.battingSide ?? "away";
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
        };
      }
    }

    return {
      label: `action:${event.id}`,
      duration,
      onStart: () => {
        if (event.description) {
          this.setCallout(isSteal ? "STOLEN BASE" : "PLAY", "good", event.description);
        }
      },
      update: (t, dt) => {
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

  /** Desired camera placement for the current mode. */
  desiredCamera(): { position: Vector3; target: Vector3; lerp: number } {
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
