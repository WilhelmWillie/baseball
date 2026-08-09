import type { WebGLRenderer } from "three";
import type { GameSnapshot } from "@/lib/game/types";

const TARGET_WIDTH = 1600;
const FOOTER = 168;

function text(
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

/** Compose a shareable PNG: the rendered frame plus a baked-in scorebug. */
export async function captureSnapshot(
  gl: WebGLRenderer,
  snapshot: GameSnapshot,
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  // preserveDrawingBuffer keeps the last rendered frame readable, and R3F
  // renders every frame, so the buffer already holds what the user sees.
  const source = gl.domElement;
  // Scale toward a comfortable sharing size without going past the rendered
  // resolution by more than a little.
  const scale = Math.min(2, Math.max(1, TARGET_WIDTH / source.width));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height + FOOTER;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not create snapshot canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

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
    text(ctx, team.abbrev, 90, y, 30, "#f4f6f8");
    text(ctx, String(runs), 250, y, 34, "#ffffff", "right");
  }

  const batting = snapshot.battingSide === "away" ? baseY : baseY + 58;
  text(ctx, "●", 272, batting, 22, "#fcd34d");

  // Inning + count.
  const midX = 360;
  text(
    ctx,
    `${snapshot.isTopInning ? "TOP" : "BOT"} ${snapshot.inningOrdinal.toUpperCase()}`,
    midX,
    height + 52,
    26,
    "#fcd34d",
  );
  text(
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
  text(ctx, `AB  ${snapshot.batter?.name ?? "—"}`, rightX, height + 52, 24, "#f4f6f8", "right");
  text(
    ctx,
    `P   ${snapshot.defense.pitcher?.name ?? "—"}`,
    rightX,
    height + 88,
    24,
    "rgba(244,246,248,0.75)",
    "right",
  );
  text(
    ctx,
    snapshot.venue.toUpperCase(),
    rightX,
    height + 126,
    18,
    "rgba(244,246,248,0.45)",
    "right",
  );
  text(ctx, "MLB 3D LIVE", 40, height + 140, 18, "rgba(244,246,248,0.4)");

  const blob = await new Promise<Blob>((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Snapshot encoding failed"))), "image/png");
  });

  const filename = `${teams.away.abbrev}-at-${teams.home.abbrev}-${snapshot.isTopInning ? "top" : "bot"}${snapshot.inning}.png`;
  return { blob, dataUrl: out.toDataURL("image/png"), filename };
}

/**
 * Hand the image to the user. The download always happens; copying to the
 * clipboard is a bonus on top of it.
 */
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
      // Dismissed or unsupported - fall through to the download path.
    }
  }

  // Save first. Clipboard access can stall indefinitely when the document is
  // not focused, and losing the file to that would be the worst outcome.
  triggerDownload(blob, filename);
  return (await copyToClipboard(blob)) ? "copied" : "downloaded";
}

async function copyToClipboard(blob: Blob): Promise<boolean> {
  if (!navigator.clipboard || !("write" in navigator.clipboard) || !window.ClipboardItem) {
    return false;
  }
  try {
    const write = navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("clipboard timeout")), 1500),
    );
    await Promise.race([write, timeout]);
    return true;
  } catch {
    return false;
  }
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
