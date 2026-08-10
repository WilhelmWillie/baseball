import { Vector3 } from "three";

/**
 * Time of day and weather.
 *
 * The feed knows when first pitch was and what the sky was doing; this turns
 * that into a lighting rig. A 1:05 game and a 7:05 game should not look the
 * same, and neither should a clear one and an overcast one - it is the cheapest
 * way to make a generic park feel like a particular afternoon.
 */

export interface Conditions {
  /** Local clock at the park, in hours. 13.5 is half past one. */
  hour: number;
  /** 0 = clear, 1 = overcast. */
  cloud: number;
  /** 0 = dry, 1 = coming down. */
  rain: number;
  /** Rain falls as snow below freezing, and it looks completely different. */
  snow: boolean;
  /** A closed roof means the weather outside is irrelevant. */
  indoor: boolean;
  /** Wind in world space, feet per second. */
  wind: Vector3;
  /** As the feed words it, for the HUD. */
  condition: string;
  temp: string | null;
  windLabel: string | null;
}

export const DEFAULT_CONDITIONS: Conditions = {
  hour: 13.5,
  cloud: 0.15,
  rain: 0,
  snow: false,
  indoor: false,
  wind: new Vector3(),
  condition: "Clear",
  temp: null,
  windLabel: null,
};

/** How overcast each of MLB's condition strings reads as. */
const CLOUD: Array<[RegExp, number]> = [
  [/sunny|clear/i, 0.06],
  [/partly/i, 0.35],
  [/mostly cloudy/i, 0.75],
  [/cloudy|overcast/i, 0.85],
  [/drizzle/i, 0.8],
  [/rain|shower/i, 0.95],
  [/snow/i, 0.9],
];

const RAIN: Array<[RegExp, number]> = [
  [/drizzle/i, 0.45],
  [/rain|shower/i, 1],
  [/snow/i, 0.7],
];

/**
 * Which way the wind blows, as MLB writes it: "Out To CF", "L To R", and so
 * on. Directions are where the air is going, in world space.
 */
const WIND_DIRECTION: Array<[RegExp, [number, number]]> = [
  [/out to cf|out to center/i, [0, -1]],
  [/in from cf|in from center/i, [0, 1]],
  [/out to lf|out to left/i, [-0.71, -0.71]],
  [/in from lf|in from left/i, [0.71, 0.71]],
  [/out to rf|out to right/i, [0.71, -0.71]],
  [/in from rf|in from right/i, [-0.71, 0.71]],
  [/l to r/i, [1, 0]],
  [/r to l/i, [-1, 0]],
];

function match(table: Array<[RegExp, number]>, text: string, fallback: number): number {
  for (const [pattern, value] of table) if (pattern.test(text)) return value;
  return fallback;
}

/** "8 mph, Out To CF" -> a velocity in world feet per second. */
export function parseWind(label: string | undefined): Vector3 {
  if (!label) return new Vector3();
  const mph = Number(label.match(/(\d+)\s*mph/i)?.[1] ?? 0);
  if (!mph) return new Vector3();
  const direction = WIND_DIRECTION.find(([pattern]) => pattern.test(label))?.[1];
  if (!direction) return new Vector3();
  // 1 mph is 1.47 ft/s. Held back a little: at full strength the confetti
  // leaves the park.
  const speed = mph * 1.47 * 0.55;
  return new Vector3(direction[0] * speed, 0, direction[1] * speed);
}

/** Local clock hour from MLB's "7:05" plus "pm". */
export function parseLocalHour(time: string | undefined, ampm: string | undefined): number | null {
  const parts = time?.match(/^(\d{1,2}):(\d{2})/);
  if (!parts) return null;
  let hour = Number(parts[1]) % 12;
  if (/pm/i.test(ampm ?? "")) hour += 12;
  return hour + Number(parts[2]) / 60;
}

export interface SkyLook {
  /** Where the key light sits. After dark this is the tower rig, not the sun. */
  sun: [number, number, number];
  /** Where the sky shader's sun sits, which is a different thing after dark. */
  skySun: [number, number, number];
  mie: number;
  sunIntensity: number;
  sunColor: string;
  fillIntensity: number;
  fillColor: string;
  ambient: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  turbidity: number;
  rayleigh: number;
  /** Tower lights burning. */
  lampsLit: boolean;
  /**
   * Light the field from the towers themselves rather than from a single sun.
   * Four crossing beams is what a night game actually looks like - every player
   * throws two or three faint shadows in different directions.
   */
  towerRig: boolean;
  /** 0 in full sun, 1 after dark. */
  night: number;
  /**
   * A flat background instead of the sky shader. The Preetham model the shader
   * implements only describes a daylit atmosphere: pushed past dusk it returns
   * a murky grey-brown rather than a night sky, so after dark we paint one.
   */
  background: string | null;
  fog: { color: string; density: number } | null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Blend two "#rrggbb" strings. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${to(mix(ar, br, t))}${to(mix(ag, bg, t))}${to(mix(ab, bb, t))}`;
}

const SUN_RADIUS = 420;

/**
 * Turn conditions into lights. The sun tracks a plausible arc - up over the
 * first-base side in the morning, down behind third in the evening - and once
 * it is under the horizon the tower lights take over with a flat warm rig,
 * which is what a night game actually looks like.
 */
export function skyLook(conditions: Conditions): SkyLook {
  const { cloud, rain, indoor } = conditions;

  if (indoor) {
    return {
      sun: [0, SUN_RADIUS, 90],
      skySun: [0, -SUN_RADIUS, 90],
      mie: 0.02,
      sunIntensity: 0.4,
      sunColor: "#fff3dd",
      fillIntensity: 0.4,
      fillColor: "#e8f0ff",
      ambient: 0.5,
      hemiSky: "#dfe6ee",
      hemiGround: "#3d5a37",
      hemiIntensity: 0.7,
      turbidity: 12,
      rayleigh: 0.4,
      lampsLit: true,
      towerRig: true,
      night: 1,
      background: "#161a20",
      fog: null,
    };
  }

  // Dawn at 5:30, dusk at 19:30, mapped to a half-turn of the sky.
  const t = (conditions.hour - 5.5) / 14;
  const arc = Math.max(-0.28, Math.min(1.28, t)) * Math.PI;
  const elevation = Math.sin(arc);
  const daylight = clamp01((elevation + 0.05) / 0.3);
  const night = 1 - daylight;
  // Low sun is orange, high sun is white.
  const golden = clamp01(elevation / 0.45);

  const sun: [number, number, number] = [
    Math.cos(arc) * SUN_RADIUS,
    elevation * SUN_RADIUS,
    150,
  ];

  if (night > 0.9) {
    // Tower lighting: bright, warm, from high up, and almost shadowless. The
    // sky shader keeps the real sun, which is under the horizon by now.
    return {
      sun: [40, SUN_RADIUS, 120],
      skySun: sun,
      mie: 0.004,
      // Just enough from above that nothing is pitch black; the four towers
      // do the real work.
      sunIntensity: 0.3,
      sunColor: "#ffeec7",
      fillIntensity: 0.18,
      fillColor: "#a9c0e8",
      ambient: 0.3,
      hemiSky: "#28375c",
      hemiGround: "#1d2c1a",
      hemiIntensity: 0.42,
      turbidity: 6,
      rayleigh: 0.6,
      lampsLit: true,
      towerRig: true,
      night: 1,
      background: "#0a1024",
      // Enough haze to soften the skyline without touching the infield.
      fog: { color: "#101a2e", density: 0.00042 },
    };
  }

  const overcast = clamp01(cloud);
  return {
    sun,
    skySun: sun,
    // A low sun gets a bigger, softer disc - most of what says "evening".
    mie: mix(0.024, 0.005, golden),
    sunIntensity: daylight * mix(1.35, 0.5, overcast),
    sunColor: mixHex("#ffb46b", "#fff4e0", golden),
    fillIntensity: mix(0.25, 0.35, overcast),
    fillColor: mixHex("#ffe6bd", "#dfe8f5", overcast),
    ambient: 0.26 + overcast * 0.24 + night * 0.14,
    hemiSky: mixHex(
      mixHex("#cfe6ff", "#b7c0ca", overcast),
      "#5a5f7a",
      night * 0.7,
    ),
    hemiGround: mixHex("#42663a", "#2b3f28", Math.max(overcast * 0.5, night * 0.6)),
    hemiIntensity: mix(0.85, 0.65, overcast),
    turbidity: mix(3.5, 14, overcast) + (1 - golden) * 3,
    // More scattering as the sun drops, which is what reddens the horizon.
    rayleigh: mix(1.1, 0.35, overcast) * mix(2.9, 1, golden),
    lampsLit: daylight < 0.72,
    // Dusk runs both: the sun is still up, but the towers are already on.
    towerRig: daylight < 0.45,
    night,
    background: null,
    fog:
      rain > 0.2 || overcast > 0.55 || night > 0.35
        ? {
            color: mixHex(
              mixHex("#c9d4e2", "#9fa8b4", overcast),
              "#1b2540",
              night,
            ),
            density: 0.00028 + rain * 0.0006 + overcast * 0.0002,
          }
        : null,
  };
}

export interface WeatherInput {
  condition?: string;
  temp?: string;
  wind?: string;
  /** Local first-pitch time, as MLB reports it. */
  time?: string;
  ampm?: string;
  /** ISO first-pitch instant, used to age the local clock as the game runs. */
  dateTime?: string;
  /** Roofed venues never see the weather. */
  venueName?: string;
}

const ROOFED = /tropicana|rogers centre|chase field|minute maid|globe life|american family field|loandepot|t-mobile park/i;

/** Feed weather and start time -> the conditions the renderer works from. */
export function readConditions(input: WeatherInput, now = Date.now()): Conditions {
  const condition = input.condition?.trim() || "";
  const indoor =
    /dome|roof closed/i.test(condition) ||
    (!condition && ROOFED.test(input.venueName ?? ""));

  const start = parseLocalHour(input.time, input.ampm);
  // Games run three hours; letting the clock age is what turns a 5pm start into
  // a sunset by the seventh.
  const elapsed = input.dateTime
    ? Math.max(0, Math.min(5, (now - Date.parse(input.dateTime)) / 3_600_000))
    : 0;
  const hour = start === null ? DEFAULT_CONDITIONS.hour : (start + elapsed) % 24;

  return {
    hour,
    cloud: condition ? match(CLOUD, condition, 0.2) : DEFAULT_CONDITIONS.cloud,
    rain: condition ? match(RAIN, condition, 0) : 0,
    snow: /snow/i.test(condition),
    indoor,
    wind: indoor ? new Vector3() : parseWind(input.wind),
    condition: condition || "Clear",
    temp: input.temp?.trim() || null,
    windLabel: input.wind?.trim() || null,
  };
}
