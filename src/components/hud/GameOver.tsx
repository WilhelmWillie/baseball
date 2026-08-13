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
      {/* Left-hugging: the inning columns read as a line score, not as a row
          of numbers stranded at the far edge of a wide card. */}
      <table className="min-w-max border-collapse text-[11px]">
        <thead>
          <tr className="text-bark-soft">
            <th className="px-2 py-1 text-left font-normal"></th>
            {innings.map((inning) => (
              <th key={inning.num} className="w-7 px-1 py-1 text-center font-normal">
                {inning.num}
              </th>
            ))}
            {["R", "H", "E"].map((h) => (
              <th key={h} className="w-8 px-2 py-1 text-center font-bold text-bark">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([side, abbrev]) => (
            <tr key={side} className="border-t-2 border-dashed border-grass-deep/12">
              <td className="flex items-center gap-2 px-2 py-1.5">
                <span
                  className="inline-block h-4 w-4 rounded-full ring-2 ring-card"
                  style={{ backgroundColor: snapshot.teams[side].palette.primary }}
                />
                <span className="font-display font-extrabold text-bark">{abbrev}</span>
              </td>
              {innings.map((inning) => (
                <td key={inning.num} className="px-1 py-1.5 text-center text-bark-soft">
                  {inning[side] ?? "-"}
                </td>
              ))}
              <td className="px-2 py-1.5 text-center font-display text-base font-extrabold text-grass-deep">
                {snapshot.score[side]}
              </td>
              <td className="px-2 py-1.5 text-center text-bark">{snapshot.hits[side]}</td>
              <td className="px-2 py-1.5 text-center text-bark">{snapshot.errors[side]}</td>
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
          className="inline-block h-5 w-5 rounded-full ring-2 ring-card"
          style={{ backgroundColor: team.palette.primary }}
        />
        <span className="font-display text-base font-extrabold text-bark">{team.name}</span>
        <span className="font-display text-base font-extrabold text-grass-deep">
          {snapshot.score[side]}
        </span>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-bark-soft">
            <th className="py-1 text-left font-bold text-grass-deep">Batting</th>
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
              <td colSpan={8} className="py-2 text-bark-soft">
                No batting lines published.
              </td>
            </tr>
          )}
          {box.batters.map((line) => (
            <tr key={line.id} className="border-t border-bark/8">
              <td className="max-w-[160px] truncate py-1 pr-2 text-bark">
                {line.name}
                <span className="ml-1.5 text-bark-soft">{line.position}</span>
              </td>
              <td className="py-1 text-right text-bark-soft">{line.ab}</td>
              <td className="py-1 text-right text-bark-soft">{line.r}</td>
              <td className="py-1 text-right font-bold text-bark">{line.h}</td>
              <td className="py-1 text-right text-bark-soft">{line.rbi}</td>
              <td className="py-1 text-right text-bark-soft">{line.bb}</td>
              <td className="py-1 text-right text-bark-soft">{line.k}</td>
              <td className="py-1 text-right text-bark-soft">{line.avg}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-bark-soft">
            <th className="py-1 text-left font-bold text-grass-deep">Pitching</th>
            {["IP", "H", "R", "ER", "BB", "K", "ERA"].map((h) => (
              <th key={h} className="w-9 py-1 text-right font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {box.pitchers.map((line) => (
            <tr key={line.id} className="border-t border-bark/8">
              <td className="max-w-[160px] truncate py-1 pr-2 text-bark">
                {line.name}
                {line.decision && (
                  <span className="ml-1.5 font-bold text-clay">({line.decision})</span>
                )}
              </td>
              <td className="py-1 text-right text-bark-soft">{line.ip}</td>
              <td className="py-1 text-right text-bark-soft">{line.h}</td>
              <td className="py-1 text-right text-bark-soft">{line.r}</td>
              <td className="py-1 text-right text-bark-soft">{line.er}</td>
              <td className="py-1 text-right text-bark-soft">{line.bb}</td>
              <td className="py-1 text-right font-bold text-bark">{line.k}</td>
              <td className="py-1 text-right text-bark-soft">{line.era}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Final-score card, shown over the park once the game goes final. */
export function GameOver({ snapshot }: { snapshot: GameSnapshot }) {
  const [tab, setTab] = useState<TeamSide>("away");

  const homeWon = snapshot.score.home > snapshot.score.away;
  const tied = snapshot.score.home === snapshot.score.away;
  const winner = homeWon ? snapshot.teams.home : snapshot.teams.away;

  return (
    <div className="pointer-events-auto flex h-full w-full items-center justify-center bg-grass-deep/45 p-4 backdrop-blur-sm">
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-3xl border-2 border-grass-deep/15 bg-card lip">
        <div className="border-b-2 border-dashed border-grass-deep/15 px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="font-display text-2xl font-extrabold text-grass-deep">
                That&apos;s the ballgame
              </div>
              <div className="mt-1 text-sm text-bark-soft">
                {snapshot.venue} · {snapshot.lineScore.length} innings
              </div>
            </div>
            <Link
              href="/"
              className="rounded-full border-2 border-grass-deep/15 px-3 py-1 text-xs font-bold text-bark-soft transition-colors hover:border-grass/60 hover:text-grass-deep"
            >
              Close
            </Link>
          </div>

          <div className="mt-4 flex items-center gap-6">
            {(["away", "home"] as const).map((side) => (
              <div key={side} className="flex items-center gap-3">
                <span
                  className="inline-block h-9 w-9 rounded-full ring-2 ring-card"
                  style={{ backgroundColor: snapshot.teams[side].palette.primary }}
                />
                <div>
                  <div className="font-display text-sm font-extrabold text-bark-soft">
                    {snapshot.teams[side].abbrev}
                  </div>
                  <div
                    className={`font-display text-4xl font-extrabold leading-none ${
                      (side === "home") === homeWon && !tied ? "text-grass-deep" : "text-bark-soft"
                    }`}
                  >
                    {snapshot.score[side]}
                  </div>
                </div>
                {side === "away" && <span className="px-2 text-bark-soft/60">@</span>}
              </div>
            ))}
          </div>

          <div className="mt-3 text-sm font-semibold text-bark">
            {tied ? "Game ended level." : `${winner.name} win.`}
          </div>
        </div>

        <div className="border-b-2 border-dashed border-grass-deep/15 px-6 py-4">
          <LineScore snapshot={snapshot} />
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 flex gap-2">
            {(["away", "home"] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => setTab(side)}
                className={`rounded-full border-2 px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  tab === side
                    ? "border-grass bg-grass text-card"
                    : "border-grass-deep/15 text-bark-soft hover:border-grass/60"
                }`}
              >
                {snapshot.teams[side].abbrev}
              </button>
            ))}
          </div>
          <BoxScore snapshot={snapshot} side={tab} />
        </div>

        <div className="border-t-2 border-dashed border-grass-deep/15 px-6 py-4">
          <Link
            href="/"
            className="inline-block rounded-full border-2 border-grass-deep/15 px-4 py-2 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep"
          >
            ← Back to the games
          </Link>
        </div>
      </div>
    </div>
  );
}
