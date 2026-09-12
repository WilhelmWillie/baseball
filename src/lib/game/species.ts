import type { TeamSide } from "./types";

/**
 * Who is who on the field. Two species share one skeleton (see
 * `components/scene/Player.tsx`): the home club are aliens, the visitors are
 * robots. That is a second, redundant read on a club beyond its colors - and
 * the only one that survives two clubs wearing the same navy.
 *
 * It lives here, away from the 3D layer, so the HUD can put the same badge on
 * the scoreboard without pulling three.js into the panel's bundle.
 */
export type Species = "alien" | "robot";

export function speciesFor(side: TeamSide): Species {
  return side === "home" ? "alien" : "robot";
}
