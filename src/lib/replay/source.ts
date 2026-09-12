import { applyPatch, type Operation } from "fast-json-patch";
import type { MlbLiveFeed } from "@/lib/mlb/types";
import type { RecordedFrame } from "./reconstruct";
import {
  CLIP_SHAPE_VERSION,
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
 * Loading a game to replay, and moving through it.
 *
 * Two sources, one interface. A **published recording** is bytes on a static
 * host - `public/recordings/` is served at `/recordings`, and pointing that at a
 * bucket later is an env var rather than a code change. A **reconstructed
 * game** is any game MLB has finished, rebuilt from its final feed in the
 * browser at load time, which is how the rest of the season is watchable
 * without publishing anything. `loadReplay` picks between them; everything
 * downstream sees a `RecordingPlayer` either way.
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
 * A game the replay pump can play, however it was obtained.
 *
 * `useReplay` touches exactly these three members, which is what lets a game
 * rebuilt in the browser and a recording published as bytes be the same thing
 * downstream. Both implementations return their own document from `feedAt`
 * rather than a copy, which is safe because nothing downstream keeps it:
 * `buildSnapshot`, `buildHistory` and `extractEvents` read primitives out into
 * fresh objects, and the store retains a `GameSnapshot`, never the feed it came
 * from.
 */
export interface RecordingPlayer {
  readonly manifest: RecordingManifest;
  readonly frameCount: number;
  feedAt(index: number): MlbLiveFeed;
}

/**
 * A published recording: one keyframe and a patch per frame, walked forward.
 *
 * The stored format trades work for bytes - see `PatchPlayer` versus
 * `FramePlayer` below - and this is the side that pays the work.
 */
export class PatchPlayer implements RecordingPlayer {
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

/**
 * A game rebuilt in the browser, held as frames.
 *
 * The counterpart to `PatchPlayer`, and the reason most games need no recording
 * at all. `reconstructFrames` shallow-copies as it reveals plays, so ~500 frames
 * of an ~800 KB document share nearly all of their structure - measured at 4 MB
 * of heap, not the 400 MB the arithmetic suggests. Seeking is then an array
 * index: no rewind, no checkpoints, no patches replayed.
 */
export class FramePlayer implements RecordingPlayer {
  constructor(
    readonly manifest: RecordingManifest,
    private readonly frames: RecordedFrame[],
  ) {
    if (frames.length === 0) throw new Error("Cannot play a game with no frames");
  }

  get frameCount(): number {
    return this.frames.length;
  }

  feedAt(index: number): MlbLiveFeed {
    const target = Math.max(0, Math.min(index, this.frames.length - 1));
    return this.frames[target].feed;
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
  return new PatchPlayer(manifest, lines);
}

/**
 * Any game that has been played, rebuilt from its final feed in the browser.
 *
 * This is what makes a season watchable without recording a season. A finished
 * GUMBO document carries every play and every timestamp, so `reconstructFrames`
 * rebuilds the frame stream from it - the same three calls the recorder makes,
 * against the same feed, producing the same frames.
 *
 * It is also *cheaper* than publishing one. Measured on a nine-inning game:
 * rebuilding the frames takes ~12 ms, while encoding them as patches takes ~4 s,
 * and the published recording is larger over the wire (179 KB of frames) than
 * the feed it was built from (130 KB gzipped). The stored format buys disk
 * space, which only matters for something kept on disk.
 *
 * The reconstructor is pulled in on demand rather than imported at the top: it
 * is ~900 lines that only a replay needs, and `loadReplay` below has to read the
 * index before it knows whether this is the player it wants.
 */
export async function loadReconstructed(gamePk: number | string): Promise<RecordingPlayer> {
  const [res, { reconstructFrames }, { dedupeFrames, buildManifest }] = await Promise.all([
    // The proxy serves a finished game `immutable`, so a second viewing - or a
    // second viewer behind the same CDN - costs nothing upstream.
    fetch(`/api/game/${gamePk}`, { cache: "force-cache" }),
    import("./reconstruct"),
    import("./encode"),
  ]);
  if (!res.ok) throw new Error(`This game's feed responded ${res.status}`);
  const feed = (await res.json()) as MlbLiveFeed;

  const frames = dedupeFrames(reconstructFrames(feed));
  if (frames.length === 0) {
    // A game with no plays in its feed: postponed, or scheduled and not yet
    // played. There is nothing to watch and nothing a retry would fix.
    throw new Error("There's no play-by-play for this game to rebuild");
  }
  return new FramePlayer(buildManifest({ final: feed, frames, source: "reconstructed" }), frames);
}

/**
 * A whole game, from wherever it can be had.
 *
 * The shelf's handful of games are published as bytes and play without the
 * Stats API; everything else in the season is rebuilt from its feed. Which one
 * a `gamePk` is comes from the index - a 4 KB static file the browser has
 * usually cached already - rather than from probing for a recording that is not
 * there, because a 404 on the way into a game is a slower and worse way to
 * learn the same thing.
 */
export async function loadReplay(gamePk: number | string): Promise<RecordingPlayer> {
  const index = await loadRecordingIndex().catch(() => []);
  const published = index.some((entry) => entry.gamePk === Number(gamePk));
  return published ? loadRecording(gamePk) : loadReconstructed(gamePk);
}

/**
 * One plate appearance, cut out of a game by `/api/clip`.
 *
 * The route hands back the ordinary recording format, so a clip is a
 * `RecordingPlayer` like any other and everything downstream - the frame pump,
 * seeking, the store - treats it as a very short recording. Unlike a recording
 * it comes from an API route rather than `BASE`, because it is cut on demand
 * from the live feed rather than published ahead of time.
 */
export async function loadClip(
  gamePk: number | string,
  atBatIndex: number,
): Promise<RecordingPlayer> {
  // The shape version rides along so that a change to *which* frames a clip
  // keeps reaches people who already have the old one: finished games are
  // served `immutable`, and without this the URL would never change.
  const res = await fetch(`/api/clip/${gamePk}/${atBatIndex}?v=${CLIP_SHAPE_VERSION}`, {
    cache: "force-cache",
  });
  if (res.status === 404) throw new Error("That play isn't available to watch");
  if (!res.ok) throw new Error(`Clip responded ${res.status}`);
  const bundle = (await res.json()) as { manifest: RecordingManifest; lines: FrameLine[] };
  return new PatchPlayer(bundle.manifest, bundle.lines);
}

/** Which games are published as bytes. Absent is not an error. */
export async function loadRecordingIndex(): Promise<RecordingIndexEntry[]> {
  const res = await fetch(`${BASE}/v${FRAME_FORMAT_VERSION}/${INDEX_FILE}`, {
    cache: "force-cache",
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as { games?: RecordingIndexEntry[] };
  return payload.games ?? [];
}
