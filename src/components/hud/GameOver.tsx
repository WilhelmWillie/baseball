"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameSnapshot, TeamSide } from "@/lib/game/types";

function LineScore({ snapshot }: { snapshot: GameSnapshot }) {
  const innings = snapshot.lineScore;
  const rows: Array<[TeamSide, string]> = [
    ["away", snapshot.teams.away.abbrev],
    ["home", snapshot.teams.home.abbrev],
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[11px]">
        <thead>
          <tr className="text-white/40">
            <th className="px-2 py-1 text-left font-normal"></th>
            {innings.map((inning) => (
              <th key={inning.num} className="w-7 px-1 py-1 text-center font-normal">
                {inning.num}
              </th>
            ))}
            <th className="w-8 px-2 py-1 text-center font-normal text-white/70">R</th>
            <th className="w-8 px-2 py-1 text-center font-normal text-white/70">H</th>
            <th className="w-8 px-2 py-1 text-center font-normal text-white/70">E</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([side, abbrev]) => (
            <tr key={side} className="border-t border-white/10">
              <td className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className="inline-block h-3 w-3 border border-black/50"
                  style={{ backgroundColor: snapshot.teams[side].palette.primary }}
                />
                <span className="tracking-widest">{abbrev}</span>
              </td>
              {innings.map((inning) => (
                <td key={inning.num} className="px-1 py-1.5 text-center text-white/70">
                  {inning[side] ?? "-"}
                </td>
              ))}
              <td className="px-2 py-1.5 text-center text-base text-white">
                {snapshot.score[side]}
              </td>
              <td className="px-2 py-1.5 text-center text-white/70">{snapshot.hits[side]}</td>
              <td className="px-2 py-1.5 text-center text-white/70">{snapshot.errors[side]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoxScore({ snapshot, side }: { snapshot: GameSnapshot; side: TeamSide }) {
  const team = snapshot.teams[side];
  const box = snapshot.boxscore[side];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-4 w-4 border border-black/50"
          style={{ backgroundColor: team.palette.primary }}
        />
        <span className="tracking-widest text-white">{team.name.toUpperCase()}</span>
        <span className="text-white/40">{snapshot.score[side]}</span>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-white/35">
            <th className="py-1 text-left font-normal">BATTING</th>
            {["AB", "R", "H", "RBI", "BB", "K", "AVG"].map((h) => (
              <th key={h} className="w-9 py-1 text-right font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {box.batters.length === 0 && (
            <tr>
              <td colSpan={8} className="py-2 text-white/35">
                No batting lines published.
              </td>
            </tr>
          )}
          {box.batters.map((line) => (
            <tr key={line.id} className="border-t border-white/5">
              <td className="max-w-[160px] truncate py-1 pr-2 text-white/80">
                {line.name}
                <span className="ml-1.5 text-white/30">{line.position}</span>
              </td>
              <td className="py-1 text-right text-white/70">{line.ab}</td>
              <td className="py-1 text-right text-white/70">{line.r}</td>
              <td className="py-1 text-right text-white">{line.h}</td>
              <td className="py-1 text-right text-white/70">{line.rbi}</td>
              <td className="py-1 text-right text-white/70">{line.bb}</td>
              <td className="py-1 text-right text-white/70">{line.k}</td>
              <td className="py-1 text-right text-white/45">{line.avg}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-white/35">
            <th className="py-1 text-left font-normal">PITCHING</th>
            {["IP", "H", "R", "ER", "BB", "K", "ERA"].map((h) => (
              <th key={h} className="w-9 py-1 text-right font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {box.pitchers.map((line) => (
            <tr key={line.id} className="border-t border-white/5">
              <td className="max-w-[160px] truncate py-1 pr-2 text-white/80">
                {line.name}
                {line.decision && (
                  <span className="ml-1.5 text-amber-300">({line.decision})</span>
                )}
              </td>
              <td className="py-1 text-right text-white/70">{line.ip}</td>
              <td className="py-1 text-right text-white/70">{line.h}</td>
              <td className="py-1 text-right text-white/70">{line.r}</td>
              <td className="py-1 text-right text-white/70">{line.er}</td>
              <td className="py-1 text-right text-white/70">{line.bb}</td>
              <td className="py-1 text-right text-white">{line.k}</td>
              <td className="py-1 text-right text-white/45">{line.era}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Final-score card, shown over the park once the game goes final. */
export function GameOver({ snapshot }: { snapshot: GameSnapshot }) {
  const [dismissed, setDismissed] = useState(false);
  const [tab, setTab] = useState<TeamSide>("away");

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="pointer-events-auto border-2 border-amber-300 bg-slate-950/90 px-3 py-1.5 font-mono text-[11px] tracking-widest text-amber-200"
      >
        FINAL — SHOW BOX SCORE
      </button>
    );
  }

  const homeWon = snapshot.score.home > snapshot.score.away;
  const tied = snapshot.score.home === snapshot.score.away;
  const winner = homeWon ? snapshot.teams.home : snapshot.teams.away;

  return (
    <div className="pointer-events-auto flex h-full w-full items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto overscroll-contain border-2 border-amber-300/70 bg-slate-950/95 font-mono shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-[10px] tracking-[0.35em] text-amber-300">FINAL</div>
              <div className="mt-1 text-sm text-white/50">
                {snapshot.venue} · {snapshot.lineScore.length} innings
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="border border-white/20 px-2 py-1 text-[10px] tracking-widest text-white/50 hover:border-white/50 hover:text-white"
            >
              CLOSE
            </button>
          </div>

          <div className="mt-4 flex items-center gap-6">
            {(["away", "home"] as const).map((side) => (
              <div key={side} className="flex items-center gap-3">
                <span
                  className="inline-block h-8 w-8 border-2 border-black/50"
                  style={{ backgroundColor: snapshot.teams[side].palette.primary }}
                />
                <div>
                  <div className="text-xs tracking-widest text-white/70">
                    {snapshot.teams[side].abbrev}
                  </div>
                  <div
                    className={`text-3xl leading-none ${
                      (side === "home") === homeWon && !tied ? "text-white" : "text-white/45"
                    }`}
                  >
                    {snapshot.score[side]}
                  </div>
                </div>
                {side === "away" && <span className="px-2 text-white/25">@</span>}
              </div>
            ))}
          </div>

          <div className="mt-3 text-[11px] tracking-wide text-white/60">
            {tied ? "Game ended level." : `${winner.name} win.`}
          </div>
        </div>

        <div className="border-b border-white/10 px-6 py-4">
          <LineScore snapshot={snapshot} />
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 flex gap-2">
            {(["away", "home"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setTab(side)}
                className={`border-2 px-3 py-1 text-[10px] tracking-widest transition-colors ${
                  tab === side
                    ? "border-amber-300 bg-amber-300 text-slate-950"
                    : "border-white/20 text-white/60 hover:border-white/50"
                }`}
              >
                {snapshot.teams[side].abbrev} BOX
              </button>
            ))}
          </div>
          <BoxScore snapshot={snapshot} side={tab} />
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          <Link
            href="/"
            className="inline-block border-2 border-white/25 px-4 py-2 text-[11px] tracking-widest text-white/75 hover:border-amber-300 hover:text-amber-200"
          >
            ← BACK TO GAMES
          </Link>
        </div>
      </div>
    </div>
  );
}
