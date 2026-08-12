import { ImageResponse } from "next/og";
import { summarizeGame, type GameSummary } from "@/lib/game/schedule";
import { fetchScheduleGame } from "@/lib/mlb/client";
import { DEMO_GAME_PK, demoSummary } from "@/lib/sim/feed";
import { BALL_SRC, BRAND, PAGE_BACKGROUND, ogFonts, teamDiscSrc } from "@/lib/brand/og";

export const alt = "Watch this game in a low-poly ballpark";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card is regenerated whenever a crawler asks for it, but scrapers cache
 * what they get, so treat the score as a snapshot rather than a live number.
 */
export const revalidate = 60;

async function loadGame(gamePk: string): Promise<GameSummary | null> {
  if (gamePk === "demo" || Number(gamePk) === DEMO_GAME_PK) return demoSummary(0);
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

function statusLine(game: GameSummary): string {
  if (game.isDemo) return "A game we made up, always ready";
  if (game.state === "live") {
    return `${game.isTopInning ? "Top" : "Bottom"} ${game.inningOrdinal ?? ""} · ${game.outs ?? 0} out`.trim();
  }
  if (game.state === "final") return "Final";
  if (!game.startTime) return "Scheduled";
  return new Date(game.startTime).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function TeamRow({ team, score }: { team: GameSummary["home"]; score: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
      <img
        src={teamDiscSrc(team.palette.primary, team.palette.secondary)}
        width={76}
        height={76}
        alt=""
      />
      <span
        style={{
          width: 150,
          fontFamily: "Baloo",
          fontSize: 62,
          letterSpacing: "-0.02em",
          color: BRAND.bark,
        }}
      >
        {team.abbrev}
      </span>
      <span style={{ flex: 1, fontSize: 34, color: BRAND.barkSoft }}>{team.name}</span>
      <span
        style={{
          fontFamily: "Baloo",
          fontSize: 62,
          color: score == null ? BRAND.barkSoft : BRAND.grassDeep,
        }}
      >
        {score ?? "–"}
      </span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ gamePk: string }> }) {
  const { gamePk } = await params;
  const game = await loadGame(gamePk);

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
          padding: "58px 72px",
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
              gap: 26,
              padding: "36px 48px",
              borderRadius: 40,
              border: `3px solid rgba(31, 90, 57, 0.14)`,
              backgroundColor: BRAND.card,
              boxShadow: `0 6px 0 0 ${BRAND.paperDeep}, 0 18px 34px -14px rgba(74, 53, 36, 0.45)`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 26 }}>
              <span
                style={{
                  display: "flex",
                  padding: "8px 20px",
                  borderRadius: 999,
                  backgroundColor:
                    game.state === "live" ? BRAND.grass : BRAND.paperDeep,
                  color: game.state === "live" ? BRAND.card : BRAND.barkSoft,
                  fontWeight: 600,
                }}
              >
                {statusLine(game)}
              </span>
              <span style={{ color: BRAND.barkSoft }}>{game.venue}</span>
            </div>

            <TeamRow team={game.away} score={game.away.score} />
            <TeamRow team={game.home} score={game.home.score} />
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
