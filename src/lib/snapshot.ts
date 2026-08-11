import type { WebGLRenderer } from "three";
import type { GameSnapshot } from "@/lib/game/types";

const TARGET_WIDTH = 1600;
const FOOTER = 168;

/** Pocket Ballpark's palette, as the footer needs it. */
const PAPER = "#fffcf5";
const GRASS = "#3f8f5b";
const GRASS_DEEP = "#1f5a39";
const BARK = "#4a3524";
const BARK_SOFT = "#8b6d52";

function text(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `700 ${size}px ui-rounded, "SF Pro Rounded", Nunito, "Segoe UI", system-ui, sans-serif`;
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
    ctx.strokeStyle = filled ? GRASS : "rgba(74,53,36,0.3)";
    ctx.fillStyle = filled ? GRASS : "transparent";
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

  // Footer: a strip of the same warm paper the rest of the app is printed on.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, height, width, FOOTER);
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, height, width, 6);

  const baseY = height + 62;
  const { teams, score } = snapshot;

  // Away / home rows.
  const rows: Array<[typeof teams.away, number, number]> = [
    [teams.away, score.away, baseY],
    [teams.home, score.home, baseY + 58],
  ];
  for (const [team, runs, y] of rows) {
    ctx.beginPath();
    ctx.arc(56, y - 10, 16, 0, Math.PI * 2);
    ctx.fillStyle = team.palette.primary;
    ctx.fill();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 4;
    ctx.stroke();
    text(ctx, team.abbrev, 90, y, 30, BARK);
    text(ctx, String(runs), 250, y, 34, GRASS_DEEP, "right");
  }

  const batting = snapshot.battingSide === "away" ? baseY : baseY + 58;
  text(ctx, "●", 272, batting, 22, GRASS);

  // Inning + count.
  const midX = 360;
  text(
    ctx,
    `${snapshot.isTopInning ? "Top" : "Bot"} ${snapshot.inningOrdinal}`,
    midX,
    height + 52,
    26,
    GRASS_DEEP,
  );
  text(
    ctx,
    `${snapshot.count.balls}-${snapshot.count.strikes}   ${snapshot.count.outs} out`,
    midX,
    height + 92,
    24,
    BARK_SOFT,
  );
  drawDiamond(ctx, midX + 250, height + 66, 26, snapshot);

  // Matchup.
  const rightX = width - 40;
  text(ctx, `AB  ${snapshot.batter?.name ?? "—"}`, rightX, height + 52, 24, BARK, "right");
  text(
    ctx,
    `P   ${snapshot.defense.pitcher?.name ?? "—"}`,
    rightX,
    height + 88,
    24,
    BARK_SOFT,
    "right",
  );
  text(ctx, snapshot.venue, rightX, height + 126, 18, BARK_SOFT, "right");
  text(ctx, "Pocket Ballpark", 40, height + 140, 20, GRASS);

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
      await navigator.share({ files: [file], title: "Pocket Ballpark" });
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
