"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { WebGLRenderer } from "three";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useGameStore } from "@/store/gameStore";
import { captureSnapshot, shareOrDownload } from "@/lib/snapshot";
import { sfx } from "@/lib/audio/sfx";
import { Scorebug } from "./hud/Scorebug";
import { Callout } from "./hud/Callout";
import { History } from "./hud/History";
import { GameOver } from "./hud/GameOver";

const Scene = dynamic(() => import("./scene/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-900 font-mono text-sm text-white/60">
      BUILDING BALLPARK…
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
      className={`border-2 px-3 py-1.5 font-mono text-[11px] tracking-widest transition-colors ${
        active
          ? "border-amber-300 bg-amber-300 text-slate-950"
          : "border-black/60 bg-slate-950/80 text-white/80 hover:border-white/60 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function Viewer({
  gamePk,
  isDemo,
  demoOffset = 0,
  demoQuery = "",
}: {
  gamePk: string;
  isDemo: boolean;
  /** Start the simulated game this many seconds in. */
  demoOffset?: number;
  /** Extra query passed through to the simulated feed (time of day, weather). */
  demoQuery?: string;
}) {
  useLiveFeed(gamePk, isDemo, demoOffset, demoQuery);

  const snapshot = useGameStore((s) => s.snapshot);
  const history = useGameStore((s) => s.history);
  const connection = useGameStore((s) => s.connection);
  const error = useGameStore((s) => s.error);

  const [soundOn, setSoundOn] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const rendererRef = useRef<WebGLRenderer | null>(null);

  const onRenderer = useCallback((gl: WebGLRenderer) => {
    rendererRef.current = gl;
  }, []);

  const onSnapshot = useCallback(async () => {
    const gl = rendererRef.current;
    if (!gl || !snapshot) return;
    try {
      const { blob, filename } = await captureSnapshot(gl, snapshot);
      const how = await shareOrDownload(blob, filename);
      setFlash(
        how === "shared"
          ? "SNAPSHOT SHARED"
          : how === "copied"
            ? "COPIED TO CLIPBOARD + SAVED"
            : "SNAPSHOT SAVED",
      );
    } catch (err) {
      setFlash(err instanceof Error ? err.message.toUpperCase() : "SNAPSHOT FAILED");
    }
  }, [snapshot]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(timer);
  }, [flash]);

  // Audio cannot start until the page has been interacted with, so the first
  // gesture anywhere wakes the context and brings up the crowd.
  useEffect(() => {
    const wake = () => {
      sfx.resume();
      sfx.startAmbience();
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      sfx.stopAmbience();
    };
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-slate-900">
      <Scene onRenderer={onRenderer} />

      {/* Top-left: scoreboard and the play log */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        {snapshot ? (
          <>
            <Scorebug snapshot={snapshot} />
            <History history={history} snapshot={snapshot} />
          </>
        ) : (
          <div className="border-2 border-black/60 bg-slate-950/80 px-4 py-3 font-mono text-xs text-white/70">
            {connection === "error" ? "FEED UNAVAILABLE" : "CONNECTING TO FEED…"}
          </div>
        )}
      </div>

      {/* Top-right: controls */}
      <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Link
            href="/"
            className="border-2 border-black/60 bg-slate-950/80 px-3 py-1.5 font-mono text-[11px] tracking-widest text-white/80 hover:border-white/60 hover:text-white"
          >
            ← GAMES
          </Link>
          <ControlButton onClick={onSnapshot} title="Save a shareable image">
            📸 SNAPSHOT
          </ControlButton>
        </div>
        <div className="flex gap-2">
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
            {soundOn ? "🔊 SOUND" : "🔇 MUTED"}
          </ControlButton>
          <ControlButton onClick={() => setShowRoster(!showRoster)} active={showRoster}>
            LINEUP
          </ControlButton>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-white/50">
          <span
            className={`h-2 w-2 ${
              connection === "live"
                ? "animate-pulse bg-emerald-400"
                : connection === "error"
                  ? "bg-red-500"
                  : "bg-amber-300"
            }`}
          />
          {isDemo ? "DEMO FEED" : connection.toUpperCase()}
        </div>
      </div>

      {/* Center: play callouts */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-10 -translate-x-1/2">
        <Callout />
      </div>

      {/* Bottom-left: lineup */}
      {showRoster && snapshot && (
        <div className="absolute bottom-4 left-4 z-10 max-h-[46vh] w-[300px] overflow-auto border-2 border-black/60 bg-slate-950/85 p-3 font-mono text-[11px] text-white/80">
          <div className="mb-2 tracking-widest text-amber-300">
            {snapshot.teams[snapshot.fieldingSide].abbrev} DEFENSE
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
              <span className="w-8 text-white/40">{label}</span>
              <span className="flex-1 truncate">{player?.name ?? "—"}</span>
              <span className="text-white/35">{player?.number ?? ""}</span>
            </div>
          ))}
          <div className="mt-3 mb-1 tracking-widest text-amber-300">BENCH</div>
          {snapshot.bench[snapshot.fieldingSide].length === 0 && (
            <div className="text-white/40">—</div>
          )}
          {snapshot.bench[snapshot.fieldingSide].map((player) => (
            <div key={player.id} className="flex justify-between gap-2 py-0.5">
              <span className="flex-1 truncate">{player.name}</span>
              <span className="text-white/35">{player.position ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom-right: status */}
      <div className="absolute bottom-4 right-4 z-10 max-w-[46vw] text-right font-mono text-[10px] leading-relaxed tracking-widest text-white/45">
        {snapshot ? `${snapshot.venue.toUpperCase()} · ${snapshot.status.detailed.toUpperCase()}` : ""}
      </div>

      {snapshot?.status.isFinal && (
        <div className="absolute inset-0 z-30 flex items-start justify-end p-4">
          <GameOver snapshot={snapshot} />
        </div>
      )}

      {flash && (
        <div className="absolute bottom-20 left-1/2 z-20 -translate-x-1/2 border-2 border-amber-300 bg-slate-950/90 px-4 py-2 font-mono text-[11px] tracking-widest text-amber-200">
          {flash}
        </div>
      )}

      {error && connection === "error" && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-red-950/90 px-4 py-2 text-center font-mono text-[11px] tracking-wide text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
