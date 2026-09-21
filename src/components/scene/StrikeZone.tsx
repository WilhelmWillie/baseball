"use client";

import { useEffect, useMemo } from "react";
import { useFrame, type RootState } from "@react-three/fiber";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { platePoint, type Director } from "@/lib/anim/director";
import type { TrackedPitch } from "@/lib/game/types";
import { useGameStore } from "@/store/gameStore";

/**
 * Half the zone's width, in feet. The plate is seventeen inches across and a
 * pitch is a strike if any part of the ball clips it, so the zone a call is
 * really made against runs a ball's radius wider on each side - the 0.83 every
 * public pitch plot is drawn to.
 */
const ZONE_HALF_WIDTH = 0.83;

/** Knees to letters on an average hitter, until the feed has measured this one. */
const DEFAULT_ZONE = { top: 3.4, bottom: 1.6 };

/**
 * How thick the frame's bars are, in world units at `RAIL_REF` feet, and how
 * much thicker they are allowed to get with distance.
 *
 * A line of fixed thickness is the wrong thing twice over: over the catcher's
 * shoulder it is a plank, and from the centre-field camera a hundred and fifty
 * feet out - where most of the pitches in this game are watched from - it is
 * under two pixels and reads as a smudge. Growing it part of the way toward the
 * distance holds the apparent width somewhere sensible at both ends. Same idea
 * as the floor `<Ball>` keeps under its own size on a long shot, and the same
 * lie every broadcast tells with a line drawn at a constant screen width.
 */
const RAIL = 0.16;
const RAIL_REF = 60;
const RAIL_MAX = 2.2;

/**
 * Marker radii. The ball itself is drawn at 0.42, so the pitch that just
 * crossed is a little larger than life and the ones before it are a good deal
 * smaller - which is the whole reading: this one, and the ones already taken.
 */
const LAST_MARK = 0.55;
const PAST_MARK = 0.32;

/** As many as one plate appearance can need. A 20-pitch at-bat is a legend. */
const MAX_MARKS = 22;

/** How long a mark takes to land, in seconds. */
const POP = 0.22;

/**
 * How square-on the camera has to be for the box to show, as the cosine between
 * the camera's own line to it and the plane it is drawn in.
 *
 * A flat rectangle seen from the side is a line, and a graphic that thins to a
 * bright streak across the infield is worse than no graphic. It is also why a
 * real broadcast only ever draws its box on the shot from centre field: from
 * down a line there is nothing to draw. Fading on the angle gets both out of
 * one rule, with no list of which shots may show it.
 */
const FACE_FROM = 0.46;
const FACE_FULL = 0.78;

/** Opacities at full strength. */
const FRAME_ALPHA = 0.85;
const FILL_ALPHA = 0.07;
const PAST_ALPHA = 0.42;

const NO_PITCHES: TrackedPitch[] = [];
const TO_CAMERA = new Vector3();
const SPOT = new Vector3();

interface Zone {
  root: Group;
  bars: Mesh[];
  fill: Mesh;
  marks: Mesh[];
  frameMat: MeshBasicMaterial;
  fillMat: MeshBasicMaterial;
  pastMat: MeshBasicMaterial;
  lastMat: MeshBasicMaterial;
  /** How faded in it is, 0..1. */
  fade: number;
  /** The zone the frame is currently built to, so it is only re-laid when it moves. */
  top: number;
  bottom: number;
  /** And how big that came out, for the bars the camera re-thickens. */
  width: number;
  height: number;
  rail: number;
  /** The pitch list the marks are currently placed for. */
  placed: TrackedPitch[] | null;
  /** When each mark landed, so it pops in once and then holds. */
  born: Map<string, number>;
}

function white(alpha: number, doubleSided = false): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: "#fffcf5",
    transparent: true,
    opacity: alpha,
    // Nothing here is lit, and none of it may carve a hole in the depth buffer:
    // it is a broadcast graphic that happens to be made of geometry.
    depthWrite: false,
    toneMapped: false,
  });
  if (doubleSided) material.side = DoubleSide;
  return material;
}

/**
 * Everything is built from unit geometry and sized by the frame loop, because
 * the zone itself moves: MLB measures one per pitch off the hitter's stance, so
 * the box a tall man sees is not the box the next one does.
 */
function buildZone(): Zone {
  const root = new Group();
  root.visible = false;

  const frameMat = white(FRAME_ALPHA);
  const fillMat = white(FILL_ALPHA, true);
  const bar = new BoxGeometry(1, 1, 1);
  const bars: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new Mesh(bar, frameMat);
    mesh.renderOrder = 2;
    bars.push(mesh);
    root.add(mesh);
  }

  // Barely there, and it does the one thing the bars cannot: it stops the
  // frame reading as four sticks floating near the hitter.
  const fill = new Mesh(new PlaneGeometry(1, 1), fillMat);
  fill.renderOrder = 1;
  root.add(fill);

  const pastMat = white(PAST_ALPHA);
  const lastMat = white(1);
  const ball = new SphereGeometry(1, 18, 12);
  const marks: Mesh[] = [];
  for (let i = 0; i < MAX_MARKS; i++) {
    const mesh = new Mesh(ball, pastMat);
    mesh.renderOrder = 3;
    mesh.visible = false;
    marks.push(mesh);
    root.add(mesh);
  }

  return {
    root,
    bars,
    fill,
    marks,
    frameMat,
    fillMat,
    pastMat,
    lastMat,
    fade: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    rail: 0,
    placed: null,
    born: new Map(),
  };
}

function disposeZone(zone: Zone) {
  zone.bars[0].geometry.dispose();
  zone.fill.geometry.dispose();
  zone.marks[0].geometry.dispose();
  zone.frameMat.dispose();
  zone.fillMat.dispose();
  zone.pastMat.dispose();
  zone.lastMat.dispose();
}

/** Lay the frame out for a zone of this height. */
function layOut(zone: Zone, top: number, bottom: number) {
  zone.top = top;
  zone.bottom = bottom;
  const low = platePoint(-ZONE_HALF_WIDTH, bottom);
  const high = platePoint(ZONE_HALF_WIDTH, top);
  const width = high.x - low.x;
  const height = high.y - low.y;
  zone.width = width;
  zone.height = height;
  zone.root.position.set(0, (low.y + high.y) / 2, low.z);

  const [above, below, left, right] = zone.bars;
  above.position.set(0, height / 2, 0);
  below.position.set(0, -height / 2, 0);
  left.position.set(-width / 2, 0, 0);
  right.position.set(width / 2, 0, 0);

  zone.fill.scale.set(width, height, 1);
}

/** Draw the frame at this bar thickness. See `RAIL`. */
function setRail(zone: Zone, rail: number) {
  zone.rail = rail;
  const [above, below, left, right] = zone.bars;
  above.scale.set(zone.width + rail, rail, rail);
  below.scale.copy(above.scale);
  left.scale.set(rail, zone.height, rail);
  right.scale.copy(left.scale);
}

/** Put a mark at every pitch this hitter has seen, and park the rest. */
function placeMarks(zone: Zone, pitches: TrackedPitch[], now: number) {
  zone.placed = pitches;
  const live = new Set<string>();
  for (let i = 0; i < zone.marks.length; i++) {
    const mark = zone.marks[i];
    const pitch = i < pitches.length ? pitches[i] : null;
    if (!pitch) {
      mark.visible = false;
      continue;
    }
    live.add(pitch.id);
    if (!zone.born.has(pitch.id)) zone.born.set(pitch.id, now);
    SPOT.copy(platePoint(pitch.x, pitch.z)).sub(zone.root.position);
    mark.position.set(SPOT.x, SPOT.y, 0);
    mark.material = i === pitches.length - 1 ? zone.lastMat : zone.pastMat;
    mark.visible = true;
  }
  // The marks go when the hitter they were thrown to does.
  for (const id of zone.born.keys()) if (!live.has(id)) zone.born.delete(id);
}

/** A little past its size and back, so a mark lands rather than appears. */
function pop(t: number): number {
  if (t >= 1) return 1;
  return 1 - (1 - t) * (1 - t) * (1 - t * 1.6);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(v: number, from: number, to: number): number {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
}

function paint(zone: Zone, director: Director, pitches: TrackedPitch[], state: RootState, dt: number) {
  const last = pitches.length > 0 ? pitches[pitches.length - 1] : null;
  const top = last?.zone.top ?? DEFAULT_ZONE.top;
  const bottom = last?.zone.bottom ?? DEFAULT_ZONE.bottom;
  if (top !== zone.top || bottom !== zone.bottom) {
    layOut(zone, top, bottom);
    zone.rail = 0;
  }

  const now = state.clock.elapsedTime;
  if (pitches !== zone.placed) placeMarks(zone, pitches, now);

  // Square-on to the plane, and only while somebody is standing in.
  TO_CAMERA.copy(state.camera.position).sub(zone.root.position);
  const distance = TO_CAMERA.length();
  TO_CAMERA.divideScalar(distance || 1);
  const square = smoothstep(Math.abs(TO_CAMERA.z), FACE_FROM, FACE_FULL);
  const wanted = director.atPlate && !director.intermission ? square : 0;
  zone.fade += (wanted - zone.fade) * Math.min(1, dt * 7);
  zone.root.visible = zone.fade > 0.01;
  if (!zone.root.visible) return;

  const rail = RAIL * Math.min(RAIL_MAX, Math.max(1, distance / RAIL_REF));
  if (Math.abs(rail - zone.rail) > 0.002) setRail(zone, rail);

  zone.frameMat.opacity = FRAME_ALPHA * zone.fade;
  zone.fillMat.opacity = FILL_ALPHA * zone.fade;
  zone.pastMat.opacity = PAST_ALPHA * zone.fade;
  zone.lastMat.opacity = zone.fade;

  for (let i = 0; i < pitches.length && i < zone.marks.length; i++) {
    const size = i === pitches.length - 1 ? LAST_MARK : PAST_MARK;
    const at = zone.born.get(pitches[i].id) ?? now;
    zone.marks[i].scale.setScalar(size * pop(clamp01((now - at) / POP)));
  }
}

/**
 * The strike zone, hung in front of the catcher the way a broadcast hangs it:
 * a frame over the plate, and a white ball at every pitch this hitter has seen,
 * the last one full size and the ones before it small.
 *
 * It is a thing in the park rather than a graphic pasted over one, which is
 * what makes it honest. The box is built from the same `platePoint` the pitch
 * animation flies the ball through, so a mark sits exactly where the ball was a
 * moment ago rather than near it. And being in the world it needs no opinion
 * about which way round to draw: a pitch inside to a right-hander is inside
 * from every seat in the house, which a flat plot has to be told.
 *
 * Marks arrive from `Director.onPitch` by way of the snapshot, so one lands as
 * the ball reaches the plate rather than when the feed gets round to reporting
 * it. `Director.atPlate` is what puts the box up and takes it away.
 */
export function StrikeZone({ director }: { director: Director }) {
  const pitches = useGameStore((s) => s.snapshot?.pitches) ?? NO_PITCHES;
  const zone = useMemo(() => buildZone(), []);

  useEffect(() => () => disposeZone(zone), [zone]);

  useFrame((state, delta) => paint(zone, director, pitches, state, delta));

  return <primitive object={zone.root} />;
}
