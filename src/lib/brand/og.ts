/**
 * Everything the generated Open Graph images need that the app normally gets
 * from CSS.
 *
 * OG images are rendered by satori, which has no stylesheet, no `next/font`,
 * and no CSS custom properties. So the palette from `globals.css` and the
 * brand artwork from `components/brand/Ball.tsx` are restated here with
 * literal values, and the display/body fonts are read off disk. Keep this file
 * in step with those two when the brand moves.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The `@theme` block of globals.css, spelled out. */
export const BRAND = {
  paper: "#f7efe1",
  paperDeep: "#eee2cd",
  card: "#fffcf5",
  grass: "#3f8f5b",
  grassDeep: "#1f5a39",
  grassSoft: "#8fca9f",
  grassMist: "#dcedd9",
  bark: "#4a3524",
  barkSoft: "#8b6d52",
  clay: "#c2764a",
  claySoft: "#e5b98e",
} as const;

/** The paper-and-mown-grass wash every page sits on. */
export const PAGE_BACKGROUND = {
  backgroundColor: BRAND.paper,
  backgroundImage: `radial-gradient(circle at 10% 0%, ${BRAND.grassMist} 0%, ${BRAND.paper} 62%)`,
} as const;

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** The wordmark's baseball: cream leather, two clay seams, little stitches. */
export const BALL_SRC = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="21" fill="${BRAND.card}" stroke="${BRAND.bark}" stroke-width="2.5" />
  <g fill="none" stroke="${BRAND.clay}" stroke-width="2" stroke-linecap="round">
    <path d="M11 8c5 6 5 26 0 32" />
    <path d="M37 8c-5 6-5 26 0 32" />
    <g stroke-width="1.6">
      <path d="M14 15l-3.5 1.5M14 21l-4 .8M14 27l-4-.6M14 33l-3.5-1.6" />
      <path d="M34 15l3.5 1.5M34 21l4 .8M34 27l4-.6M34 33l3.5-1.6" />
    </g>
  </g>
</svg>`);

function cap(x: number, y: number, shirt: string, hat: string): string {
  return `<g>
    <ellipse cx="${x}" cy="${y + 11}" rx="6" ry="2" fill="rgba(31,90,57,0.22)" />
    <rect x="${x - 4}" y="${y}" width="8" height="11" rx="4" fill="${shirt}" />
    <circle cx="${x}" cy="${y - 4}" r="4.4" fill="${BRAND.claySoft}" />
    <path d="M${x - 4.6} ${y - 5.4}a4.6 4.6 0 0 1 9.2 0z" fill="${hat}" />
  </g>`;
}

/**
 * The park itself, as a friendly little vignette - the same drawing the home
 * page hero carries, so a shared link looks like the page it opens.
 */
export const PARK_SRC = dataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280" width="400" height="280">
  <defs>
    <clipPath id="park-clip"><rect x="0" y="0" width="400" height="280" rx="28" /></clipPath>
  </defs>
  <g clip-path="url(#park-clip)">
    <rect width="400" height="280" fill="${BRAND.grassMist}" />

    <circle cx="300" cy="48" r="26" fill="${BRAND.claySoft}" opacity="0.55" />
    <circle cx="300" cy="48" r="17" fill="${BRAND.card}" />
    <g fill="${BRAND.card}" opacity="0.9">
      <ellipse cx="78" cy="52" rx="30" ry="14" />
      <ellipse cx="98" cy="44" rx="20" ry="13" />
      <ellipse cx="196" cy="34" rx="24" ry="11" />
    </g>

    ${[58, 352]
      .map(
        (x) => `<g>
      <rect x="${x - 2.5}" y="86" width="5" height="60" rx="2.5" fill="${BRAND.barkSoft}" />
      <rect x="${x - 17}" y="70" width="34" height="20" rx="7" fill="${BRAND.bark}" />
      <g fill="${BRAND.claySoft}">
        <circle cx="${x - 9}" cy="80" r="3.4" />
        <circle cx="${x}" cy="80" r="3.4" />
        <circle cx="${x + 9}" cy="80" r="3.4" />
      </g>
    </g>`,
      )
      .join("")}

    <path d="M14 190C14 128 96 104 200 104s186 24 186 86z" fill="${BRAND.grassDeep}" />
    <path d="M14 190C14 132 96 110 200 110s186 22 186 80z" fill="none" stroke="${BRAND.claySoft}" stroke-width="4" />
    <path d="M14 300C14 148 96 126 200 126s186 22 186 174z" fill="${BRAND.grass}" />
    <g fill="${BRAND.grassSoft}" opacity="0.28">
      <path d="M60 300c0-96 50-160 140-172v172z" />
      <path d="M280 300c0-88-30-152-80-172v172z" />
    </g>

    <path d="M200 242 L110 211 Q200 115 290 211 Z" fill="${BRAND.clay}" opacity="0.9" />
    <ellipse cx="200" cy="243" rx="30" ry="14" fill="${BRAND.clay}" opacity="0.9" />
    <path d="M200 236 L240 204 L200 172 L160 204 Z" fill="${BRAND.grass}" />
    <g stroke="${BRAND.card}" stroke-width="2.5" stroke-linecap="round">
      <path d="M200 242 L34 186" />
      <path d="M200 242 L366 186" />
    </g>

    <g fill="${BRAND.card}">
      <rect x="236" y="200" width="8" height="8" rx="2" transform="rotate(45 240 204)" />
      <rect x="196" y="168" width="8" height="8" rx="2" transform="rotate(45 200 172)" />
      <rect x="156" y="200" width="8" height="8" rx="2" transform="rotate(45 160 204)" />
      <path d="M195 238h10v5l-5 4-5-4z" />
    </g>
    <ellipse cx="200" cy="206" rx="15" ry="8" fill="${BRAND.claySoft}" />

    ${cap(200, 198, BRAND.card, BRAND.grassDeep)}
    ${cap(230, 234, BRAND.clay, BRAND.bark)}
    ${cap(268, 188, BRAND.card, BRAND.grassDeep)}
    ${cap(134, 188, BRAND.card, BRAND.grassDeep)}
    ${cap(200, 152, BRAND.card, BRAND.grassDeep)}
  </g>
</svg>`);

/**
 * A club's colors as a roundel: the schedule card's disc, with the trim color
 * as an inner ring so two clubs never come out as the same flat circle.
 */
export function teamDiscSrc(primary: string, secondary: string): string {
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="22.5" fill="${primary}" stroke="${BRAND.card}" stroke-width="3" />
    <circle cx="24" cy="24" r="14" fill="none" stroke="${secondary}" stroke-width="5" />
  </svg>`);
}

const FONT_DIR = join(process.cwd(), "assets/fonts");

/**
 * Baloo carries the wordmark and the headline; Nunito reads small and round
 * for everything else - the same pairing as the app itself.
 */
export async function ogFonts() {
  const [baloo, nunito, nunitoSemi] = await Promise.all([
    readFile(join(FONT_DIR, "Baloo2-ExtraBold.ttf")),
    readFile(join(FONT_DIR, "Nunito-Regular.ttf")),
    readFile(join(FONT_DIR, "Nunito-SemiBold.ttf")),
  ]);
  return [
    { name: "Baloo", data: baloo, weight: 800 as const, style: "normal" as const },
    { name: "Nunito", data: nunito, weight: 400 as const, style: "normal" as const },
    { name: "Nunito", data: nunitoSemi, weight: 600 as const, style: "normal" as const },
  ];
}
