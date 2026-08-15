"use client";

import type { ReplayControls } from "@/hooks/useReplay";
import { halfLabel } from "@/lib/replay/timeline";

/**
 * Transport for a recorded game.
 *
 * Everything here is counted in plate appearances rather than seconds. There is
 * no speed control and no clock: the recording advances when the ballpark has
 * finished animating, so "faster" would only mean cutting plays short, which is
 * the thing this replaced.
 */
export function Transport({ replay }: { replay: ReplayControls }) {
  const { status, error, playing, atBats, markers, atBat, frameCount, frame, ended } = replay;

  if (status === "loading") {
    return (
      <div className="rounded-full border-2 border-grass-deep/12 bg-card/95 px-4 py-2 text-xs font-bold text-bark-soft lip-float">
        Cueing up the tape…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-full border-2 border-clay/40 bg-card/95 px-4 py-2 text-xs font-bold text-clay lip-float">
        {error ?? "Could not load the recording"}
      </div>
    );
  }

  const current = atBats[atBat];
  const total = atBats.length;
  const span = Math.max(frameCount - 1, 1);
  const progress = (frame / span) * 100;

  return (
    <div className="flex w-full max-w-[min(760px,calc(100vw-1rem))] flex-col gap-2 rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-3 py-2.5 lip-float">
      {/* The bar: half-innings as ticks, scoring plays as accented dots. Click
          anywhere to jump to the nearest plate appearance. */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={atBat}
          onChange={(event) => replay.seekAtBat(Number(event.target.value))}
          aria-label="Jump to at-bat"
          className="peer relative z-20 h-4 w-full cursor-pointer appearance-none bg-transparent accent-grass"
        />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-grass-mist">
          <div className="h-full rounded-full bg-grass/60" style={{ width: `${progress}%` }} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2">
          {markers.map((marker, i) => (
            <span
              key={`${marker.kind}-${marker.frame}-${i}`}
              title={marker.label}
              style={{ left: `${(marker.frame / span) * 100}%` }}
              className={`absolute -translate-x-1/2 rounded-full ${
                marker.kind === "scoring"
                  ? "-top-[3px] h-1.5 w-1.5 bg-clay ring-1 ring-card"
                  : "-top-[5px] h-2.5 w-0.5 bg-grass-deep/45"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={replay.toggle}
          title={playing ? "Pause" : "Play"}
          className="rounded-full border-2 border-grass-deep/12 bg-card/95 px-3 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <button
          type="button"
          onClick={() => replay.stepAtBat(-1)}
          title="Previous at-bat"
          className="rounded-full border-2 border-grass-deep/12 bg-card/95 px-2.5 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep"
        >
          ◀<span className="hidden sm:inline"> At-bat</span>
        </button>
        <button
          type="button"
          onClick={() => replay.stepAtBat(1)}
          title="Next at-bat"
          className="rounded-full border-2 border-grass-deep/12 bg-card/95 px-2.5 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep"
        >
          <span className="hidden sm:inline">At-bat </span>▶
        </button>

        <button
          type="button"
          onClick={() => replay.stepHalfInning(-1)}
          title="Previous half-inning"
          className="hidden rounded-full border-2 border-grass-deep/12 bg-card/95 px-2.5 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep sm:block"
        >
          ⏮ Inning
        </button>
        <button
          type="button"
          onClick={() => replay.stepHalfInning(1)}
          title="Next half-inning"
          className="hidden rounded-full border-2 border-grass-deep/12 bg-card/95 px-2.5 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep sm:block"
        >
          Inning ⏭
        </button>

        <div className="ml-auto flex items-baseline gap-2 pr-1 text-[11px] font-semibold text-bark-soft">
          <span className="font-display text-sm font-extrabold text-grass-deep">
            {ended ? "Final" : halfLabel(current)}
          </span>
          <span className="tabular-nums">
            At-bat {Math.min(atBat + 1, total)} / {total}
          </span>
        </div>
      </div>
    </div>
  );
}
