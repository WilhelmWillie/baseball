import { Vector3 } from "three";
import { RUBBER_DEPTH, fp } from "@/lib/field/geometry";

/**
 * The camera modes a viewer can pick between.
 *
 * `broadcast` is the default and hands the framing back to the director's shot
 * list, which cuts between angles as the game gives it something to say. The
 * rest are *seats*: one vantage that holds all game long and never cuts. A seat
 * pans with the ball the way a head turns - the chair itself does not move.
 */
export type CameraView = "broadcast" | "umpire" | "pitcher" | "bleachers";

export const DEFAULT_CAMERA_VIEW: CameraView = "broadcast";

export interface CameraViewOption {
  id: CameraView;
  label: string;
  /** One line under the label in the picker. */
  hint: string;
}

export const CAMERA_VIEWS: CameraViewOption[] = [
  { id: "broadcast", label: "Broadcast", hint: "Cuts with the play" },
  { id: "umpire", label: "Umpire", hint: "Behind the plate" },
  { id: "pitcher", label: "Pitcher", hint: "From the mound" },
  { id: "bleachers", label: "Bleachers", hint: "Center field seats" },
];

/** A camera placement. Positions and targets are in three.js world space. */
export interface Shot {
  position: Vector3;
  target: Vector3;
  /** How fast the rig eases toward the shot, per second. */
  lerp: number;
  /**
   * Vertical field of view at 16:9, before the portrait correction. Omitted on
   * the director's own shots, which are all composed on the broadcast lens.
   */
  fov?: number;
  /**
   * A seat the viewer chose. The rig leaves the framing exactly as composed
   * here rather than pulling it toward the infield on a narrow screen.
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
   * The pitcher's own eyes - clearing his cap for the same reason the umpire
   * clears the catcher's helmet, so the shot is the hitter sixty feet away and
   * the infield spread out ahead rather than the back of his own head. His cap
   * sits along the bottom of the frame, and the ball leaves past it.
   */
  pitcher: {
    position: fp(0, RUBBER_DEPTH + 5.5, 21),
    target: fp(0, 1, 6.5),
    lerp: 2.4,
    fov: 48,
    fixed: true,
    pan: 0.3,
  },
  /**
   * A dozen rows up in the center field bleachers, over the batter's eye and
   * under the scoreboard. Everything is small and far away, which is the point:
   * this is the seat, not a camera position.
   */
  bleachers: {
    position: fp(0, 448, 30),
    target: fp(0, 60, 10),
    lerp: 2.2,
    fov: 18,
    fixed: true,
    pan: 0.16,
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
    fixed: true,
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
