"use client";

import { REPLAY_SPEEDS, type ReplayControls } from "@/hooks/useReplay";
import { formatClock } from "@/lib/replay/timeline";

/**
 * Transport for a recorded game: play, scrub, speed.
 *
 * The scrub here is a plain range over play-time. The labelled bar - half-inning
 * ticks and scoring plays off `manifest.markers` - belongs to the timeline work
 * and lands on top of this.
 */

/** Skip a chunk of play-time, roughly a couple of batters. */
const SKIP_MS = 30_000;

function Button({
  onClick,
  title,
  wide,
  children,
}: {
  onClick: () => void;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full border-2 border-grass-deep/12 bg-card/95 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep ${
        wide ? "px-3" : "px-2.5"
      }`}
    >
      {children}
    </button>
  );
}

export function Transport({ replay }: { replay: ReplayControls }) {
  const { status, error, playing, playT, durationMs, speed, trueTiming } = replay;

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

  return (
    <div className="flex w-full max-w-[min(680px,calc(100vw-1rem))] flex-col gap-1.5 rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-3 py-2 lip-float">
      <input
        type="range"
        min={0}
        max={Math.max(durationMs, 1)}
        value={Math.min(playT, durationMs)}
        onChange={(event) => replay.seek(Number(event.target.value))}
        aria-label="Seek"
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-grass-mist accent-grass"
      />
      <div className="flex items-center gap-1.5">
        <Button onClick={replay.toggle} title={playing ? "Pause" : "Play"} wide>
          {playing ? "❚❚" : "▶"}
        </Button>
        <Button onClick={() => replay.seek(playT - SKIP_MS)} title="Back 30 seconds">
          ⏪
        </Button>
        <Button onClick={() => replay.seek(playT + SKIP_MS)} title="Forward 30 seconds">
          ⏩
        </Button>

        <span className="px-1 font-mono text-[11px] font-semibold tabular-nums text-bark-soft">
          {formatClock(playT)} / {formatClock(durationMs)}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            onClick={() => {
              const next = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(speed as 1) + 1) % REPLAY_SPEEDS.length];
              replay.setSpeed(next);
            }}
            title="Playback speed"
          >
            {speed}×
          </Button>
          <button
            type="button"
            onClick={() => replay.setTrueTiming(!trueTiming)}
            title={
              trueTiming
                ? "Playing at the game's real pace"
                : "Dead air between pitches is shortened"
            }
            className={`rounded-full border-2 px-2.5 py-1.5 text-xs font-bold transition-colors ${
              trueTiming
                ? "border-grass bg-grass text-card"
                : "border-grass-deep/12 bg-card/95 text-bark hover:border-grass/60 hover:text-grass-deep"
            }`}
          >
            Real time
          </button>
        </div>
      </div>
    </div>
  );
}
