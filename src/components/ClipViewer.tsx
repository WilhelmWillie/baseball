"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useReplay } from "@/hooks/useReplay";
import { useGameStore } from "@/store/gameStore";
import { sfx } from "@/lib/audio/sfx";
import { CLIP_BEATS } from "@/lib/replay/timeline";
import { hitLine, type AtBatCard } from "@/lib/share/atbat";
import { Ball } from "@/components/brand/Ball";
import { BackLink } from "@/components/BackLink";
import { ShareMenu } from "@/components/ShareMenu";
import { Callout } from "./hud/Callout";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-grass-mist text-sm font-semibold text-grass-deep">
      <Ball className="h-10 w-10 animate-[bob_1.6s_ease-in-out_infinite]" />
      Chalking the lines…
    </div>
  ),
});

/**
 * One play, on its own page.
 *
 * A sibling of `Viewer` rather than a mode of it. The two share a scene and a
 * store but almost nothing above them: there is no scoreboard to expand, no
 * game log, no camera picker and no transport, because a clip is a single play
 * someone followed a link to watch. Threading all of that through `Viewer` as a
 * variant would cost more than the header this duplicates.
 *
 * The play itself is an ordinary recording - `useReplay` drives it exactly as
 * it drives a whole game, and it just runs out of frames when the play ends.
 */
export function ClipViewer({
  gamePk,
  atBatIndex,
  card,
}: {
  gamePk: string;
  atBatIndex: number;
  /** What the play is, resolved on the server so the header never flickers. */
  card: AtBatCard;
}) {
  const replay = useReplay(gamePk, true, {
    source: { kind: "clip", atBatIndex },
    beats: CLIP_BEATS,
  });
  const snapshot = useGameStore((s) => s.snapshot);
  const [soundOn, setSoundOn] = useState(true);

  // Audio cannot start until the page has been interacted with, so the first
  // gesture anywhere wakes the context.
  useEffect(() => {
    const wake = () => sfx.resume();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // The park itself, under everything else. It is the one sound here that runs
  // continuously, so it is also the one that has to stop when the tab goes
  // away - a murmur from a page nobody is looking at is just a noise coming
  // out of a laptop. `setAmbience` copes with being called before the audio
  // context is unlocked and starts the bed once it is.
  useEffect(() => {
    const apply = () => sfx.setAmbience(soundOn && !document.hidden);
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      sfx.setAmbience(false);
    };
  }, [soundOn]);

  /**
   * Where "watch the whole game" goes.
   *
   * A game that has finished can be picked up at this very plate appearance,
   * because a finished game is rebuilt from its feed on demand; one still being
   * played can only be opened at its live edge. This used to need the
   * recordings index - back when the handful of published games were the only
   * ones that could be resumed - and now the game's own status answers it,
   * which the server already resolved for the card.
   */
  const fullGame =
    card.game.state === "final"
      ? `/watch/${gamePk}/at/${atBatIndex}`
      : `/watch/${gamePk}`;

  const statcast = hitLine(card.hit);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-grass-mist">
      <Scene />

      {/* Who, where in the game, and the score it left behind. Everything here
          comes from the server, so it reads correctly before the park has
          finished loading. */}
      <div className="absolute inset-x-2 top-2 z-10 flex flex-col gap-1.5 sm:inset-x-auto sm:left-4 sm:top-4">
        <div className="rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-3.5 py-2.5 lip-float">
          <div className="flex items-center gap-2 text-[11px] font-bold text-bark-soft">
            <span className="font-display text-xs text-grass-deep">{card.half}</span>
            <span className="tabular-nums">
              {card.game.away.abbrev} {card.scoreAfter.away} · {card.game.home.abbrev}{" "}
              {card.scoreAfter.home}
            </span>
          </div>
          <div className="font-display text-lg leading-tight text-bark">{card.batter}</div>
          <div className="text-[11px] font-semibold text-bark-soft">
            {card.event}
            {statcast ? ` · ${statcast}` : ""}
          </div>
        </div>

        {replay.status === "error" && (
          <div className="rounded-2xl border-2 border-clay/40 bg-card/95 px-3.5 py-2.5 text-xs font-bold text-clay lip-float">
            {replay.error ?? "Could not load this play"}
          </div>
        )}
        {replay.status === "loading" && !snapshot && (
          <div className="rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-3.5 py-2.5 text-xs font-semibold text-bark-soft lip-float">
            Cueing up the play…
          </div>
        )}
      </div>

      {/* Controls, kept to the two that matter on a page you landed on from a
          link: get out of the clip, and turn the sound off. Above the ending
          card rather than under it - a way back that disappears the moment the
          play does is not one. */}
      <div className="absolute inset-x-2 bottom-3 z-40 flex flex-row items-center justify-center gap-1.5 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:justify-end">
        <div className="flex items-center gap-1 rounded-full border border-grass-deep/10 bg-card/95 p-1 backdrop-blur-[2px] lip-float">
          {/* Wherever this clip was opened from - the game log it was clicked
              in, most of the time, and the games otherwise. */}
          <BackLink className="rounded-full px-3 py-2 text-xs font-bold text-bark transition-colors hover:bg-grass-mist hover:text-grass-deep sm:py-1.5" />
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              sfx.setMuted(!next);
              if (next) sfx.resume();
            }}
            title="Bat, mitt, organ and crowd audio"
            className={`rounded-full px-3 py-2 text-xs font-bold transition-colors sm:py-1.5 ${
              soundOn ? "bg-grass text-card" : "text-bark hover:bg-grass-mist"
            }`}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          {/* Left to follow the controls: this strip is along the bottom on a
              phone and up in the top corner from `sm`. */}
          <ShareMenu
            path={`/clip/${gamePk}/${atBatIndex}`}
            label="↗ Share"
            className="rounded-full px-3 py-2 text-xs font-bold text-bark transition-colors hover:bg-grass-mist hover:text-grass-deep sm:py-1.5"
          />
        </div>
      </div>

      <div className="absolute inset-x-2 bottom-16 z-10 flex justify-center sm:inset-x-0 sm:bottom-4">
        <Callout inline />
      </div>

      {/* The play is over - `settled`, not `ended`, because the frame carrying
          a home run is handed over as the pitch is released and the trot and
          the celebration all come after it. Covering that with a card would
          hide the thing the link was sent for. Every ending is a share prompt:
          that is what this page is for. */}
      {replay.settled && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bark/25 p-4 backdrop-blur-[2px]">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-3xl border-2 border-grass-deep/12 bg-card px-5 py-5 lip-float">
            <div>
              <div className="font-display text-xs text-grass-deep">
                {card.half} · {card.game.away.abbrev} {card.scoreAfter.away} –{" "}
                {card.scoreAfter.home} {card.game.home.abbrev}
              </div>
              <div className="mt-1 font-display text-xl leading-tight text-bark">
                {card.event}
                {statcast ? <span className="text-bark-soft"> · {statcast}</span> : null}
              </div>
              {card.description && (
                <p className="mt-1.5 text-xs leading-snug text-bark-soft">{card.description}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  replay.seekAtBat(0);
                  replay.play();
                }}
                className="rounded-full bg-grass px-4 py-2 text-xs font-bold text-card transition-colors hover:bg-grass-deep"
              >
                ↺ Watch again
              </button>
              <ShareMenu
                path={`/clip/${gamePk}/${atBatIndex}`}
                label="↗ Share this play"
                // Upward, so it lands on the description rather than on the
                // "watch the full game" link below - a menu over static text
                // costs nothing, a menu over a link eats the click that opens it.
                placement="up"
                className="rounded-full border-2 border-grass/40 px-4 py-2 text-xs font-bold text-grass-deep transition-colors hover:bg-grass hover:text-card"
              />
            </div>

            <Link
              href={fullGame}
              className="text-xs font-bold text-bark-soft underline-offset-2 hover:text-grass-deep hover:underline"
            >
              Watch the full game →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
