import { applyPatch, type Operation } from "fast-json-patch";
import type { MlbLiveFeed } from "@/lib/mlb/types";
import {
  FRAMES_FILE,
  FRAME_FORMAT_VERSION,
  INDEX_FILE,
  MANIFEST_FILE,
  recordingPrefix,
  type FrameLine,
  type PatchLine,
  type RecordingIndexEntry,
  type RecordingManifest,
} from "./format";

/**
 * Loading a recording and moving through it.
 *
 * Recordings live behind a base URL and nothing more. `public/recordings/` is
 * served statically at `/recordings`, so local development needs no
 * configuration; pointing this at a public bucket later is an env var, not a
 * code change.
 */
const BASE = process.env.NEXT_PUBLIC_RECORDINGS_BASE_URL ?? "/recordings";

/**
 * How often a full copy of the document is kept.
 *
 * Materializing every frame is not an option - a game is ~500 frames of a
 * ~900 KB document, which is most of a gigabyte. Instead one document is walked
 * forward with patches, and these checkpoints bound how far a *backward* seek
 * has to rewind. Ten clones of ~900 KB is a fair trade for never replaying more
 * than fifty patches to land on a frame.
 */
const CHECKPOINT_EVERY = 50;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** gzip's magic number. Static hosts serve `.gz` without `Content-Encoding`. */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function readFrameStream(url: string): Promise<FrameLine[]> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Recording frames responded ${res.status}`);
  const buffer = new Uint8Array(await res.arrayBuffer());

  // Sniff rather than assume: a static host hands the bytes over compressed and
  // untouched, but a CDN that sets `Content-Encoding: gzip` will have had the
  // browser unwrap them already.
  let text: string;
  if (isGzip(buffer)) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot read recordings (no DecompressionStream)");
    }
    const stream = new Blob([buffer as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(buffer);
  }

  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FrameLine);
}

/**
 * A loaded recording, positioned somewhere in the game.
 *
 * `feedAt` returns the player's own document rather than a copy. That is safe
 * because nothing downstream keeps it: `buildSnapshot`, `buildHistory` and
 * `extractEvents` all read primitives out into fresh objects, and the store
 * retains a `GameSnapshot`, never the feed it came from.
 */
export class RecordingPlayer {
  private readonly patches: PatchLine[];
  private readonly checkpoints = new Map<number, MlbLiveFeed>();
  private document: MlbLiveFeed;
  private position = 0;

  constructor(
    readonly manifest: RecordingManifest,
    lines: FrameLine[],
  ) {
    const head = lines[0];
    if (!head || head.kind !== "keyframe") {
      throw new Error("Recording does not start with a keyframe");
    }
    if (head.v !== FRAME_FORMAT_VERSION) {
      throw new Error(
        `Recording is format v${head.v}, this build reads v${FRAME_FORMAT_VERSION}`,
      );
    }
    this.patches = lines.slice(1).filter((line): line is PatchLine => line.kind === "patch");
    this.document = clone(head.feed);
    this.checkpoints.set(0, clone(head.feed));
  }

  get frameCount(): number {
    return this.patches.length + 1;
  }

  /** The most recent checkpoint at or before `index`. */
  private rewindPoint(index: number): number {
    let best = 0;
    for (const at of this.checkpoints.keys()) {
      if (at <= index && at > best) best = at;
    }
    return best;
  }

  feedAt(index: number): MlbLiveFeed {
    const target = Math.max(0, Math.min(index, this.frameCount - 1));

    if (target < this.position) {
      const from = this.rewindPoint(target);
      this.document = clone(this.checkpoints.get(from) as MlbLiveFeed);
      this.position = from;
    }

    while (this.position < target) {
      this.position += 1;
      const patch = this.patches[this.position - 1];
      // Clone the operations: `applyPatch` inserts `op.value` by reference, and
      // these operations get replayed every time a seek rewinds past them.
      applyPatch(
        this.document as unknown as Record<string, unknown>,
        clone(patch.ops) as Operation[],
        false,
        true,
      );
      if (this.position % CHECKPOINT_EVERY === 0 && !this.checkpoints.has(this.position)) {
        this.checkpoints.set(this.position, clone(this.document));
      }
    }

    return this.document;
  }
}

export async function loadRecording(gamePk: number | string): Promise<RecordingPlayer> {
  const prefix = `${BASE}/${recordingPrefix(Number(gamePk))}`;
  const [manifestRes, lines] = await Promise.all([
    fetch(`${prefix}/${MANIFEST_FILE}`, { cache: "force-cache" }),
    readFrameStream(`${prefix}/${FRAMES_FILE}`),
  ]);
  if (!manifestRes.ok) throw new Error(`Recording manifest responded ${manifestRes.status}`);
  const manifest = (await manifestRes.json()) as RecordingManifest;
  return new RecordingPlayer(manifest, lines);
}

/** The recorded-games index, for the home page. Absent is not an error. */
export async function loadRecordingIndex(): Promise<RecordingIndexEntry[]> {
  const res = await fetch(`${BASE}/v${FRAME_FORMAT_VERSION}/${INDEX_FILE}`, {
    cache: "force-cache",
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as { games?: RecordingIndexEntry[] };
  return payload.games ?? [];
}
