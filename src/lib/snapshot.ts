import type { WebGLRenderer } from "three";
import type { GameSnapshot } from "@/lib/game/types";

const TARGET_WIDTH = 1440;
const FOOTER = 168;

function pixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `bold ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  snapshot: GameSnapshot,
) {
  const bases: Array<["first" | "second" | "third", number, number]> = [
    ["second", 0, -size],
    ["first", size, 0],
    ["third", -size, 0],
  ];
  for (const [base, dx, dy] of bases) {
    const filled = Boolean(snapshot.runners[base]);
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.rotate(Math.PI / 4);
    ctx.lineWidth = 3;
    ctx.strokeStyle = filled ? "#fcd34d" : "rgba(255,255,255,0.4)";
    ctx.fillStyle = filled ? "#fcd34d" : "transparent";
    const half = size * 0.42;
    ctx.beginPath();
    ctx.rect(-half, -half, half * 2, half * 2);
    if (filled) ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Compose a shareable PNG: the pixel scene upscaled with nearest-neighbour
 * sampling so it keeps its blocky edges, plus a scorebug baked into the image.
 */
export async function captureSnapshot(
  gl: WebGLRenderer,
  snapshot: GameSnapshot,
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  // preserveDrawingBuffer keeps the last rendered frame readable, and R3F
  // renders every frame, so the buffer already holds what the user sees.
  const source = gl.domElement;
  const scale = Math.max(1, Math.round(TARGET_WIDTH / source.width));
  const width = source.width * scale;
  const height = source.height * scale;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height + FOOTER;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create snapshot canvas");
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(source, 0, 0, width, height);

  // Footer.
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, height, width, FOOTER);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, height, width, 4);

  const baseY = height + 62;
  const { teams, score } = snapshot;

  // Away / home rows.
  const rows: Array<[typeof teams.away, number, number]> = [
    [teams.away, score.away, baseY],
    [teams.home, score.home, baseY + 58],
  ];
  for (const [team, runs, y] of rows) {
    ctx.fillStyle = team.palette.primary;
    ctx.fillRect(40, y - 26, 32, 32);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(40, y - 26, 32, 32);
    pixelText(ctx, team.abbrev, 90, y, 30, "#f4f6f8");
    pixelText(ctx, String(runs), 250, y, 34, "#ffffff", "right");
  }

  const batting = snapshot.battingSide === "away" ? baseY : baseY + 58;
  pixelText(ctx, "●", 272, batting, 22, "#fcd34d");

  // Inning + count.
  const midX = 360;
  pixelText(
    ctx,
    `${snapshot.isTopInning ? "TOP" : "BOT"} ${snapshot.inningOrdinal.toUpperCase()}`,
    midX,
    height + 52,
    26,
    "#fcd34d",
  );
  pixelText(
    ctx,
    `${snapshot.count.balls}-${snapshot.count.strikes}   ${snapshot.count.outs} OUT`,
    midX,
    height + 92,
    24,
    "#cbd5e1",
  );
  drawDiamond(ctx, midX + 250, height + 66, 26, snapshot);

  // Matchup.
  const rightX = width - 40;
  pixelText(ctx, `AB  ${snapshot.batter?.name ?? "—"}`, rightX, height + 52, 24, "#f4f6f8", "right");
  pixelText(
    ctx,
    `P   ${snapshot.defense.pitcher?.name ?? "—"}`,
    rightX,
    height + 88,
    24,
    "rgba(244,246,248,0.75)",
    "right",
  );
  pixelText(
    ctx,
    snapshot.venue.toUpperCase(),
    rightX,
    height + 126,
    18,
    "rgba(244,246,248,0.45)",
    "right",
  );
  pixelText(ctx, "MLB 3D LIVE", 40, height + 140, 18, "rgba(244,246,248,0.4)");

  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Snapshot encoding failed"))), "image/png");
  });

  const filename = `${teams.away.abbrev}-at-${teams.home.abbrev}-${snapshot.isTopInning ? "top" : "bot"}${snapshot.inning}.png`;
  return { blob, dataUrl: out.toDataURL("image/png"), filename };
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
): Promise<"shared" | "copied" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });
  if (canShare) {
    try {
      await navigator.share({ files: [file], title: "MLB 3D Live" });
      return "shared";
    } catch {
      // Fall through to the download path.
    }
  }

  try {
    if (navigator.clipboard && "write" in navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
      triggerDownload(blob, filename);
      return "copied";
    }
  } catch {
    // Clipboard is best-effort.
  }

  triggerDownload(blob, filename);
  return "downloaded";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
