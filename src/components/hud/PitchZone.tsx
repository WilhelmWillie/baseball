"use client";

import type { GameSnapshot, PitchOutcome } from "@/lib/game/types";

/**
 * Half the width of the box, in feet. The plate is seventeen inches across and
 * a pitch is a strike if any part of the ball clips it, so the zone a call is
 * really made against runs a ball's radius wider on each side - the same 0.83
 * every public pitch plot is drawn to.
 */
const ZONE_HALF_WIDTH = 0.83;

/** Knees to letters on an average hitter, for a plate appearance with no pitches yet. */
const DEFAULT_ZONE = { top: 3.4, bottom: 1.6 };

/**
 * How much air to leave around the zone, in feet.
 *
 * Measured off a real game rather than guessed at. Over the ~300 pitches of one
 * (`public/recordings`, 824641), the middle 90% crossed between 1.0 and 3.9
 * feet up and within about 1.3 feet either side of the plate - a miss is
 * roughly as likely over the zone as under it, which is not what you would
 * assume from how a breaking ball looks. These cover that spread with a little
 * over; the handful wilder than the picture are pinned to its edge rather than
 * drawn outside it, the way a broadcast pins a pitch to the backstop.
 */
const SIDE_MARGIN = 1.1;
const VERTICAL_MARGIN = 1.25;

const BALL_R = 0.19;
const LAST_BALL_R = 0.225;

/** The band down the side of the box marking which side the hitter stands on. */
const BAND_WIDTH = 0.36;

const CALL: Record<PitchOutcome, string> = {
  ball: "Ball",
  called_strike: "Called strike",
  swinging_strike: "Swing and miss",
  foul: "Foul",
  in_play: "In play",
  hit_by_pitch: "Hit by pitch",
  other: "Pitch",
};

/**
 * What a pitch is worth, in one colour: a ball is the hitter's, a strike is the
 * pitcher's, and a ball put in play belongs to neither yet. `ink` goes into the
 * drawing, where the palette has to be named as a variable; `text` is the same
 * colour as a class, for the line under the box.
 */
function toneFor(outcome: PitchOutcome): { ink: string; text: string } {
  switch (outcome) {
    case "ball":
    case "hit_by_pitch":
      return { ink: "var(--color-grass)", text: "text-grass-deep" };
    case "in_play":
      return { ink: "var(--color-bark)", text: "text-bark" };
    case "other":
      return { ink: "var(--color-bark-soft)", text: "text-bark-soft" };
    default:
      return { ink: "var(--color-clay)", text: "text-clay" };
  }
}

/** "5 pitches", or the one that has been thrown. */
function pitchTally(count: number): string {
  if (count === 0) return "—";
  return count === 1 ? "1 pitch" : `${count} pitches`;
}

/**
 * The strike-zone box: where every pitch of the plate appearance crossed, with
 * the one that just arrived called out - the pitch tracker every broadcast
 * carries in a corner of the screen.
 *
 * Drawn from the feed's own measurements. MLB publishes the plate coordinates
 * of a pitch and the zone it was judged against, fitted to that hitter's
 * stance, so this is the umpire's picture rather than the animation's. The park
 * throws at the same numbers, but it is a figure drawn at more than twice life
 * size catching the ball, and nobody should have to read a two-inch miss off a
 * cartoon.
 *
 * The plot is filled two ways and has to be, because the two cover for each
 * other: `buildSnapshot` reads the whole plate appearance off the feed, which
 * is what a viewer who joined mid-at-bat sees, and the director reveals each
 * pitch as it crosses the plate, which is what keeps the plot level with the
 * animation instead of several pitches ahead of it.
 */
export function PitchZone({ snapshot }: { snapshot: GameSnapshot }) {
  const pitches = snapshot.pitches;
  const last = pitches.length > 0 ? pitches[pitches.length - 1] : null;
  const zone = last?.zone ?? DEFAULT_ZONE;

  // The window, in feet: the zone plus its margins, centred on the zone. The
  // picture comes out taller than it is wide, because the zone is, and the
  // element it renders into is given that same ratio - so a foot across reads
  // as the same distance as a foot up and no pitch is drawn out of shape.
  const viewW = (ZONE_HALF_WIDTH + SIDE_MARGIN) * 2;
  const viewH = zone.top - zone.bottom + VERTICAL_MARGIN * 2;
  const middle = (zone.top + zone.bottom) / 2;

  /**
   * Feet over the plate, into the picture. MLB measures `x` positive toward
   * right field - the catcher's right - and the broadcast camera is out in
   * centre field looking back in, which puts right field on the *left* of the
   * frame. The plot mirrors to match, so a pitch sits on the side of the box it
   * was just seen on, and a right-handed hitter's box is the one on the right.
   *
   * It is a choice between two right answers: the shots taken from behind the
   * plate - the two-strike look over the catcher, the press-box seat - see the
   * mirror image of this, as does every pitch chart drawn from the catcher's
   * side. Agreeing with the shot that throws nearly every pitch wins.
   */
  const sx = (x: number) => -x;
  const sy = (z: number) => middle - z;
  /** Keep a wild one at the edge of the picture, ring and all, rather than outside it. */
  const pin = (v: number, extent: number) => {
    const edge = extent / 2 - (LAST_BALL_R + 0.14);
    return Math.max(-edge, Math.min(edge, v));
  };

  const tone = toneFor(last?.outcome ?? "other");
  const detail = last?.pitchType ?? "";
  const speed = last?.speed ? `${Math.round(last.speed)} MPH` : "";
  const standsRight = last?.batSide !== "L";
  const bandX = standsRight ? viewW / 2 - BAND_WIDTH : -viewW / 2;

  return (
    <div className="pointer-events-none w-40 select-none rounded-2xl border-2 border-grass-deep/12 bg-card/95 p-2.5 backdrop-blur-[2px] lip-float sm:w-[180px]">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-display text-xs font-extrabold text-grass-deep">Strike zone</span>
        <span className="text-[10px] font-bold text-bark-soft">
          {pitchTally(pitches.length)}
        </span>
      </div>

      <div className="rounded-xl bg-grass-mist/70 p-1">
        <svg
          viewBox={`${-viewW / 2} ${-viewH / 2} ${viewW} ${viewH}`}
          className="w-full"
          style={{ aspectRatio: `${viewW} / ${viewH}` }}
          role="img"
          aria-label={
            last
              ? `Strike zone, ${pitches.length} pitches this at-bat. Last pitch: ${CALL[last.outcome]}.`
              : "Strike zone, no pitches thrown yet this at-bat."
          }
        >
          {/* Which box the hitter is standing in. Without it there is no telling
              an inside pitch from an outside one, and the two are not the same
              pitch at all. */}
          {last && (
            <rect
              x={bandX}
              y={-viewH / 2}
              width={BAND_WIDTH}
              height={viewH}
              fill="var(--color-bark)"
              opacity="0.05"
            />
          )}

          {/* The zone: the outer call, then the nine cells inside it that every
              pitch chart in the game is read in. */}
          <g stroke="var(--color-bark)" fill="none" strokeLinejoin="round">
            <g opacity="0.16" strokeWidth="0.028">
              {[-1, 1].map((n) => (
                <line
                  key={`v${n}`}
                  x1={(n * ZONE_HALF_WIDTH) / 3}
                  y1={sy(zone.top)}
                  x2={(n * ZONE_HALF_WIDTH) / 3}
                  y2={sy(zone.bottom)}
                />
              ))}
              {[1, 2].map((n) => (
                <line
                  key={`h${n}`}
                  x1={-ZONE_HALF_WIDTH}
                  y1={sy(zone.top - ((zone.top - zone.bottom) * n) / 3)}
                  x2={ZONE_HALF_WIDTH}
                  y2={sy(zone.top - ((zone.top - zone.bottom) * n) / 3)}
                />
              ))}
            </g>
            <rect
              x={-ZONE_HALF_WIDTH}
              y={sy(zone.top)}
              width={ZONE_HALF_WIDTH * 2}
              height={zone.top - zone.bottom}
              rx="0.04"
              opacity="0.42"
              strokeWidth="0.06"
            />
          </g>

          {pitches.map((pitch, i) => {
            const isLast = i === pitches.length - 1;
            const ink = toneFor(pitch.outcome).ink;
            const cx = pin(sx(pitch.x), viewW);
            const cy = pin(sy(pitch.z), viewH);
            const r = isLast ? LAST_BALL_R : BALL_R;
            return (
              <g key={pitch.id} opacity={isLast ? 1 : 0.66}>
                {/* The one that just landed wears a ring, the way a broadcast
                    rings the pitch it is talking about. */}
                {isLast && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 0.13}
                    fill="none"
                    stroke={ink}
                    strokeWidth="0.05"
                    opacity="0.5"
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="var(--color-card)"
                  stroke={ink}
                  strokeWidth={isLast ? 0.08 : 0.055}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={pitch.number > 9 ? 0.2 : 0.25}
                  fontWeight="800"
                  fill="var(--color-bark)"
                  opacity={isLast ? 0.9 : 0.55}
                >
                  {pitch.number}
                </text>
              </g>
            );
          })}

          {last && (
            <text
              x={bandX + BAND_WIDTH / 2}
              y={viewH / 2 - 0.22}
              textAnchor="middle"
              fontSize="0.3"
              fontWeight="800"
              fill="var(--color-bark-soft)"
              opacity="0.55"
            >
              {last.batSide}
            </text>
          )}
        </svg>
      </div>

      {/* Two lines, always: the call and the speed, then the pitch itself. A
          block that changes height with the length of a pitch name would shove
          the game log up and down the screen all afternoon. */}
      <div className="mt-1.5">
        <div className="flex items-baseline justify-between gap-1.5">
          <span className={`font-display text-[11px] font-extrabold leading-none ${tone.text}`}>
            {last ? CALL[last.outcome] : "First pitch"}
          </span>
          <span className="shrink-0 text-[10px] font-bold leading-none text-bark-soft">{speed}</span>
        </div>
        <div className="truncate text-[10px] leading-snug text-bark-soft">
          {last ? `#${last.number}${detail ? ` · ${detail}` : ""}` : "on the way"}
        </div>
      </div>
    </div>
  );
}
