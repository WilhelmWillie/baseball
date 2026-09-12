"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { SCOREBOARD_FACE } from "@/lib/field/park";
import { useGameStore } from "@/store/gameStore";
import { boardState, paintBoard, type BoardState } from "./scoreboardFace";

/**
 * The board out over the batter's eye, now carrying the game's actual line
 * score: nine innings and the R/H/E totals, with a face on each club so the
 * aliens and the robots are as easy to tell apart out there as they are on the
 * panel. See `scoreboardFace.ts` for what is painted; this file hangs it.
 *
 * It is one textured plane standing just off the recess the park builds for it.
 * The texture is repainted only when the line score itself changes - not per
 * pitch, and never per frame.
 */

/**
 * Texture size. Wide enough that a digit is still a digit from a seat behind
 * home, which is four hundred feet from the board.
 */
const TEXTURE_WIDTH = 1280;
const TEXTURE_HEIGHT = Math.round(
  (TEXTURE_WIDTH * SCOREBOARD_FACE.height) / SCOREBOARD_FACE.width,
);

/**
 * Draws the current board into the texture's canvas and marks it dirty. Takes
 * both as arguments, the way `Park`'s `fill` does, so the repaint stays a plain
 * function rather than a render-time mutation.
 */
function repaint(canvas: HTMLCanvasElement, texture: CanvasTexture, board: BoardState | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  paintBoard(ctx, TEXTURE_WIDTH, TEXTURE_HEIGHT, board);
  texture.needsUpdate = true;
}

export function Scoreboard() {
  const snapshot = useGameStore((s) => s.snapshot);
  const board = useMemo(() => boardState(snapshot), [snapshot]);
  const painted = useRef<string | null>(null);

  const { mesh, canvas, texture } = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = TEXTURE_WIDTH;
    element.height = TEXTURE_HEIGHT;

    const map = new CanvasTexture(element);
    map.colorSpace = SRGBColorSpace;
    map.magFilter = LinearFilter;
    map.minFilter = LinearMipmapLinearFilter;
    map.anisotropy = 4;

    const plane = new Mesh(
      new PlaneGeometry(SCOREBOARD_FACE.width, SCOREBOARD_FACE.height),
      // Unlit, like the lamp faces: a scoreboard is a thing that is lit from
      // inside, and one that dimmed with the evening would be unreadable in
      // exactly the games it matters most for.
      new MeshBasicMaterial({ map }),
    );
    plane.position.set(0, SCOREBOARD_FACE.y, SCOREBOARD_FACE.z);
    plane.frustumCulled = false;

    return { mesh: plane, canvas: element, texture: map };
  }, []);

  useEffect(() => {
    // The board is out of reach of any camera, so there is nothing to gain
    // from repainting it while the numbers on it are unchanged.
    const key = board?.key ?? "empty";
    if (painted.current === key) return;
    painted.current = key;
    repaint(canvas, texture, board);
  }, [board, canvas, texture]);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      texture.dispose();
    };
  }, [mesh, texture]);

  return <primitive object={mesh} />;
}
