"use client";

import { useEffect, useMemo } from "react";
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  type MeshLambertMaterial,
  type Texture,
} from "three";
import {
  BASE_POSITIONS,
  BASE_RISE,
  BASE_SIZE,
  BATTER_BOX,
  HOME_PLATE_RISE,
  HOME_PLATE_SIZE,
  MOUND_DEPTH,
  MOUND_HEIGHT,
  MOUND_RADIUS,
  RUBBER_DEPTH,
  wallDistance,
} from "@/lib/field/geometry";
import { COLORS } from "@/lib/field/park";
import { paintedGround, type GroundPaint } from "@/lib/field/paint";

/**
 * How each surface is painted. See `lib/field/paint.ts`: a flat green field
 * comes out clean and sterile, so the turf goes on in blotches, the skin of the
 * infield in coarser ones, and the whole park sits under a drifting cloud.
 */
const TURF: GroundPaint = { patchScale: 0.045, patchDepth: 0.1 };
const FOUL: GroundPaint = { patchScale: 0.055, patchDepth: 0.12 };
const SKIN: GroundPaint = { patchScale: 0.08, patchDepth: 0.13, warmth: 0.05 };
const TRACK: GroundPaint = { patchScale: 0.095, patchDepth: 0.14, warmth: 0.04 };

/**
 * Ref callbacks, built once at module scope so React never re-runs them and
 * the painter never has to be handed a material twice. Declarative materials
 * are the only reason they exist: the shader hook has to go on before three.js
 * first compiles the material, and a ref is the earliest we see it.
 */
const paintRef = (paint: GroundPaint) => (material: MeshLambertMaterial | null) => {
  if (material) paintedGround(material, paint);
};
const turfRef = paintRef(TURF);
const foulRef = paintRef(FOUL);
const skinRef = paintRef(SKIN);
const trackRef = paintRef(TRACK);

/** The chalk rectangle, derived so it can never drift off the hitter's feet. */
const BOX_W = BATTER_BOX.outer - BATTER_BOX.inner;
const BOX_MID = (BATTER_BOX.outer + BATTER_BOX.inner) / 2;
const BOX_LEN = BATTER_BOX.length;
const CHALK_W = 0.34;
import {
  fieldShape,
  foulShapes,
  homeCircleShape,
  infieldShape,
  warningTrackShape,
} from "@/lib/field/surfaces";

/**
 * Layer heights. Every surface is flat, so they are stacked in a few
 * hundredths of a foot to keep them from fighting for the same depth.
 */
const LAYER = {
  grass: 0,
  foul: 0.02,
  track: 0.04,
  infield: 0.06,
  home: 0.08,
  chalk: 0.11,
};

/** Mown bands, as a repeating stripe rather than per-tile color variation. */
function mowTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 4, 32);
  ctx.fillStyle = "#e2e2e2";
  ctx.fillRect(0, 32, 4, 32);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  // ShapeGeometry uses shape coordinates as UVs, so this is one band per 34ft.
  texture.repeat.set(1 / 68, 1 / 68);
  return texture;
}

function useShapeGeometry(build: () => Shape | Shape[]): ShapeGeometry {
  return useMemo(() => {
    const shapes = build();
    return new ShapeGeometry(Array.isArray(shapes) ? shapes : [shapes], 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The playing surface: grass, foul ground, warning track, dirt, mound, bases. */
export function Field() {
  const grass = useShapeGeometry(fieldShape);
  const foul = useShapeGeometry(foulShapes);
  const track = useShapeGeometry(warningTrackShape);
  const infield = useShapeGeometry(infieldShape);
  const homeCircle = useShapeGeometry(() => homeCircleShape(13));

  const mow = useMemo(() => mowTexture(), []);

  useEffect(() => {
    return () => {
      grass.dispose();
      foul.dispose();
      track.dispose();
      infield.dispose();
      homeCircle.dispose();
      mow.dispose();
    };
  }, [grass, foul, track, infield, homeCircle, mow]);

  const foulLineLength = wallDistance(Math.PI / 4);

  return (
    <group>
      {/* Fair grass, with the mow pattern. */}
      <mesh geometry={grass} rotation={[-Math.PI / 2, 0, 0]} position={[0, LAYER.grass, 0]} receiveShadow>
        <meshLambertMaterial ref={turfRef} color={COLORS.grass} map={mow} />
      </mesh>

      {/* Foul ground reads a shade darker. */}
      <mesh geometry={foul} rotation={[-Math.PI / 2, 0, 0]} position={[0, LAYER.foul, 0]} receiveShadow>
        <meshLambertMaterial ref={foulRef} color={COLORS.foulGrass} />
      </mesh>

      <mesh geometry={track} rotation={[-Math.PI / 2, 0, 0]} position={[0, LAYER.track, 0]} receiveShadow>
        <meshLambertMaterial ref={trackRef} color={COLORS.track} />
      </mesh>

      <mesh geometry={infield} rotation={[-Math.PI / 2, 0, 0]} position={[0, LAYER.infield, 0]} receiveShadow>
        <meshLambertMaterial ref={skinRef} color={COLORS.dirt} />
      </mesh>

      <mesh
        geometry={homeCircle}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, LAYER.home, 0]}
        receiveShadow
      >
        <meshLambertMaterial ref={skinRef} color={COLORS.dirt} />
      </mesh>

      {/* Pitcher's mound: a shallow cone, flattened on top. */}
      <mesh position={[0, MOUND_HEIGHT / 2, -MOUND_DEPTH]} receiveShadow castShadow>
        <cylinderGeometry args={[MOUND_RADIUS * 0.72, MOUND_RADIUS, MOUND_HEIGHT, 24]} />
        <meshLambertMaterial ref={skinRef} color={COLORS.moundDirt} />
      </mesh>
      <mesh position={[0, MOUND_HEIGHT + 0.06, -RUBBER_DEPTH]}>
        <boxGeometry args={[2, 0.14, 0.5]} />
        <meshLambertMaterial color={COLORS.base} />
      </mesh>

      {/* Foul lines. */}
      {[-1, 1].map((side) => {
        const angle = (side * Math.PI) / 4;
        return (
          <mesh
            key={side}
            position={[
              (Math.sin(angle) * foulLineLength) / 2,
              LAYER.chalk,
              (-Math.cos(angle) * foulLineLength) / 2,
            ]}
            rotation={[0, -angle, 0]}
          >
            <boxGeometry args={[0.35, 0.04, foulLineLength]} />
            <meshBasicMaterial color={COLORS.chalk} />
          </mesh>
        );
      })}

      {/* Batter's boxes, drawn off the same constant the hitter stands on. */}
      {[-1, 1].map((side) =>
        (
          [
            [0, BOX_LEN / 2, BOX_W, CHALK_W],
            [0, -BOX_LEN / 2, BOX_W, CHALK_W],
            [-BOX_W / 2, 0, CHALK_W, BOX_LEN],
            [BOX_W / 2, 0, CHALK_W, BOX_LEN],
          ] as const
        ).map(([dx, dz, sx, sz], i) => (
          <mesh
            key={`${side}-${i}`}
            position={[side * BOX_MID + dx, LAYER.chalk, -(BATTER_BOX.depth + dz)]}
          >
            <boxGeometry args={[sx, 0.04, sz]} />
            <meshBasicMaterial color={COLORS.chalk} />
          </mesh>
        )),
      )}

      {/* Bags and home plate, off the same constants the base paths use. */}
      {(["first", "second", "third"] as const).map((base) => {
        const p = BASE_POSITIONS[base];
        return (
          <mesh
            key={base}
            position={[p.x, BASE_RISE / 2, p.z]}
            rotation={[0, Math.PI / 4, 0]}
            castShadow
          >
            <boxGeometry args={[BASE_SIZE, BASE_RISE, BASE_SIZE]} />
            <meshLambertMaterial color={COLORS.base} />
          </mesh>
        );
      })}
      <mesh position={[0, HOME_PLATE_RISE / 2, 0]} castShadow>
        <boxGeometry args={[HOME_PLATE_SIZE, HOME_PLATE_RISE, HOME_PLATE_SIZE]} />
        <meshLambertMaterial color={COLORS.base} />
      </mesh>
    </group>
  );
}
