import { ImageResponse } from "next/og";
import { summarizeGame, type GameSummary } from "@/lib/game/schedule";
import { fetchScheduleGame } from "@/lib/mlb/client";
import { BALL_SRC, BRAND, PAGE_BACKGROUND, ogFonts, teamDiscSrc } from "@/lib/brand/og";

export const alt = "Watch this game in a low-poly ballpark";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Everything on this card holds still for the life of the game - who is
 * playing, where, and when. Nothing that moves while the game is played goes
 * on it: a scraper fetches the image once and serves that copy for as long as
 * the link circulates, so a score or an inning would be wrong within minutes
 * of the post. That is also why it can be cached hard.
 */
export const revalidate = 3600;

async function loadGame(gamePk: string): Promise<GameSummary | null> {
  const id = Number(gamePk);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const game = await fetchScheduleGame(id);
    return game ? summarizeGame(game) : null;
  } catch {
    // A share card is never worth failing a request over.
    return null;
  }
}

/** First pitch, in the ballpark's own words. Fixed once the game is scheduled. */
function firstPitch(game: GameSummary): string | null {
  if (!game.startTime) return null;
  return new Date(game.startTime).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function Team({ team }: { team: GameSummary["home"] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 340,
      }}
    >
      <img
        src={teamDiscSrc(team.palette.primary, team.palette.secondary)}
        width={96}
        height={96}
        alt=""
      />
      <span
        style={{
          marginTop: 14,
          fontFamily: "Baloo",
          fontSize: 62,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: BRAND.bark,
        }}
      >
        {team.abbrev}
      </span>
      <span style={{ marginTop: 6, fontSize: 29, color: BRAND.barkSoft }}>{team.name}</span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ gamePk: string }> }) {
  const { gamePk } = await params;
  const game = await loadGame(gamePk);
  const when = game ? firstPitch(game) : null;
  const footnote = [game?.venue, when].filter(Boolean).join(" · ");

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

        {game ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "34px 48px 28px",
              borderRadius: 40,
              border: `3px solid rgba(31, 90, 57, 0.14)`,
              backgroundColor: BRAND.card,
              boxShadow: `0 6px 0 0 ${BRAND.paperDeep}, 0 18px 34px -14px rgba(74, 53, 36, 0.45)`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <Team team={game.away} />
              <span
                style={{
                  fontFamily: "Baloo",
                  fontSize: 46,
                  color: BRAND.claySoft,
                }}
              >
                @
              </span>
              <Team team={game.home} />
            </div>

            {footnote ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 26,
                  paddingTop: 20,
                  width: "100%",
                  justifyContent: "center",
                  borderTop: `2px dashed rgba(31, 90, 57, 0.16)`,
                  fontSize: 26,
                  color: BRAND.barkSoft,
                }}
              >
                {footnote}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              fontFamily: "Baloo",
              fontSize: 78,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: BRAND.grassDeep,
            }}
          >
            Watch baseball come to life.
          </div>
        )}

        <div style={{ display: "flex", fontSize: 30, color: BRAND.barkSoft }}>
          Every pitch, hit, and baserunner in a charming low-poly ballpark.
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
