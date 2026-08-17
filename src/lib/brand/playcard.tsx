/* eslint-disable @next/next/no-img-element -- satori renders these, not a
   browser: `next/image` has no meaning inside an `ImageResponse`, and the
   sources here are inline SVG data URIs with nothing to optimize. The
   `opengraph-image` files are exempt by name; this one is a library. */
import { ImageResponse } from "next/og";
import type { AtBatCard } from "@/lib/share/atbat";
import { BALL_SRC, BRAND, PAGE_BACKGROUND, ogFonts, teamDiscSrc } from "./og";

/**
 * The share card for one plate appearance.
 *
 * Both play-level share links draw the same card with different words on it -
 * one describes a situation you are about to drop into, the other describes
 * what a play produced - so the layout lives here once.
 *
 * **This card carries the score, and the whole-game card next door deliberately
 * does not.** That is not an inconsistency. A card for a game goes stale the
 * moment somebody scores, and a scraper fetches it once and serves that copy
 * for as long as the link circulates. A card for a *specific past plate
 * appearance* describes a fixed historical fact: the score at that moment will
 * be the same forever. So this one can be cached as hard as the game card and
 * still say more.
 */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** A club's roundel and abbreviation, with its runs. */
function Side({
  team,
  runs,
}: {
  team: AtBatCard["game"]["home"];
  runs: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <img
        src={teamDiscSrc(team.palette.primary, team.palette.secondary)}
        width={64}
        height={64}
        alt=""
      />
      <span
        style={{
          fontFamily: "Baloo",
          fontSize: 46,
          letterSpacing: "-0.02em",
          color: BRAND.bark,
        }}
      >
        {team.abbrev}
      </span>
      <span
        style={{
          fontFamily: "Baloo",
          fontSize: 56,
          letterSpacing: "-0.02em",
          color: BRAND.grassDeep,
        }}
      >
        {runs}
      </span>
    </div>
  );
}

/**
 * Render the card.
 *
 * `headline` is the big line - a batter's name, always. `subject` is the line
 * under it that says what this link is about: an opponent for a link into a
 * game, an outcome for a clip.
 */
export async function playCardImage(options: {
  card: AtBatCard;
  headline: string;
  subject: string;
  score: { home: number; away: number };
  footnote?: string;
}): Promise<ImageResponse> {
  const { card, headline, subject, score } = options;
  const footnote =
    options.footnote ?? [card.game.venue, dateOf(card)].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          ...PAGE_BACKGROUND,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "44px 68px",
          fontFamily: "Nunito",
          color: BRAND.bark,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={BALL_SRC} width={40} height={40} alt="" />
          <div
            style={{
              display: "flex",
              gap: 10,
              fontFamily: "Baloo",
              fontSize: 32,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ color: BRAND.clay }}>Pocket</span>
            <span style={{ color: BRAND.grassDeep }}>Ballpark</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "30px 44px 26px",
            borderRadius: 36,
            border: "3px solid rgba(31, 90, 57, 0.14)",
            backgroundColor: BRAND.card,
            boxShadow: `0 6px 0 0 ${BRAND.paperDeep}, 0 18px 34px -14px rgba(74, 53, 36, 0.45)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "6px 20px",
              borderRadius: 999,
              backgroundColor: BRAND.grassMist,
              fontFamily: "Baloo",
              fontSize: 28,
              color: BRAND.grassDeep,
            }}
          >
            {card.half}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 14,
              fontFamily: "Baloo",
              fontSize: headline.length > 20 ? 66 : 78,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: BRAND.bark,
            }}
          >
            {headline}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: 34,
              fontWeight: 600,
              color: BRAND.clay,
            }}
          >
            {subject}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              // Centred rather than pushed to the corners: the two clubs and
              // their runs are one scoreline, and spreading them to the edges
              // reads as two unrelated badges with a stray dash between.
              justifyContent: "center",
              gap: 26,
              marginTop: 26,
              paddingTop: 22,
              borderTop: "2px dashed rgba(31, 90, 57, 0.16)",
            }}
          >
            <Side team={card.game.away} runs={score.away} />
            <span style={{ fontFamily: "Baloo", fontSize: 34, color: BRAND.claySoft }}>
              —
            </span>
            <Side team={card.game.home} runs={score.home} />
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 27, color: BRAND.barkSoft }}>{footnote}</div>
      </div>
    ),
    { ...CARD_SIZE, fonts: await ogFonts() },
  );
}

/**
 * The generic card, for when the play cannot be resolved.
 *
 * A share card is never worth failing a request over: an OG route that throws
 * hands a scraper an error where the ballpark would have done.
 */
export async function brandCardImage(): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          ...PAGE_BACKGROUND,
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 22,
          padding: "46px 72px",
          fontFamily: "Nunito",
          color: BRAND.bark,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={BALL_SRC} width={44} height={44} alt="" />
          <div
            style={{
              display: "flex",
              gap: 10,
              fontFamily: "Baloo",
              fontSize: 36,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ color: BRAND.clay }}>Pocket</span>
            <span style={{ color: BRAND.grassDeep }}>Ballpark</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Baloo",
            fontSize: 74,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            color: BRAND.grassDeep,
          }}
        >
          Watch baseball come to life.
        </div>
      </div>
    ),
    { ...CARD_SIZE, fonts: await ogFonts() },
  );
}

/** The game's date, in the ballpark's own words. */
function dateOf(card: AtBatCard): string {
  if (!card.game.startTime) return "";
  return new Date(card.game.startTime).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
