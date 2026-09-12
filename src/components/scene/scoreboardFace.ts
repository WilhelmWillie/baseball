import type { Species } from "@/lib/game/species";
import { speciesFor } from "@/lib/game/species";
import type { GameSnapshot, TeamSide } from "@/lib/game/types";
import { inkOn } from "@/lib/mlb/teams";

/**
 * What the board out over the batter's eye says, and how it is painted.
 *
 * The board is a canvas texture rather than a grid of little cubes, because
 * what it has to do is be *read* - from a seat behind home, four hundred feet
 * away. A cube per digit segment would cost a few hundred instances and still
 * come out as a smudge at that range.
 */

/**
 * Columns the board has room for. A game that runs long keeps playing; the
 * board just stops adding columns and the extra runs land in R, with a small
 * marker in the corner so the total never looks like it disagrees with the
 * nine innings above it.
 */
export const BOARD_INNINGS = 9;

export interface BoardTeam {
  abbrev: string;
  color: string;
  species: Species;
  runs: number;
  hits: number;
  errors: number;
  /** Runs in each of the first nine innings; null where nothing is published. */
  innings: Array<number | null>;
}

export interface BoardState {
  /**
   * Everything painted, as a string. The texture is only redrawn when this
   * changes, so a ball and a strike - which the board does not carry - do not
   * cost a repaint.
   */
  key: string;
  away: BoardTeam;
  home: BoardTeam;
  /** The half-inning in progress, if it is one the board has a column for. */
  active: { inning: number; isTop: boolean } | null;
  /** Innings played past the ninth, which fold into the R column. */
  extras: number;
}

/** The lamp-lit palette of a wooden board: warm cream on dark stained pine. */
const FACE = {
  panelTop: "#4b3822",
  panel: "#38291a",
  rule: "#6f5238",
  ruleSoft: "rgba(246, 231, 198, 0.16)",
  head: "#e8d3a6",
  digit: "#f6e7c6",
  /** A published zero is not the same as an inning nobody has batted in yet. */
  zero: "#bda37a",
  unplayed: "rgba(246, 231, 198, 0.18)",
  total: "#ffd98a",
  live: "rgba(255, 201, 90, 0.2)",
  liveRing: "#ffc95a",
};

const ROUNDED = 'ui-rounded, "SF Pro Rounded", Nunito, system-ui, sans-serif';

function teamBoard(snapshot: GameSnapshot, side: TeamSide): BoardTeam {
  const team = snapshot.teams[side];
  const innings: Array<number | null> = [];
  for (let i = 0; i < BOARD_INNINGS; i++) {
    innings.push(snapshot.lineScore[i]?.[side] ?? null);
  }
  return {
    abbrev: team.abbrev,
    color: team.palette.primary,
    species: speciesFor(side),
    runs: snapshot.score[side],
    hits: snapshot.hits[side],
    errors: snapshot.errors[side],
    innings,
  };
}

/** Pulls the board's own view of the game out of a snapshot. */
export function boardState(snapshot: GameSnapshot | null): BoardState | null {
  if (!snapshot) return null;
  const away = teamBoard(snapshot, "away");
  const home = teamBoard(snapshot, "home");
  // A board lights the half-inning being played, and only while it is being
  // played: once the game is final there is nothing in progress to point at.
  const live =
    !snapshot.status.isFinal &&
    !snapshot.status.isPreview &&
    snapshot.inning >= 1 &&
    snapshot.inning <= BOARD_INNINGS;
  const active = live ? { inning: snapshot.inning, isTop: snapshot.isTopInning } : null;

  const key = [
    away.abbrev,
    home.abbrev,
    away.color,
    home.color,
    away.innings.join(","),
    home.innings.join(","),
    `${away.runs}-${away.hits}-${away.errors}`,
    `${home.runs}-${home.hits}-${home.errors}`,
    active ? `${active.inning}${active.isTop ? "T" : "B"}` : "-",
    snapshot.lineScore.length,
  ].join("|");

  return {
    key,
    away,
    home,
    active,
    extras: Math.max(0, snapshot.lineScore.length - BOARD_INNINGS),
  };
}

/** Where every column and row of the board lands, for a canvas of this size. */
function layout(width: number, height: number) {
  const pad = height * 0.055;
  // The label column has to hold a badge and a three-letter abbrev and still
  // leave air before the first inning, or "CWS" runs into the top of the first.
  const labelW = width * 0.188;
  const totalsW = width * 0.176;
  const gap = width * 0.016;
  const inningsW = width - pad * 2 - labelW - totalsW - gap;
  const headH = (height - pad * 2) * 0.26;
  const rowH = (height - pad * 2 - headH) / 2;
  return {
    pad,
    labelW,
    totalsW,
    gap,
    colW: inningsW / BOARD_INNINGS,
    inningsX: pad + labelW,
    totalsX: pad + labelW + inningsW + gap,
    headH,
    rowH,
    headY: pad + headH / 2,
    rowY: (row: number) => pad + headH + rowH * (row + 0.5),
  };
}

function alienHead(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  // The same cranium the badge on the panel draws, off the same 24-unit box.
  const u = (v: number) => (v / 24) * size;
  const px = (v: number) => x + u(v);
  const py = (v: number) => y + u(v);
  ctx.beginPath();
  ctx.moveTo(px(12), py(2.5));
  ctx.bezierCurveTo(px(7), py(2.5), px(3.6), py(5.7), px(3.6), py(10.2));
  ctx.bezierCurveTo(px(3.6), py(14.7), px(7.3), py(19.1), px(12), py(21.5));
  ctx.bezierCurveTo(px(16.7), py(19.1), px(20.4), py(14.7), px(20.4), py(10.2));
  ctx.bezierCurveTo(px(20.4), py(5.7), px(17), py(2.5), px(12), py(2.5));
  ctx.closePath();
}

/**
 * A face in the club's colours: an alien for the home side, a robot for the
 * visitors, the same two the models on the field wear. `ink` paints the face
 * and the club colour is punched back out of it for the eyes.
 */
function drawSpecies(
  ctx: CanvasRenderingContext2D,
  species: Species,
  x: number,
  y: number,
  size: number,
  ink: string,
  cut: string,
) {
  const u = (v: number) => (v / 24) * size;
  ctx.save();
  ctx.fillStyle = ink;
  if (species === "alien") {
    alienHead(ctx, x, y, size);
    ctx.fill();
    ctx.fillStyle = cut;
    for (const [cx, tilt] of [
      [8.3, -0.35],
      [15.7, 0.35],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(x + u(cx), y + u(10.4), u(2.7), u(1.7), tilt, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x + u(12), y + u(2.6), u(1.8), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x + u(11.1), y + u(3.4), u(1.8), u(3.8), u(0.9));
    ctx.roundRect(x + u(3), y + u(6.8), u(18), u(14), u(3.2));
    ctx.fill();
    ctx.fillStyle = cut;
    ctx.beginPath();
    ctx.roundRect(x + u(6.5), y + u(9.6), u(3.8), u(3.8), u(1.3));
    ctx.roundRect(x + u(13.7), y + u(9.6), u(3.8), u(3.8), u(1.3));
    ctx.roundRect(x + u(8.4), y + u(16.1), u(7.2), u(1.9), u(0.95));
    ctx.fill();
  }
  ctx.restore();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  team: BoardTeam,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = team.color;
  ctx.fill();
  ctx.lineWidth = size * 0.08;
  ctx.strokeStyle = "rgba(246, 231, 198, 0.85)";
  ctx.stroke();
  const glyph = size * 0.76;
  drawSpecies(
    ctx,
    team.species,
    cx - glyph / 2,
    cy - glyph / 2,
    glyph,
    inkOn(team.color),
    team.color,
  );
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 800,
  align: CanvasTextAlign = "center",
) {
  ctx.font = `${weight} ${Math.round(size)}px ${ROUNDED}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

/** One team's line: badge and abbrev, nine innings, then R H E. */
function drawRow(
  ctx: CanvasRenderingContext2D,
  board: BoardState,
  team: BoardTeam,
  row: number,
  l: ReturnType<typeof layout>,
) {
  const y = l.rowY(row);
  const badge = Math.min(l.rowH * 0.66, l.labelW * 0.34);
  drawBadge(ctx, team, l.pad + badge / 2, y, badge);
  text(
    ctx,
    team.abbrev,
    l.pad + badge + l.labelW * 0.08,
    y,
    l.rowH * 0.42,
    FACE.head,
    800,
    "left",
  );

  const isTop = row === 0;
  for (let i = 0; i < BOARD_INNINGS; i++) {
    const cx = l.inningsX + l.colW * (i + 0.5);
    const runs = team.innings[i];
    const live = board.active?.inning === i + 1 && board.active.isTop === isTop;

    if (live) {
      // The half-inning being played, lit the way a real board lights it.
      const w = l.colW * 0.78;
      const h = l.rowH * 0.72;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, y - h / 2, w, h, h * 0.3);
      ctx.fillStyle = FACE.live;
      ctx.fill();
      ctx.lineWidth = Math.max(1, l.rowH * 0.035);
      ctx.strokeStyle = FACE.liveRing;
      ctx.stroke();
    }

    if (runs == null) {
      // Nobody has batted here yet, so the cell holds a placeholder rather
      // than a zero that would read as a scoreless inning.
      text(ctx, "·", cx, y, l.rowH * 0.7, live ? FACE.head : FACE.unplayed);
      continue;
    }
    text(ctx, String(runs), cx, y, l.rowH * 0.58, runs > 0 ? FACE.digit : FACE.zero);
  }

  const totals = [team.runs, team.hits, team.errors];
  for (let i = 0; i < totals.length; i++) {
    const cx = l.totalsX + (l.totalsW / 3) * (i + 0.5);
    const value = String(totals[i]);
    // A double-digit hit count in a single-digit column is what turns "5 13 0"
    // into one long number, so two figures are set a size down.
    const fit = value.length > 1 ? 0.78 : 1;
    text(
      ctx,
      value,
      cx,
      y,
      l.rowH * (i === 0 ? 0.66 : 0.56) * fit,
      i === 0 ? FACE.total : FACE.digit,
    );
  }
}

/**
 * Paints the whole face. Called once when the board is built and again
 * whenever the line score changes, which is a handful of times an inning.
 */
export function paintBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  board: BoardState | null,
) {
  const l = layout(width, height);

  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, FACE.panelTop);
  wash.addColorStop(1, FACE.panel);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  // A painted keyline just inside the recess, so the panel has an edge of its
  // own against the frame around it.
  ctx.lineWidth = Math.max(2, height * 0.014);
  ctx.strokeStyle = FACE.rule;
  ctx.beginPath();
  ctx.roundRect(
    l.pad * 0.45,
    l.pad * 0.45,
    width - l.pad * 0.9,
    height - l.pad * 0.9,
    height * 0.06,
  );
  ctx.stroke();

  // Inning numbers, then the totals, then the rules that separate them.
  for (let i = 0; i < BOARD_INNINGS; i++) {
    text(
      ctx,
      String(i + 1),
      l.inningsX + l.colW * (i + 0.5),
      l.headY,
      l.headH * 0.6,
      FACE.head,
      700,
    );
  }
  const heads = ["R", "H", "E"];
  for (let i = 0; i < heads.length; i++) {
    text(
      ctx,
      heads[i],
      l.totalsX + (l.totalsW / 3) * (i + 0.5),
      l.headY,
      l.headH * 0.66,
      i === 0 ? FACE.total : FACE.head,
    );
  }

  ctx.lineWidth = Math.max(1.5, height * 0.007);
  ctx.strokeStyle = FACE.ruleSoft;
  ctx.beginPath();
  ctx.moveTo(l.pad, l.pad + l.headH);
  ctx.lineTo(width - l.pad, l.pad + l.headH);
  const divider = l.totalsX - l.gap / 2;
  ctx.moveTo(divider, l.pad);
  ctx.lineTo(divider, height - l.pad);
  ctx.stroke();

  if (!board) {
    text(ctx, "POCKET BALLPARK", width / 2, l.pad + l.headH + l.rowH, l.rowH * 0.5, FACE.head);
    return;
  }

  drawRow(ctx, board, board.away, 0, l);
  drawRow(ctx, board, board.home, 1, l);

  if (board.extras > 0) {
    // The game went long. Say so where the total is, rather than pretending
    // the nine columns add up to it.
    const label = `+${board.extras}`;
    const size = l.headH * 0.46;
    ctx.font = `800 ${Math.round(size)}px ${ROUNDED}`;
    const w = ctx.measureText(label).width + size * 1.1;
    const h = size * 1.5;
    ctx.beginPath();
    ctx.roundRect(l.inningsX - l.gap - w, l.headY - h / 2, w, h, h / 2);
    ctx.fillStyle = FACE.live;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.1);
    ctx.strokeStyle = FACE.liveRing;
    ctx.stroke();
    text(ctx, label, l.inningsX - l.gap - w / 2, l.headY, size, FACE.total);
  }
}
