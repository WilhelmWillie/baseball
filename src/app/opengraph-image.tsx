import { ImageResponse } from "next/og";
import { BALL_SRC, BRAND, PAGE_BACKGROUND, PARK_SRC, ogFonts } from "@/lib/brand/og";

export const alt =
  "Pocket Ballpark — Watch baseball come to life. Pick a game, grab a seat, and watch every pitch unfold in a charming low-poly ballpark.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The home page hero, at share size: the headline and the little park. */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          ...PAGE_BACKGROUND,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          fontFamily: "Nunito",
          color: BRAND.bark,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 660,
            padding: "0 0 0 72px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={BALL_SRC} width={46} height={46} alt="" />
            <div
              style={{
                display: "flex",
                gap: 10,
                fontFamily: "Baloo",
                fontSize: 38,
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
              marginTop: 44,
              fontFamily: "Baloo",
              fontSize: 86,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: BRAND.grassDeep,
            }}
          >
            <span>Watch baseball</span>
            <span>come to life.</span>
          </div>

          <div
            style={{
              marginTop: 30,
              maxWidth: 520,
              fontSize: 28,
              lineHeight: 1.5,
              color: BRAND.barkSoft,
            }}
          >
            Pick a game. Grab a seat. Watch every pitch, hit, and baserunner unfold in a
            charming low-poly ballpark.
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            flex: 1,
            height: "100%",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 56,
              top: 168,
              display: "flex",
              borderRadius: 34,
              border: `3px solid rgba(31, 90, 57, 0.14)`,
              // The chunky, toy-like "lip" the cards on the page have.
              boxShadow: `0 6px 0 0 ${BRAND.paperDeep}, 0 18px 34px -14px rgba(74, 53, 36, 0.45)`,
            }}
          >
            <img
              src={PARK_SRC}
              width={410}
              height={287}
              alt=""
              style={{ borderRadius: 31 }}
            />
          </div>

          {/* The ball that bobs off the vignette's top corner on the page. */}
          <img
            src={BALL_SRC}
            width={84}
            height={84}
            alt=""
            style={{
              position: "absolute",
              left: 400,
              top: 132,
              transform: "rotate(-8deg)",
            }}
          />
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
