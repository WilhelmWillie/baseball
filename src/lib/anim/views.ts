import { Vector3 } from "three";
import { RUBBER_DEPTH, fp } from "@/lib/field/geometry";

/**
 * The camera modes a viewer can pick between.
 *
 * `broadcast` is the default and hands the framing back to the director's shot
 * list, which opens on the centre-field camera and cuts between angles as the
 * game gives it something to say. The rest are *seats*: one vantage that holds
 * all game long and never cuts. A seat pans with the ball the way a head turns
 * - the chair itself does not move.
 */
export type CameraView = "broadcast" | "home_plate" | "umpire" | "sky";

export const DEFAULT_CAMERA_VIEW: CameraView = "broadcast";

export interface CameraViewOption {
  id: CameraView;
  label: string;
  /** One line under the label in the picker. */
  hint: string;
}

export const CAMERA_VIEWS: CameraViewOption[] = [
  { id: "broadcast", label: "Broadcast", hint: "Cuts with the play" },
  { id: "home_plate", label: "Home Plate", hint: "Over the whole diamond" },
  { id: "umpire", label: "Umpire", hint: "Behind the plate" },
  { id: "sky", label: "Sky", hint: "Straight down from above" },
];

/** A camera placement. Positions and targets are in three.js world space. */
export interface Shot {
  position: Vector3;
  target: Vector3;
  /** How fast the rig eases toward the shot, per second. */
  lerp: number;
  /**
   * Vertical field of view at 16:9, before the portrait correction. Omitted on
   * shots composed on the broadcast lens.
   */
  fov?: number;
  /**
   * This shot's aim is already the composition. The rig leaves it exactly as
   * given rather than pulling it toward the infield on a narrow screen - which
   * is the right correction for a shot framed on the whole diamond and the
   * wrong one for a seat, or for anything already pointed at a subject.
   */
  fixed?: boolean;
}

/**
 * How far each seat's gaze swings toward the ball, 0..1, and the lens it
 * watches through. The seats are placed in feet, on the same
 * lateral/depth/height axes as the rest of the field math.
 */
const SEATS: Record<Exclude<CameraView, "broadcast">, Shot & { pan: number }> = {
  /**
   * High behind home plate with the whole diamond laid out ahead - the shot the
   * broadcast used to open on before it moved out to centre field. Everything
   * that matters is in frame at once, which is exactly what a directed feed
   * cannot give you: nothing here is ever cut away from.
   *
   * Composed on the broadcast lens and deliberately *not* `fixed`, so a
   * portrait phone still gets the framing pulled in toward the infield the way
   * the directed shots do.
   */
  home_plate: {
    position: fp(0, -78, 55),
    target: fp(0, 100, 4),
    lerp: 1.6,
    pan: 0.22,
  },
  /**
   * The umpire's own eyes: in the slot off the catcher's inside shoulder,
   * looking straight out at the pitcher, with the pitch arriving at the lens.
   *
   * Higher than a person would stand, deliberately. The figures are drawn at
   * 2.4x life size and a crouched catcher's head clears twelve feet, so an
   * umpire at his real eye height would see nothing but the back of it. From
   * here the helmet rides the bottom of the frame instead, which is what the
   * job actually looks like.
   */
  umpire: {
    position: fp(1.2, -20, 17),
    target: fp(0, RUBBER_DEPTH - 3, 8),
    lerp: 2.4,
    fov: 46,
    fixed: true,
    pan: 0.3,
  },
  /**
   * Straight down on the park from a few hundred feet up, near enough overhead
   * that the diamond reads as a diamond rather than a foreshortened wedge. Not
   * *exactly* overhead: a camera looking down the world's up axis has no way to
   * decide which way is up in frame, so it sits back over the plate and tips in
   * by about ten degrees, which also keeps the batter inside the bottom of the
   * shot rather than under the lens.
   */
  sky: {
    position: fp(0, 46, 360),
    target: fp(0, 104, 0),
    lerp: 1.8,
    fov: 44,
    fixed: true,
    pan: 0.34,
  },
};

/**
 * The shot for a chosen seat. `ball` is where the ball is right now, or null
 * when it is not in play.
 *
 * The pan is measured against what the seat is already looking at, not against
 * the camera: a pitch lands within a few feet of the framing and moves it not
 * at all, while a ball into the gap drags the gaze out after it. Panning on
 * every pitch would leave the framing swimming for no reason.
 */
export function seatCamera(view: Exclude<CameraView, "broadcast">, ball: Vector3 | null): Shot {
  const seat = SEATS[view];
  const shot: Shot = {
    position: seat.position.clone(),
    target: seat.target.clone(),
    lerp: seat.lerp,
    fov: seat.fov,
    fixed: seat.fixed,
  };
  if (ball) {
    const strayed = seat.target.distanceTo(ball);
    shot.target.lerp(ball, seat.pan * clamp01((strayed - 60) / 220));
  }
  return shot;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const STORAGE_KEY = "pocket-ballpark:camera";

/** The seat the viewer last chose, if the browser remembers one. */
export function storedCameraView(): CameraView | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return CAMERA_VIEWS.some((v) => v.id === saved) ? (saved as CameraView) : null;
  } catch {
    return null;
  }
}

export function rememberCameraView(view: CameraView) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Private browsing, or a full quota. The choice just will not stick.
  }
}
