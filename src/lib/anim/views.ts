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
  { id: "umpire", label: "Umpire", hint: "Behind the pitcher" },
  { id: "pitcher", label: "Pitcher", hint: "Tight on the mound" },
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
   * Out over center field, well behind the pitcher, on a long lens - the angle
   * a pitch is judged from. Distance is what makes it work: from close in the
   * pitcher would fill the frame and hide the plate, but from out here he sits
   * small at the bottom of the shot with the hitter square to the lens.
   */
  umpire: {
    position: fp(0, 200, 38),
    target: fp(0, 4, 8),
    lerp: 2.4,
    fov: 18,
    fixed: true,
    pan: 0.25,
  },
  /**
   * High above the seats behind the plate, long lens on the mound: the
   * pitcher's face, his glove and the whole delivery, sighted over the catcher
   * and the top of the hitter's helmet.
   */
  pitcher: {
    position: fp(0, -110, 40),
    target: fp(0, RUBBER_DEPTH - 3, 8),
    lerp: 2.4,
    fov: 12,
    fixed: true,
    pan: 0.12,
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
