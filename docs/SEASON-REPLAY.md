# Any game, any day

Letting anyone replay any game of the 2026 season, without recording any of
them. [Issue #31](https://github.com/WilhelmWillie/baseball/issues/31).

Status: **proposed.** Nothing here is built yet. The numbers below are measured,
not estimated — see [Measurements](#the-measurement-that-decides-it).

## Where we are

Six games are on the shelf. Each was captured by `npm run record`, encoded as a
keyframe plus RFC-6902 patches, and committed under `public/recordings/v1/`.
`/watch/<gamePk>?replay=1` plays one. Everything else in the app is live-only: a
final game's card on the home page says "That's a wrap" and does not open.

Meanwhile the 2026 season has played **1,962 regular-season games** across 151
game days since Opening Day on 2026-03-25, and will finish somewhere near 2,430
before the postseason. Six is not a season.

## The obvious plan, and why we should not do it

Record all of them. A recording averages ~250 KB (179 KB of frames, 60 KB of
manifest), so a season is roughly **600 MB** of artifacts. That means a bucket,
a nightly job to pick up yesterday's finals, an index file with thousands of
rows, a backfill run, and a re-encode of everything whenever
`FRAME_FORMAT_VERSION` moves. Every one of those is real work, and none of it
buys anything — because of what recording actually costs.

## The measurement that decides it

One representative nine-inning game (`823342`, DET @ PIT, 2026-08-19), timed on
this machine through the repo's own functions:

| Step | Cost |
| --- | --- |
| Fetch the final feed from `statsapi` | 812 KB raw, **130 KB gzipped**, 40–180 ms |
| `JSON.parse` | 8 ms |
| `reconstructFrames` | **11 ms** → 529 moments |
| `dedupeFrames` | 1 ms → 511 frames |
| `buildManifest` | 1 ms → 25 scrub markers |
| `validateFrames` | 61 ms |
| `encodeFrames` (keyframe + patches) | **3,978 ms** |
| gzip the encoded stream | 35 ms → 179 KB |

Two numbers carry the whole design.

**Reconstruction is 12 ms; encoding is four seconds.** The expensive half of
recording is not reading the game, it is diffing 511 copies of an 800 KB
document against each other. And that half exists purely to make a recording
small *on disk* — materialized, the same frame stream is 1.8 MB, and a season of
those is gigabytes.

**The patch format was never a transport win.** A published recording costs
179 KB of frames plus its manifest over the wire. The raw feed it was built from
costs 130 KB. We are shipping *more* bytes to save the client from doing 12 ms
of work.

So: **every finished game is already a recording.** It is served by MLB, it is
smaller than what we publish, and turning it into frames is cheaper than the
network call that fetched it. It simply is not stored as one, and does not need
to be.

## The design

For a game that is final, `/watch/<gamePk>`:

1. The client fetches the final feed through our proxy, cached `immutable`
   because a finished game never changes again.
2. The client runs `reconstructFrames` → `dedupeFrames` → `buildManifest`, the
   same three calls the recorder makes, and wraps the result in a player.
3. `useReplay` drives that player exactly as it drives a published recording
   today — same frames, same store, same director, same transport, same scrub
   bar.

There is no storage, no publish step, no nightly job, no season index, and no
migration for games nobody has watched yet. The recorder and the on-disk format
stay where they are; they stop being the only way to watch a game that is over.

**Per viewer:** one 130 KB response and ~12 ms of CPU in Node — call it tens of
milliseconds on a mid-range phone, to be confirmed on a real device. The
materialized frames measure **4 MB of heap**, not 1.8 MB×n, because
`reconstructFrames` shallow-copies: 511 frames are mostly one document.

### Will it work on every game?

Sampled 24 games and ran `reconstructFrames` + `validateFrames` — the recorder's
own trust check — over each: **24 OK, 0 failures, 0 errors.**

| Sample | Result |
| --- | --- |
| 15 regular-season games spread over 2026-04-01 → 2026-08-15 | all OK, 423–578 frames, 109–142 KB gzipped |
| Rain-shortened (`824295`, `824807`) | OK. One warning, correctly: "Frame 138 sits 107 minutes after the one before it" — that is the delay |
| Both halves of two doubleheaders (`824132`/`824134`, `824459`/`824460`) | all OK |
| Spring training (`831638`) | OK (1.4 MB feed, the largest seen) |
| All-Star Game (`823443`) | OK |
| 2025 World Series Game 7 (`813024`) | OK, 620 frames — matching its published manifest |

That last row is the equivalence check worth keeping: the on-demand path
produces the same frame count as the recording we published from the same feed,
because it is the same code.

## What changes

### Phase 1 — play any finished game

1. **`lib/replay/source.ts`** — `RecordingPlayer` becomes an interface of the
   three members `useReplay` actually touches (`manifest`, `frameCount`,
   `feedAt`). Today's class becomes `PatchPlayer`; a new `FramePlayer` wraps a
   materialized `RecordedFrame[]` and answers `feedAt` with an array index. No
   checkpoints, no rewind, no mutation — seeking gets *cheaper* than it is now.
2. **`loadReconstructed(gamePk)`**, alongside `loadRecording` and `loadClip`:
   fetch → reconstruct → dedupe → `buildManifest` → `FramePlayer`. It throws on
   an empty frame stream, which `useReplay`'s existing error path already
   renders.
3. **`app/api/game/[gamePk]/route.ts`** — state-aware caching, exactly as
   `/api/clip` already does it. A `Final` feed goes back as
   `public, max-age=31536000, immutable` and into an LRU that does not expire on
   the 3-second live timer; live stays `no-store`. Only what we hand the browser
   changes — `fetchLiveFeed` keeps reading upstream uncached.
4. **`hooks/useReplay.ts`** — `ReplaySource` gains `{ kind: "reconstructed" }`.
   The pump below it does not change.
5. **`app/watch/[gamePk]/page.tsx`** — pick the mode from the game's status
   rather than from the query string. `fetchScheduleGame` is cheap and already
   cached: final ⇒ replay, live ⇒ live, not yet started ⇒ a "first pitch at …"
   page instead of a viewer that can never load a feed. `?replay=1` survives as
   an override, so every link that exists today still works.
6. **Failure surface** — if reconstruction throws or yields nothing, the viewer
   says so and offers the way home, rather than showing an empty ballpark.
   `validateFrames` stays out of the request path: 61 ms is five times the
   reconstruction, and its job is catching recorder bugs before a publish that
   no longer happens. It stays the sweep tool below.

### Phase 2 — find any game

Playing them is half the issue; the home page still only knows about today.

1. **`/api/games` grows `?date=YYYY-MM-DD`**, defaulting to today. Same
   `summarizeGame`/`sortGames`, clamped to the season.
2. **`/games/[date]`** — a server-rendered day page with previous/next day
   links. Linkable and crawlable, and where "browse the season" lands.
3. **`GameCard`** — `watchable` becomes live *or* final. "That's a wrap" becomes
   "Watch the replay". Postponed, cancelled and not-yet-started stay closed;
   the 2026 schedule so far carries 27 postponed and 3 cancelled games, so this
   is not hypothetical.
4. **Home page** keeps its shape — today's slate, the curated shelf, then an
   entry into the rest of the season.
5. **Scope** — regular season and postseason, plus the All-Star Game. Spring
   training reconstructs fine but is not what the issue asks for; leave it out
   of the browser rather than build a filter nobody asked for.

### Phase 3 — the shelf becomes editorial (optional, and last)

Once anything is playable, the six published recordings are redundant with a
path that also serves the other 2,424 games — and they are the only reason the
patch encoder, the publish half of `scripts/record-game.ts`, and a second
playback source exist. The part worth keeping is the curation: `label` and
`note` are why a game is on the shelf, and no feed carries them.

Move those into a small committed table (`lib/replay/featured.ts`: gamePk,
label, note), point `loadRecordingIndex` at it, and delete 1.6 MB of artifacts.

Do this separately and afterwards. It is a subtraction, and the on-demand path
deserves to be in production for a while first. The stored format stays
documented either way — [RECORDING.md](./RECORDING.md) and
`NEXT_PUBLIC_RECORDINGS_BASE_URL` are still the right answer for a game the
Stats API stops serving.

### Phase 4 — only if the numbers ask

Trimming the feed server-side (the boxscore's season stat lines are the obvious
fat), prefetching on card hover, a team or date search. None of it is worth
doing before there is a measurement on a phone saying it is.

## Risks

1. **A game that will not reconstruct.** 24/24 in the sample, but a season holds
   suspended games resumed the next day, protests, a position player pitching,
   and whatever else. Mitigation: `scripts/validate-season.ts` — walk every
   date, reconstruct and validate every final game, print the failures. Run it
   once over 2026 before Phase 2 ships. It is ~1,950 feeds serially, so about
   an hour of wall clock and 1.6 GB read, once. If a handful of games fail, they
   fail closed: the card stays unwatchable and says why.
2. **What we ask of the Stats API.** One 800 KB read per game watched, versus
   one per *viewer* if the immutable caching in Phase 1.3 is skipped. It is the
   load-bearing part of that step, not a nicety. The in-process LRU should grow
   past its current 32 entries for finals, which never invalidate.
3. **Phones.** 4 MB of heap and 12 ms of CPU on a laptop. Measure a real device
   before Phase 2, because Phase 2 is what invites people to open old games from
   a phone.
4. **The boxscore caveat is unchanged.** MLB publishes per-player stat lines
   only in their final state, so a replayed game shows end-of-game numbers
   beside a name from the first inning. The linescore — what the renderer
   actually stands players on — is rebuilt exactly. Already documented in
   RECORDING.md; it just applies to every game now instead of six.
5. **Scope creep into "any season."** Everything here is season-agnostic apart
   from the date clamp, and 2025's postseason already reconstructs. Ship 2026
   and resist the year picker.

## What this does not need

No database. No object storage. No nightly job. No new dependency. No change to
the normalizer, the director, the store, or anything under `components/scene/`.

## When it ships

`docs/ARCHITECTURE.md` gains the new route and the `FramePlayer`/`PatchPlayer`
split in its "Where to change what" table; `README.md`'s account of recordings
stops being the only way a finished game is watched.
