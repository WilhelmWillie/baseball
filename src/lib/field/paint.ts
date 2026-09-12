import type { ColorRepresentation, Material, Vector3 } from "three";
import { Color, Vector2 } from "three";

/**
 * The park's paint.
 *
 * Everything out there is a flat fill: one green for the grass, one tan for the
 * dirt, one cream for the stonework. Lit, that comes out clean and even and a
 * little sterile - a model of a ballpark rather than an afternoon at one. What
 * a painted version of the same park has that the model does not is *unevenness*:
 * blotchy turf, sun-bleached tops and shaded bottoms, and the shadow of a cloud
 * crossing the outfield.
 *
 * None of that is worth a second draw call, so it is all injected into the
 * materials the park already uses, via `onBeforeCompile`. The lighting, the
 * shadows and the fog are three.js' own; these hooks only touch the color the
 * surface starts from.
 */

/**
 * The clock and the wind, shared by every patched material so the whole park
 * drifts together. Driven once a frame from the scene's engine loop.
 */
export const PAINT = {
  time: { value: 0 },
  /** Unit wind direction on the ground plane, which the cloud dapple rides. */
  drift: { value: new Vector2(1, 0) },
  /**
   * The colour distance paints things. Set from the sky's own hemisphere light,
   * so the far outfield hazes toward a blue afternoon, an orange evening or a
   * cold night without any of that being written down twice.
   */
  tint: { value: new Color("#cfe6ff") },
};

const scratch = new Vector2();

/** Advances the paint clock. Called once per frame, from `Scene`'s engine. */
export function advancePaint(delta: number, wind?: Vector3) {
  PAINT.time.value += delta;
  if (!wind) return;
  scratch.set(wind.x, wind.z);
  // A dead calm still has weather crossing the park, just not on any heading.
  if (scratch.lengthSq() < 1e-4) scratch.set(1, 0.35);
  PAINT.drift.value.copy(scratch.normalize());
}

/** Points the paint's distance haze at whatever the sky is doing. */
export function paintTint(color: ColorRepresentation) {
  PAINT.tint.value.set(color);
}

/**
 * Value noise, hashed with the same sin-fract trick `park.ts` lays the park out
 * with, so the shapes and the paint come out of one family of noise.
 */
const NOISE = /* glsl */ `
float pbHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float pbNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(pbHash(i), pbHash(i + vec2(1.0, 0.0)), u.x),
    mix(pbHash(i + vec2(0.0, 1.0)), pbHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/** Two and a bit octaves - enough to look hand-mixed, cheap enough to be free. */
float pbFbm(vec2 p) {
  return pbNoise(p) * 0.6 + pbNoise(p * 2.7 + 11.3) * 0.3 + pbNoise(p * 6.1 + 3.7) * 0.1;
}
`;

/**
 * World position, which none of the built-in shaders hand the fragment stage.
 * Written from `transformed` so it survives instancing - the park is one
 * InstancedMesh, and its per-instance transform is what places every block.
 */
const WORLD_POSITION = /* glsl */ `
vec4 pbWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
pbWorld = instanceMatrix * pbWorld;
#endif
vPaintWorld = (modelMatrix * pbWorld).xyz;
`;

/**
 * A stable name for a snippet, so two materials painted the same way share one
 * compiled program instead of each forcing its own.
 */
function snippetKey(body: string): string {
  let hash = 0;
  for (let i = 0; i < body.length; i++) hash = (hash * 31 + body.charCodeAt(i)) | 0;
  return `pocket-paint-${(hash >>> 0).toString(36)}`;
}

/**
 * Wires a fragment-stage snippet into a stock material. The snippet runs right
 * after the material's own color is resolved and may modify `diffuseColor`;
 * `vPaintWorld`, `uPaintTime`, `uPaintDrift` and `uPaintTint` are in scope.
 */
function patch(material: Material, body: string) {
  // Idempotent: a ref callback may hand us the same material twice, and a
  // second copy of the snippet would double every effect in it.
  if (material.userData.painted) return;
  material.userData.painted = true;

  const key = snippetKey(body);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintTime = PAINT.time;
    shader.uniforms.uPaintDrift = PAINT.drift;
    shader.uniforms.uPaintTint = PAINT.tint;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPaintWorld;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WORLD_POSITION}`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vPaintWorld;
uniform float uPaintTime;
uniform vec2 uPaintDrift;
uniform vec3 uPaintTint;
${NOISE}`,
      )
      .replace("#include <color_fragment>", `#include <color_fragment>\n${body}`);
  };
  // Two materials painted differently must not share a compiled program; two
  // painted the same way should.
  material.customProgramCacheKey = () => key;
}

/** How a ground surface is painted. Defaults are the turf's. */
export interface GroundPaint {
  /** Size of the blotches, in park feet: bigger number, smaller patches. */
  patchScale?: number;
  /** How much the blotches lighten and darken the fill. */
  patchDepth?: number;
  /** How much afternoon warmth pools over the infield. */
  warmth?: number;
}

/**
 * Grass, dirt and the warning track. Three things happen here, in the order a
 * painter would do them: the fill goes on unevenly, the sun warms the middle of
 * the park, and a cloud crosses.
 */
export function paintedGround(material: Material, paint: GroundPaint = {}) {
  const patchScale = paint.patchScale ?? 0.045;
  const patchDepth = paint.patchDepth ?? 0.16;
  const warmth = paint.warmth ?? 0.1;

  patch(
    material,
    /* glsl */ `
{
  vec2 pbGround = vPaintWorld.xz;

  // Mixed by hand and laid on unevenly: broad blotches with a finer grain
  // inside them, at the scale of a few mown bands rather than a few blades.
  // The blotches shift the *hue* as well as the value - a lighter patch of
  // turf goes yellow, a darker one goes blue - which is the difference between
  // paint and a brightness wobble.
  float pbPatch = pbFbm(pbGround * ${patchScale.toFixed(4)}) - 0.5;
  diffuseColor.rgb *= 1.0 + pbPatch * ${(patchDepth * 2).toFixed(4)};
  diffuseColor.rgb *= vec3(1.0 + pbPatch * 0.1, 1.0 + pbPatch * 0.04, 1.0 - pbPatch * 0.12);

  // Picture-book colour: pull everything a little away from grey. Lambert's
  // own falloff desaturates as it darkens, which is true of light and wrong
  // for a toy park.
  float pbLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(pbLuma), diffuseColor.rgb, 1.16);

  // The diorama's own falloff, measured from the middle of the diamond: the
  // infield is the brightest, warmest thing in the park, and the ground sits
  // back and cools as it runs out toward the wall.
  float pbReach = length(pbGround - vec2(0.0, -60.0)) / 430.0;
  diffuseColor.rgb *= 1.0 - 0.2 * smoothstep(0.25, 1.1, pbReach);
  diffuseColor.rgb *= mix(
    vec3(1.0 + ${warmth.toFixed(4)}, 1.0 + ${(warmth * 0.55).toFixed(4)}, 1.0 - ${(warmth * 0.55).toFixed(4)}),
    vec3(1.0),
    smoothstep(0.0, 0.8, pbReach)
  );
  // Aerial perspective. Outdoors, distance is the colour of the sky, and eight
  // hundred feet of one flat green is exactly what reads as a painted floor
  // rather than as a field you could walk out onto.
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaintTint, 0.17 * smoothstep(0.2, 1.15, pbReach));

  // And a cloud going over. Enormous and very soft, so it reads as weather
  // rather than as texture, drifting on the same wind the ball flies through.
  // One octave: at this scale the finer ones are invisible, and the turf is
  // most of the screen, so every hash it does not do is worth having.
  float pbDapple = pbNoise(pbGround * 0.0024 + uPaintDrift * uPaintTime * 0.0075);
  diffuseColor.rgb *= mix(0.89, 1.06, smoothstep(0.2, 0.8, pbDapple));
}
`,
  );
}

/**
 * The stonework, the seats, the wall and everything else in the park's one
 * InstancedMesh. A bowl of identical fills reads as a render; the same bowl
 * sunlit at the top, in its own shade at the bottom, and no two boxes quite
 * the same value, reads as a painting of one.
 */
export function paintedPark(material: Material) {
  patch(
    material,
    /* glsl */ `
{
  // Up in the top deck the sun is still on the stone; down at the concourse it
  // sits in the bowl's shade, which is cooler as well as darker.
  float pbLift = clamp(vPaintWorld.y / 150.0, 0.0, 1.0);
  diffuseColor.rgb *= mix(vec3(0.84, 0.87, 0.97), vec3(1.1, 1.06, 0.95), pbLift);

  // No two boxes on exactly the same value, so a wall of seats reads as
  // painted rather than as one flat fill.
  float pbGrain = pbFbm(vPaintWorld.xz * 0.06 + vPaintWorld.y * 0.013) - 0.5;
  diffuseColor.rgb *= 1.0 + pbGrain * 0.2;

  // The same picture-book saturation the ground gets, and the same haze, so
  // the far side of the bowl and the outfield grass agree about distance.
  float pbLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(pbLuma), diffuseColor.rgb, 1.12);

  float pbOut = length(vPaintWorld.xz) / 900.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaintTint, 0.14 * smoothstep(0.35, 1.2, pbOut));
}
`,
  );
}
