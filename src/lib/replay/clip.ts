import type { MlbLiveFeed, MlbPlay } from "@/lib/mlb/types";
import { dedupeFrames, encodeFrames } from "./encode";
import { FRAME_FORMAT_VERSION, type FrameLine, type RecordingManifest } from "./format";
import { reconstructFrames, type RecordedFrame } from "./reconstruct";

/**
 * One plate appearance, cut out of a game as a recording in its own right.
 *
 * There is nothing new to record. `reconstructFrames` already rebuilds a game's
 * whole frame stream from a single GUMBO document, and it does that just as
 * well for a game still in progress as for a finished one - a live feed carries
 * every completed play with real timestamps on it. Each plate appearance comes
 * out as a contiguous run of frames tagged with its `atBatIndex`: the set frame
 * where the batter steps in, one frame per pitch, then the result. That run
 * *is* the clip, and it starts and ends exactly where a viewer would expect.
 *
 * The output is the ordinary recording format, so the client builds a
 * `RecordingPlayer` from it and `useReplay` drives it with no idea it is
 * watching one at-bat rather than a whole game.
 */
export interface ClipBundle {
  manifest: RecordingManifest;
  lines: FrameLine[];
}


/**
 * Cut every play but this one out of a frame's feed.
 *
 * A clip taken in the ninth would otherwise haul the game's other ninety-odd
 * completed plays along inside its keyframe - measured at 690 KB, dwarfing
 * everything else in the payload - to render a single at-bat that reads none of
 * them. Dropping them also gives the clip page an honest game log: one play,
 * the one being watched.
 *
 * Safe because nothing downstream addresses a play by its position in the
 * array. `extractEvents` and `seedCursor` key off `about.atBatIndex`, and the
 * store seeds itself fresh from the clip's first frame, so what matters is only
 * that every frame in the clip is trimmed the same way.
 *
 * The play to keep is always the last entry: an in-flight frame appends the
 * truncated current play to the completed ones, and a result frame ends on the
 * play that just settled.
 */
function trimToPlay(frame: RecordedFrame, atBatIndex: number): RecordedFrame {
  const feed = frame.feed;
  const plays = feed.liveData?.plays;
  const all = plays?.allPlays ?? [];
  const play: MlbPlay | undefined = all[all.length - 1];
  if (!play) return frame;

  const trimmed: MlbLiveFeed = {
    ...feed,
    liveData: {
      ...feed.liveData,
      plays: {
        allPlays: [play],
        currentPlay: plays?.currentPlay ?? play,
        scoringPlays: (plays?.scoringPlays ?? []).filter((i) => i === atBatIndex),
      },
    },
  };
  return { ...frame, feed: trimmed };
}

/** How much of its play a frame has revealed. */
function revealedEvents(frame: RecordedFrame): number {
  const plays = frame.feed.liveData?.plays?.allPlays ?? [];
  return plays[plays.length - 1]?.playEvents?.length ?? 0;
}

/**
 * Cut the at-bat down to the pitch that decided it.
 *
 * A clip is something somebody followed a link to watch, and the swing is what
 * they came for. Sitting them through five lead-up pitches to get there is the
 * surest way to lose them, so the clip opens on the delivery immediately before
 * the result.
 *
 * Three frames survive: the one just before the last pitch, the one that
 * reveals it, and the result. **Moving the opener is the load-bearing part** -
 * this is not a filter. The store seeds its cursor off whatever frame it lands
 * on, reading `playEvents.length - 1` (`seedCursor`), and `extractEvents` then
 * skips everything at or below that index. Opening on the frame before the last
 * pitch is therefore what makes the skipped pitches *skipped*: keep the
 * original set frame and drop the middle instead, and the cursor still starts at
 * -1, so the next frame hands the animator every pitch of the at-bat at once.
 *
 * Two things fall out of it for free. The opener carries
 * `countFrom(playEvents[0..p-1])`, so the scorebug opens on 2-2 rather than 0-0
 * and the clip reads as a real moment. And the decisive-pitch frame still leaves
 * the play incomplete, so `deciderIndex` holds it and the result releases it -
 * pitch and outcome animate as one motion, exactly as before.
 */
function keepDecisivePitch(frames: RecordedFrame[], play: MlbPlay): RecordedFrame[] {
  const events = play.playEvents ?? [];
  let last = -1;
  for (let i = 0; i < events.length; i++) if (events[i].isPitch) last = i;
  // A play with no pitch in it at all - a runner picked off between hitters,
  // say - has no build-up to skip.
  if (last <= 0) return frames;
  return frames.filter((frame) => revealedEvents(frame) >= last);
}

/**
 * Build a clip of one plate appearance, or nothing if it cannot be cut.
 *
 * Returns null for a play that is missing or still in progress. A clip is a
 * finished thing - it has to know where it ends - and an at-bat mid-count would
 * both stop somewhere arbitrary and be wrong the moment the next pitch landed.
 */
export function buildClip(feed: MlbLiveFeed, atBatIndex: number): ClipBundle | null {
  const play = (feed.liveData?.plays?.allPlays ?? []).find(
    (p, i) => (p.about?.atBatIndex ?? p.atBatIndex ?? i) === atBatIndex,
  );
  if (!play?.about?.isComplete) return null;

  // Between-innings frames belong to no plate appearance; they carry the
  // atBatIndex of the play that closed the half, which is not this one's.
  const all = reconstructFrames(feed)
    .filter((frame) => frame.meta.atBatIndex === atBatIndex && !frame.meta.between)
    .map((frame) => trimToPlay(frame, atBatIndex));
  const frames = keepDecisivePitch(all, play);
  if (frames.length === 0) return null;

  const kept = dedupeFrames(frames);
  const gamePk = feed.gamePk ?? feed.gameData?.game?.pk ?? 0;

  return {
    manifest: buildClipManifest(feed, kept, play),
    lines: encodeFrames(gamePk, kept),
  };
}

/**
 * The clip's manifest.
 *
 * `buildManifest` is not reused here: it walks a whole game to find half-inning
 * boundaries and scoring plays for a scrub bar, and a clip has neither a scrub
 * bar nor more than one half-inning. What it needs is the seek index - which is
 * one row per frame - and enough about the game to name itself.
 */
function buildClipManifest(
  feed: MlbLiveFeed,
  frames: RecordedFrame[],
  play: MlbPlay,
): RecordingManifest {
  const base = frames[0]?.t ?? 0;
  const last = frames[frames.length - 1]?.feed ?? feed;
  const linescore = last.liveData?.linescore;

  const team = (side: "home" | "away") => ({
    id: feed.gameData?.teams?.[side]?.id ?? -1,
    abbrev: feed.gameData?.teams?.[side]?.abbreviation ?? side.toUpperCase(),
    name: feed.gameData?.teams?.[side]?.name ?? feed.gameData?.teams?.[side]?.teamName ?? side,
    score: linescore?.teams?.[side]?.runs ?? 0,
  });

  return {
    v: FRAME_FORMAT_VERSION,
    gamePk: feed.gamePk ?? feed.gameData?.game?.pk ?? 0,
    recordedAt: new Date().toISOString(),
    source: "reconstructed",
    game: {
      date: feed.gameData?.datetime?.officialDate ?? feed.gameData?.datetime?.dateTime ?? "",
      venue: feed.gameData?.venue?.name ?? "Ballpark",
      home: team("home"),
      away: team("away"),
      label: play.result?.description,
    },
    frameCount: frames.length,
    durationMs: (frames[frames.length - 1]?.t ?? base) - base,
    frames: frames.map((frame, i) => ({
      i,
      t: frame.t - base,
      inning: frame.meta.inning,
      isTop: frame.meta.isTop,
      atBatIndex: frame.meta.atBatIndex,
      playComplete: frame.meta.playComplete,
      scoring: frame.meta.scoring,
      between: frame.meta.between,
    })),
    markers: [],
  };
}
