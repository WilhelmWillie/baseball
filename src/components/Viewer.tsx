"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useReplay } from "@/hooks/useReplay";
import { useGameStore } from "@/store/gameStore";
import { CAMERA_VIEWS, storedCameraView } from "@/lib/anim/views";
import { sfx } from "@/lib/audio/sfx";
import { Ball } from "@/components/brand/Ball";
import { Scorebug, type ScoreMode } from "./hud/Scorebug";
import { Callout } from "./hud/Callout";
import { History } from "./hud/History";
import { GameOver } from "./hud/GameOver";
import { Intermission } from "./hud/Intermission";
import { Transport } from "./hud/Transport";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-grass-mist text-sm font-semibold text-grass-deep">
      <Ball className="h-10 w-10 animate-[bob_1.6s_ease-in-out_infinite]" />
      Chalking the lines…
    </div>
  ),
});

function ControlButton({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full border-2 px-3 py-2 text-xs font-bold transition-colors sm:py-1.5 ${
        active
          ? "border-grass bg-grass text-card"
          : "border-grass-deep/12 bg-card/95 text-bark hover:border-grass/60 hover:text-grass-deep"
      }`}
    >
      {children}
    </button>
  );
}

/** Where the feed comes from: the API, the simulator, or a recording on disk. */
export type ViewerMode = "live" | "demo" | "replay";

export function Viewer({
  gamePk,
  mode = "live",
  demoOffset = 0,
  demoQuery = "",
  startSeconds = 0,
}: {
  gamePk: string;
  mode?: ViewerMode;
  /** Start the simulated game this many seconds in. */
  demoOffset?: number;
  /** Extra query passed through to the simulated feed (time of day, weather). */
  demoQuery?: string;
  /** Start a recording this many seconds into its play-time. */
  startSeconds?: number;
}) {
  const isDemo = mode === "demo";
  const isReplay = mode === "replay";

  // Both drivers are always called - a hook cannot be conditional - and the one
  // that is not in charge sits inert.
  useLiveFeed(gamePk, isDemo, demoOffset, demoQuery, !isReplay);
  const replay = useReplay(gamePk, isReplay, startSeconds);

  const snapshot = useGameStore((s) => s.snapshot);
  const history = useGameStore((s) => s.history);
  const connection = useGameStore((s) => s.connection);
  const error = useGameStore((s) => s.error);

  const cameraView = useGameStore((s) => s.cameraView);
  const setCameraView = useGameStore((s) => s.setCameraView);

  const [soundOn, setSoundOn] = useState(true);
  const [showRoster, setShowRoster] = useState(false);
  const [showCameras, setShowCameras] = useState(false);

  // How much of the scoreboard shows. A portrait phone starts minimized - the
  // screen is better spent on the game than on the panel - but the moment the
  // viewer chooses for themselves, that choice sticks and orientation stops
  // overriding it. `lastShown` is where the "show" chip brings it back to.
  const [scoreMode, setScoreMode] = useState<ScoreMode>("full");
  const scoreTouched = useRef(false);
  const lastShown = useRef<"full" | "mini">("full");

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const apply = () => {
      if (scoreTouched.current) return;
      const next = mq.matches ? "mini" : "full";
      lastShown.current = next;
      setScoreMode(next);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const chooseScoreMode = (mode: ScoreMode) => {
    scoreTouched.current = true;
    if (mode !== "hidden") lastShown.current = mode;
    setScoreMode(mode);
  };

  const activeView = CAMERA_VIEWS.find((v) => v.id === cameraView) ?? CAMERA_VIEWS[0];

  // Restored after mount rather than read while the store is created: the
  // server has no localStorage, and the two renders have to agree.
  useEffect(() => {
    const saved = storedCameraView();
    if (saved) setCameraView(saved);
  }, [setCameraView]);

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

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-grass-mist">
      <Scene />

      {/* Scoreboard and play log: a full-width band across the top of a phone,
          a floating panel once there is room beside it. */}
      <div className="absolute inset-x-2 top-2 z-10 flex flex-col gap-1.5 sm:inset-x-auto sm:left-4 sm:top-4 sm:gap-2">
        {snapshot ? (
          scoreMode === "hidden" ? (
            <button
              type="button"
              onClick={() => chooseScoreMode(lastShown.current)}
              title="Show scoreboard"
              className="pointer-events-auto flex items-center gap-1.5 self-start rounded-full border-2 border-grass-deep/12 bg-card/95 px-3 py-1.5 text-[11px] font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep lip-float"
            >
              <span className="h-2 w-2 rounded-full bg-grass" />
              Scoreboard
            </button>
          ) : (
            <>
              <Scorebug snapshot={snapshot} mode={scoreMode} onMode={chooseScoreMode} />
              {scoreMode === "full" && <History history={history} snapshot={snapshot} />}
            </>
          )
        ) : (
          <div className="rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-4 py-3 text-sm font-semibold text-bark-soft lip-float">
            {isReplay
              ? replay.status === "error"
                ? "Can't read the recording"
                : "Cueing up the tape…"
              : connection === "error"
                ? "Can't reach the feed"
                : "Tuning in…"}
          </div>
        )}
      </div>

      {/* Controls: along the bottom on a phone, where a thumb reaches; stacked
          in the top corner on anything larger. */}
      <div className="absolute inset-x-2 bottom-3 z-20 flex flex-row items-center justify-center gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:flex-col sm:items-end sm:gap-2">
        <div className="flex gap-1.5 sm:gap-2">
          <Link
            href="/"
            className="rounded-full border-2 border-grass-deep/12 bg-card/95 px-3 py-2 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep sm:py-1.5"
          >
            ←<span className="hidden sm:inline"> Games</span>
          </Link>
          <div className="relative">
            <ControlButton
              onClick={() => setShowCameras(!showCameras)}
              active={showCameras}
              title="Change camera"
            >
              🎥<span className="hidden sm:inline"> {activeView.label}</span>
            </ControlButton>
            {/* The picker opens above the button on a phone, where the
                controls sit along the bottom; below it once they move to the
                top corner. */}
            {showCameras && (
              <div className="absolute bottom-full left-1/2 z-30 mb-2 w-48 -translate-x-1/2 overflow-hidden rounded-2xl border-2 border-grass-deep/12 bg-card/97 p-1 lip-float sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mb-0 sm:mt-2 sm:translate-x-0">
                {CAMERA_VIEWS.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => {
                      setCameraView(view.id);
                      setShowCameras(false);
                    }}
                    className={`flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors ${
                      view.id === cameraView
                        ? "bg-grass text-card"
                        : "text-bark hover:bg-grass-mist"
                    }`}
                  >
                    <span className="text-xs font-bold">{view.label}</span>
                    <span
                      className={`text-[10px] font-semibold ${
                        view.id === cameraView ? "text-card/80" : "text-bark-soft"
                      }`}
                    >
                      {view.hint}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          <ControlButton
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              sfx.setMuted(!next);
              if (next) sfx.resume();
            }}
            active={soundOn}
            title="Bat, mitt and crowd audio"
          >
            {soundOn ? "🔊" : "🔇"}
            <span className="hidden sm:inline">{soundOn ? " Sound" : " Muted"}</span>
          </ControlButton>
          <ControlButton onClick={() => setShowRoster(!showRoster)} active={showRoster}>
            Lineup
          </ControlButton>
        </div>
        <div className="hidden items-center gap-2 rounded-full bg-card/85 px-2.5 py-1 text-[11px] font-semibold text-bark-soft sm:flex">
          <span
            className={`h-2 w-2 rounded-full ${
              isReplay
                ? "bg-clay-soft"
                : connection === "live"
                  ? "animate-[blink_1.4s_ease-in-out_infinite] bg-grass"
                  : connection === "error"
                    ? "bg-clay"
                    : "bg-clay-soft"
            }`}
          />
          {isReplay
            ? "Recording"
            : isDemo
              ? "Simulated game"
              : connection === "live"
                ? "Live"
                : connection}
        </div>
      </div>

      {/* Transport for a recording. Sits above the thumb controls on a phone;
          on anything larger those move to the top corner and the bottom is
          free. */}
      {isReplay && (
        <div className="absolute inset-x-2 bottom-16 z-20 flex justify-center sm:inset-x-0 sm:bottom-4">
          <Transport replay={replay} />
        </div>
      )}

      {/* Bottom: full-width play banner. It positions itself along the bottom
          edge - above the thumb controls on a phone, flush on a wider screen -
          so it has to be told when the replay transport is parked under it. */}
      <Callout lifted={isReplay} />

      {/* Between-innings credits card, shown while the field is empty. */}
      <Intermission />

      {/* Bottom-left: lineup */}
      {showRoster && snapshot && (
        <div
          className={`absolute left-2 z-10 max-h-[38dvh] w-[min(300px,calc(100vw-1rem))] overflow-auto rounded-2xl border-2 border-grass-deep/12 bg-card/97 p-3.5 text-xs text-bark lip-float sm:left-4 sm:max-h-[46vh] ${
            isReplay ? "bottom-36 sm:bottom-24" : "bottom-16 sm:bottom-4"
          }`}
        >
          <div className="mb-2 font-display text-sm font-extrabold text-grass-deep">
            {snapshot.teams[snapshot.fieldingSide].abbrev} in the field
          </div>
          {(
            [
              ["P", snapshot.defense.pitcher],
              ["C", snapshot.defense.catcher],
              ["1B", snapshot.defense.first],
              ["2B", snapshot.defense.second],
              ["3B", snapshot.defense.third],
              ["SS", snapshot.defense.shortstop],
              ["LF", snapshot.defense.left],
              ["CF", snapshot.defense.center],
              ["RF", snapshot.defense.right],
            ] as const
          ).map(([label, player]) => (
            <div key={label} className="flex justify-between gap-2 py-0.5">
              <span className="w-8 font-bold text-bark-soft">{label}</span>
              <span className="flex-1 truncate">{player?.name ?? "—"}</span>
              <span className="text-bark-soft">{player?.number ?? ""}</span>
            </div>
          ))}
          <div className="mb-1 mt-3 font-display text-sm font-extrabold text-grass-deep">
            On the bench
          </div>
          {snapshot.bench[snapshot.fieldingSide].length === 0 && (
            <div className="text-bark-soft">—</div>
          )}
          {snapshot.bench[snapshot.fieldingSide].map((player) => (
            <div key={player.id} className="flex justify-between gap-2 py-0.5">
              <span className="flex-1 truncate">{player.name}</span>
              <span className="text-bark-soft">{player.position ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom-right: status */}
      <div className="absolute bottom-2 right-2 z-10 hidden max-w-[46vw] rounded-full bg-card/80 px-3 py-1 text-right text-[11px] font-semibold text-bark-soft sm:bottom-4 sm:right-4 sm:block">
        {snapshot ? `${snapshot.venue} · ${snapshot.status.detailed}` : ""}
      </div>

      {snapshot?.status.isFinal && (
        <div className="absolute inset-0 z-30 flex items-start justify-end p-2 sm:p-4">
          <GameOver snapshot={snapshot} />
        </div>
      )}

      {error && connection === "error" && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-clay px-4 py-2 text-center text-xs font-semibold text-card">
          {error}
        </div>
      )}
    </div>
  );
}
