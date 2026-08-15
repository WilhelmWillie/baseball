# Game Recording & Replay

A design for capturing real MLB games off the Stats API, storing them, and
replaying them in the ballpark with a scrubbable timeline.

Status: **Phases 1–3 shipped, and the demo game is gone.** Real games are
recorded and play in the ballpark: `/watch/813024?replay=1`. Play/pause, stepping
by plate appearance and half-inning, and a scrub bar marked with half-innings and
scoring plays. Playback has no clock — it advances when the ballpark has finished
animating.

## Context

Pocket Ballpark animates a live MLB game by polling the Stats API's GUMBO feed
and interpreting it. There used to be exactly two ways to exercise that pipeline:

1. **A real live game** — only available a few hours a day, in season, and
   unrepeatable. You cannot re-run the play that broke the animation.
2. **`/watch/demo`** — a procedurally generated Giants-at-Dodgers game built from
   a hand-written 20-at-bat script.

The demo was the problem this feature exists to fix. It was synthesized, not
observed: fictional players, invented Statcast coordinates, a metronomic
7s-per-pitch cadence, two innings and then it stopped. It did not carry the
things that actually break the renderer — pitching changes, pinch hitters,
replay reviews, defensive substitutions, a `hitData` block with a missing
`trajectory`, an at-bat whose result publishes six seconds after the pitch.

Recordings replaced it, and `lib/sim/` has been deleted.

We want to **record real games** — capture the actual feed stream, store it, and
replay it in the ballpark on demand, with the ability to skip to any part of the
game. A recorded game becomes a fixture: deterministic, repeatable, shareable,
and real.

**Outcome:** `/watch/775302?replay=1` plays a real, complete, previously-played
MLB game through the unmodified normalizer → director → three.js path, with a
timeline you can scrub to any half-inning or scoring play.

## Goals

- Record any **completed** MLB game into a compact, immutable artifact.
- Store recordings in **S3 / R2** so they are shared across devs, CI and deploys.
- Replay through the **existing** `buildSnapshot` / `extractEvents` / `Director`
  path — the whole point is to exercise production code, not a parallel one.
- **Seek** to any plate appearance, half-inning or scoring play; play/pause.
- Never cut an animation short. Playback is paced by the ballpark, not a clock.

## Non-goals

- Recording a game *while* it is in progress. Retroactive capture covers every
  game ever played and needs no long-running process; live tailing can be added
  later if the true feed-arrival cadence turns out to matter.
- Editing recordings, or synthesizing games that never happened.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | S3 / R2 object storage | Shared across devs, CI and prod; repo stays clean; recordings are large-ish and immutable, which is exactly what object storage is for. |
| Capture | Retroactive, from finished games | Any game from any season, captured in one batch run. No waiting three hours for a live game. |
| Pacing | No clock — advance when the ballpark is ready, then rest a beat | A clock advanced whether or not the director had finished, so long animations were cut off mid-celebration. Waiting on `director.isIdle()` fixes that; a beat between plays keeps it from reading as a highlight reel. ~35 min for a nine-inning game. |
| Timeline | Plate appearances, with half-inning and scoring markers | "Show me the 7th", "jump to the home run" — and seeking always lands on the start of an at-bat. |

## Architecture

```
                    ┌─ RECORD (offline, one-shot per game) ──────────┐
  statsapi.mlb.com  │  scripts/record-game.ts                        │
        │           │    fetch → frames → keyframe + JSON patches    │
        └──────────▶│    → manifest.json + frames.ndjson.gz          │
                    └────────────────────┬───────────────────────────┘
                                         ▼
                    public/recordings/v1/{gamePk}/   (or a bucket, via
                                         │            NEXT_PUBLIC_RECORDINGS_BASE_URL)
                    ┌─ REPLAY (runtime) ─┴───────────────────────────┐
                    │  lib/replay/source    one document + patches   │
                    │  lib/replay/timeline  at-bat index, pacing    │
                    │  hooks/useReplay      idle gate + beat         │
                    └────────────────────┬───────────────────────────┘
                                         ▼  ingest(feed)   ← unchanged
                    store/gameStore ▶ lib/game ▶ lib/anim ▶ components/scene
```

**The load-bearing insight:** `gameStore.ingest(feed)` takes a whole
`MlbLiveFeed` and figures out what is new by walking a `FeedCursor`. It does not
care whether that feed came from `statsapi.mlb.com` or from a file recorded last
October. A recording is just an **ordered sequence of `MlbLiveFeed` values**, and
replay is a driver that hands them to `ingest()` as the ballpark becomes ready
for them. Nothing downstream of the store changes at all.

The retired simulator proved this contract end to end before it was removed: it
was a pure `(elapsedSeconds) → MlbLiveFeed`. Replay is the same shape, backed by
recorded bytes instead of a script.

## The recording format

Two objects per game, under a versioned prefix:

```
recordings/v1/{gamePk}/manifest.json       ~60-65 KB   metadata + seek index
recordings/v1/{gamePk}/frames.ndjson.gz    ~215-240 KB  keyframe + patches
recordings/v1/index.json                              list of recorded games
```

Measured, not estimated: three real games in `public/recordings/` come to 884 KB
together — see [Recorded games](#recorded-games).

### `frames.ndjson.gz`

One JSON value per line, gzipped. Line 0 is a **full `MlbLiveFeed` keyframe**.
Every subsequent line is an RFC-6902 JSON Patch against the previous frame.

```jsonc
{"v":1,"gamePk":775302,"kind":"keyframe","t":0,"feed":{ /* full GUMBO */ }}
{"kind":"patch","t":21400,"ops":[{"op":"add","path":"/liveData/plays/allPlays/0/playEvents/1","value":{…}}]}
{"kind":"patch","t":38900,"ops":[…]}
```

Why patches: a full GUMBO feed for a finished game is roughly 750 KB–900 KB, and
a game produces ~510–560 frames worth keeping. Storing them whole would be
400–500 MB. The delta between two adjacent pitches is a new `playEvent`, a count
change and a few boxscore counters — single-digit KB. Keyframe plus patches
lands at **215–240 KB gzipped for a whole game**, about a quarter the size of
one raw feed.

`t` is **milliseconds since the first pitch**, derived from real recorded
timestamps. Playback ignores it — pacing comes from the animations, not the
file — but it is what the game actually did, so it is kept.

### What counts as a frame

Not every upstream change. A frame is kept when the **app-visible** state moves,
fingerprinted as:

```
(allPlays.length, lastPlay.playEvents.length, lastPlay.about.isComplete,
 linescore.currentInning, isTopInning, outs, balls, strikes, home runs, away runs)
```

That is one frame per pitch, per completed play, per substitution and per
half-inning change — precisely the granularity `extractEvents` reacts to.
Metadata churn that the renderer would never notice is dropped.

### `manifest.json`

Small, loaded first, drives the timeline and the game list.

```jsonc
{
  "v": 1,
  "gamePk": 775302,
  "recordedAt": "2026-08-13T…",
  "source": "reconstructed",              // or "timecode"
  "game": { "date": "2025-10-01", "venue": "Dodger Stadium",
            "home": {"id":119,"abbrev":"LAD","score":6},
            "away": {"id":137,"abbrev":"SF","score":3} },
  "frameCount": 742,
  "durationMs": 10842000,
  "frames": [ { "i": 1, "t": 21400, "inning": 1, "isTop": true,
                "atBatIndex": 0, "playComplete": false, "scoring": false } ],
  "markers": [ { "t": 0, "kind": "half", "label": "Top 1" },
               { "t": 1284000, "kind": "scoring", "label": "Betts homers (2)",
                 "score": {"home":2,"away":0} } ]
}
```

`frames[]` is the seek index — one small row per frame, ~40 bytes. `markers[]`
is what the scrub bar draws: half-inning boundaries and scoring plays.

## The recorder

`scripts/record-game.ts`, run manually:

```bash
npm run record -- --date 2025-10-01 --list   # find a finished game's gamePk
npm run record -- 775302                     # record + validate, write locally
npm run record -- 775302 --out /tmp/rec      # write somewhere else
npm run record -- --from feed.json           # re-record from a saved feed
npm run record -- 813024 --label "2025 World Series Game 7"   # name it
```

Output lands in `public/recordings/v1/<gamePk>/` by default, which is where the
app will read recordings from in local development. `--upload` arrives with the
S3/R2 work in Phase 4.

A game that is not final is refused unless `--force` is passed: retroactive
recording expects the whole game to be in the document.

It runs in **two tiers**, and the reason matters: the high-fidelity path depends
on an upstream capability we should not assume works until we have watched it
work. The recorder therefore ships with a path that cannot fail as the default.

### Tier 1 — reconstruction from the final feed (default, ships first)

**One HTTP request.** Fetch the completed game's feed once. A finished GUMBO
document already contains the entire game *and its timing*: every
`playEvents[].startTime` / `endTime` and every `play.about.startTime` /
`endTime` is a real ISO timestamp — all already present in `lib/mlb/types.ts`.

The recorder walks the final feed forward and re-derives what the feed looked
like at each moment: truncate `allPlays` to the plays that had started, truncate
the last play's `playEvents` to the pitches that had been thrown, blank
`result`/`runners` on the in-flight play (`{ type: "atBat" }`), and roll the
linescore and score back to that point.

To keep the animation path honest, it also **synthesizes the publication lag**
the renderer's `hold` logic exists to absorb: the pitch that ends an at-bat gets
a frame of its own, and the play's result appears in the *next* frame, ~1.5s
later — mirroring what MLB actually does and what `deciderIndex()` /
`HOLD_TIMEOUT_MS` in `lib/game/events.ts` are written against.

Cheap, reliable, works for any game ever played, and delivers everything the
demo game lacked: real players, real Statcast coordinates, real substitutions,
real spray charts, real pacing.

One wrinkle real feeds carry: MLB hangs pregame `game_advisory` events off the
first play, stamped when the lineups went up — in one recorded game, 2h24m
before anyone threw a pitch. The recording is anchored on the first pitch and
opens on the state just before it, so the first pitch of the game animates
rather than being swallowed by the store's cursor seed. Get this wrong and a
nine-inning game reports a five-and-a-half-hour duration.

The linescore is the part that has to be exact, and is. `buildSnapshot` reads
the whole defensive alignment, the batter, the runners, the count and the score
off `linescore`, so a naive slice of the final feed would stand the closer on
the mound in the first inning. Defense is rebuilt from the starting nine and
walked forward through substitutions; the pitcher comes straight off each play's
`matchup`, which is exact by construction. Runners come from walking each
completed play's `runners[].movement`, and balls and strikes are recounted from
the revealed pitches the same way `lib/game/events.ts` recounts them.

**Fidelity gap:** the boxscore is the one thing that cannot be sliced — MLB
publishes it only in its final state, so per-player stat lines read as
end-of-game throughout. Nothing on the field is wrong, only the numbers beside a
name in the HUD and the Lineup panel. Mid-game feed corrections are likewise
invisible. Recorded in the manifest as `"source": "reconstructed"`.

### Tier 2 — timecode walk (higher fidelity, add once verified)

MLB publishes a timecode index for completed games:

- `GET /v1.1/game/{pk}/feed/live/timestamps` → every timecode (`YYYYMMDD_HHMMSS`)
- `GET /v1.1/game/{pk}/feed/live?timecode=…` → the full feed as of that instant
- `GET /v1.1/game/{pk}/feed/live/diffPatch?startTimecode=…&endTimecode=…` → deltas

The recorder pulls one keyframe, then walks the timecode list via `diffPatch`,
materializing each intermediate feed and keeping the ones whose fingerprint
changed. This captures the byte-for-byte truth including publication lag and
in-game corrections, with `"source": "timecode"` in the manifest.

**Verify before building on it.** These endpoints are undocumented and known to
be quirky — `diffPatch` sometimes returns a whole feed instead of a patch when
the span is too wide or the start timecode is too old. The walker must sniff the
response (`Array.isArray` → patch, `{gameData,liveData}` → keyframe) and fall
back to a full re-fetch. Requests should be sequential with a small delay and
resumable from a timecode, so a ~2,000-request run is a polite neighbour and
does not restart from zero on a network blip.

The recorder needs outbound access to `statsapi.mlb.com`; sandboxed CI runners
and locked-down environments generally will not have it. It is an offline tool,
run by hand, and nothing at runtime depends on it.

### Validation pass

The recorder checks its work twice before writing anything.

**Against the normalizer** (`validate.ts`) — it walks the frames exactly the way
`gameStore.ingest` does: seed the cursor off the first frame, then
`extractEvents` forward. It asserts that every frame builds a `GameSnapshot`
without throwing, that no at-bat is pitched but left unresolved, that time never
runs backwards, and that the last frame's score matches the feed's.

**Against its own bytes** (`verifyEncoding`) — it replays the encoded keyframe
and patches back into frames and compares fingerprints. A recording is never
published on the strength of the objects in memory, only on what will actually
be read back.

It then prints a summary — frames, at-bats, pitches, plays, duration, size,
compression ratio — and refuses to write if either check fails. With no test
suite in the repo, this is what makes a recording trustworthy enough to be a
fixture.

## Storage

**Runtime reads need no AWS SDK.** Recordings are immutable public artifacts, so
the app fetches them over plain HTTPS from a public bucket / R2 custom domain:

```
RECORDINGS_BASE_URL=https://recordings.example.com     # or R2 public bucket
```

Only the recorder script writes, and it uses `@aws-sdk/client-s3` as a
**devDependency**. That split keeps the runtime bundle free of a ~2 MB SDK and
lets a CDN serve the bytes.

Recorder-only env: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (R2),
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Documented in a new `.env.example`.

**Local development** needs no bucket at all: point `RECORDINGS_BASE_URL` at
`/recordings` and drop a recording into `public/recordings/`. Same code path, no
credentials. The storage layer is, deliberately, just a base URL.

*If the bucket must be private*, add a small presign route
(`@aws-sdk/s3-request-presigner`) that 307-redirects
`/api/replay/[gamePk]/frames` to a signed URL. Worth avoiding unless required —
public immutable objects behind a CDN are simpler and faster.

Uploaded with `Cache-Control: public, max-age=31536000, immutable` and
`Content-Encoding: gzip`. Recordings never change; the version lives in the path.

## Playback in the app

### New: `src/lib/replay/`

| File | Responsibility | Status |
| --- | --- | --- |
| `format.ts` | `FrameLine`, `RecordingManifest`, `FRAME_FORMAT_VERSION`, `frameFingerprint`; the shared contract between recorder and player. Imported by the script too. | done |
| `reconstruct.ts` | `reconstructFrames(finalFeed)` → the Tier-1 rebuild: plays and pitches revealed in order, linescore rolled back to match. | done |
| `encode.ts` | `dedupeFrames`, `encodeFrames`, `buildManifest`, `verifyEncoding`. | done |
| `validate.ts` | `validateFrames()` — walks a recording through the real normalizer the way the store does. | done |
| `source.ts` | `loadRecording(gamePk)` → `RecordingPlayer`, which walks one document forward with patches. Handles gzip and version checks. | done |
| `timeline.ts` | `buildAtBats`, `buildMarkers`, `atBatAtFrame`, `stepHalfInning`, and `REPLAY_BEATS` / `beatAfter` — the pacing floor. Pure, no React, no fetch. | done |

### New: `src/hooks/useReplay.ts`

The mirror of `useLiveFeed`, same job, no network. It loads the recording and
hands frames to `ingest(feed)` one at a time as the ballpark becomes ready.
Exposes `{ status, playing, frame, atBat, atBats, markers, play, pause, toggle,
seekAtBat, stepAtBat, stepHalfInning }`.

Critically it calls the **same `ingest`** the live path does, so `extractEvents`,
the `hold` logic, the director queue and the snapshot-promotion rule all run
exactly as in production.

**Pacing: there is no clock.** The first version of this drove a virtual clock
and pushed whichever frame the clock had reached. Gaps were clamped to ceilings
picked from the director's animation lengths, which was close but wrong in
principle and visibly wrong in practice: a home run's trot and celebration run
past four seconds, MLB's gap to the next pitch is often shorter, and the next
play would land on top of the one still finishing.

Now the recording waits for the ballpark, through two gates, neither of which is
a schedule:

1. **The director.** A frame is handed to `ingest` only once `director.isIdle()`,
   so a play can never be interrupted by the one behind it.
2. **A beat.** `beatAfter` in `timeline.ts` is a floor on the space between
   plays — 2.4s after a pitch, 2.0s after a completed play (which already has
   2.4–4.2s of hold inside its own animation), 4.0s across a half-inning break
   so the intermission card can be read.

The second gate exists because the first alone is too brisk: with nothing but
idle-gating the next pitch begins the instant the last one lands, which reads as
a highlight reel rather than a game. A beat can only ever make playback wait
longer, never cut an animation short, which is what separates it from the clock
it replaced. Measured: ~24s per plate appearance, so a 88-at-bat game runs about
35 minutes.

No ceilings to tune against animation lengths, no speed multipliers, no
true-timing toggle — "faster" could only mean cutting plays short again.

One case is deliberately neither busy nor owed a beat: while `cursor.hold` is
set the store parks a snapshot on purpose, waiting on a pitch's result.
Advancing is exactly what releases it, and resting there would pull apart the
pitch and its outcome that the hold exists to fuse into one motion.

Recordings still store real timestamps — they are what the game did — and
playback simply ignores them.

**Seeking** falls out of the existing design. The store's `ingest()` already has
a "first read" branch that jumps straight to the live edge via `seedCursor(feed)`
without replaying history — which is exactly seek semantics:

```ts
seek(t) → const feed = frameAt(t)
          reset()          // fresh Director, fresh Fx, empty cursor
          ingest(feed)     // first-read branch: applySnapshot + seedCursor
```

`reset()` in `store/gameStore.ts` already builds a new `Director` and rewires
`onCount` / `onPlayResolved` / `onSound`; `Director.clearQueue()` already calls
`this.fx.clear()`. `Actors` in `Scene.tsx` re-reads `director.actors` whenever
`snapshot` changes, so a new director's roster renders correctly on the next
frame. **No director changes are needed for seeking to work** — one frame of
empty field during the cut, which reads as an intentional discontinuity.

The store needs one small addition: a `seek(feed)` action that composes
`reset()` + `ingest(feed)` in a single set, so React sees one transition rather
than two.

### New: `src/components/hud/Timeline.tsx`

Rendered only in replay mode, along the bottom above the existing controls:

- **Scrub bar** over plate appearances, with half-inning boundaries as ticks and
  scoring plays as accented dots, both from `manifest.markers[]`. Hover a marker
  for its label. Dragging lands on the start of an at-bat, never mid-play.
- Play/pause, labelled **◀ At-bat / At-bat ▶** and **⏮ Inning / Inning ⏭**.
- A readout of the half-inning and "At-bat 42 / 88".

Plain DOM over the canvas, matching the existing HUD idiom.

### Routes

| Route | Behaviour |
| --- | --- |
| `/watch/[gamePk]?replay=1` | Replay mode. `?at=<n>` opens on the nth plate appearance, 1-based. |

A recorded game is by definition finished, so `?replay=1` can never collide with
the same `gamePk` being live. `Viewer` takes a `mode` of `"live" | "replay"` and
picks a driver; both hooks are always called, with the inactive one disabled,
since a hook cannot be conditional.

`GameList.tsx` grows a **Recorded games** section, fed by
`loadRecordingIndex()`. `summarizeRecording()` in `lib/game/schedule.ts` maps an
index entry onto the same `GameSummary` the schedule uses, so club colours come
from the same `paletteFor` and the existing `GameCard` renders it. Recorded
games are always clickable, unlike finished live games.

**No API routes.** The design originally called for `/api/replay`,
`/api/replay/[gamePk]` and `.../frames`. They would be pure pass-throughs:
`public/recordings/` is already served at `/recordings`, and a *public* bucket
or CDN is reached by pointing `NEXT_PUBLIC_RECORDINGS_BASE_URL` at it, with no
code change. Only a **private** bucket needs a route, to presign — so the routes
are deferred to Phase 4, and only if that is the shape chosen.

### Files touched

| File | Change |
| --- | --- |
| `src/lib/replay/{format,reconstruct,encode,validate}.ts` | New. Done in Phase 1. |
| `src/lib/replay/{source,timeline}.ts` | New. Done in Phase 2. |
| `src/hooks/useReplay.ts` | New — mirrors `useLiveFeed.ts`. Done in Phase 2. |
| `src/components/hud/Transport.tsx` | New — play/pause, at-bat and inning stepping, marked scrub bar. |
| `src/app/api/replay/**` | Not built; see "No API routes" above. |
| `scripts/record-game.ts` | New — the recorder and validator. Done in Phase 1; `--upload` lands in Phase 4. |
| `src/store/gameStore.ts` | `seek(feed)` — composes the existing `reset` + `ingest`. Done in Phase 2. |
| `src/components/Viewer.tsx` | Takes `mode: "live" \| "replay"`, picks the driver, renders `<Transport/>` in replay. |
| `src/app/watch/[gamePk]/page.tsx` | Reads `?replay=1` and `?at=`, passes `mode`. |
| `src/components/GameList.tsx` | Recorded-games section, via `loadRecordingIndex()` and `summarizeRecording()`. |
| `package.json` | `+ tsx` (dev) and `+ fast-json-patch` (runtime, ~10 KB) — both done in Phase 1, along with the `record` script. `+ @aws-sdk/client-s3` (dev) in Phase 4. |
| `docs/ARCHITECTURE.md`, `README.md` | Document `lib/replay/`, the format, the recorder. |

**Reused, not rebuilt:** `buildSnapshot` / `buildHistory` (`lib/game/normalize.ts`),
`extractEvents` / `seedCursor` (`lib/game/events.ts`), `Director.applySnapshot` /
`clearQueue` (`lib/anim/director.ts`), `summarizeGame` / `sortGames`
(`lib/game/schedule.ts`), and `isFinalStatus` / `fetchLiveFeed` /
`fetchSchedule` (`lib/mlb/client.ts`).

On dependencies: this repo is deliberately lean (7 runtime deps). The one runtime
addition is `fast-json-patch` for `applyPatch`. If even that is unwanted, the
subset of RFC-6902 the recorder emits (`add` / `remove` / `replace`) is ~80 lines
to apply by hand — worth doing only if the dependency is genuinely objectionable.

## Phasing

**Phase 1 — Record. ✅ Done.** `format.ts`, `reconstruct.ts`, `encode.ts`,
`validate.ts` and `scripts/record-game.ts`. A game is written to disk as a
validated keyframe-plus-patches stream with a manifest, and the run prints a
size and frame report. No app changes; nothing plays back yet.

**Phase 2 — Replay. ✅ Done.** `source.ts`, `timeline.ts`, `useReplay.ts`, the
`seek` store action, the `Viewer` mode switch, `hud/Transport.tsx` and the
`GameList` section. A real recorded game plays end to end with play/pause, seek
and speed. **This is the milestone that retired the demo game**, which has since
been deleted along with `lib/sim/`. The clock it shipped with was replaced in
Phase 3.

**Phase 3 — Timeline. ✅ Done.** The marked scrub bar, at-bat and half-inning
stepping, and the removal of the clock: playback is paced by `director.isIdle()`
rather than by time, which is what stopped celebrations being cut off. Speed
multipliers and the true-timing toggle went with it.

**Phase 4 — S3/R2.** Bucket, `--upload`, `RECORDINGS_BASE_URL`, `index.json`,
`.env.example`, docs. Deliverable: recordings shared across devs and deploys.

**Phase 5 — Tier 2 recorder.** Only after the timecode endpoints are confirmed
by hand. Same output format, `"source": "timecode"` — Phases 2–4 need no changes.

Phases 1–3 need no credentials and no bucket, so the whole feature is provable
before any infrastructure exists.

## Verification

**Recorder** (needs a machine with `statsapi.mlb.com` reachable):

```bash
npm run record -- --date 2025-10-01 --list   # pick a completed game
npm run record -- 775302
```

Expect: validation passes, the final score matches the feed, and a size report
around 215–240 KB gzipped for ~510–560 frames. A nine-inning game should report a
real duration near 3 hours — a much larger number means the clock is anchored
somewhere other than the first pitch. Record a game with a known-awkward event
too — extra innings, a rain delay, a position player pitching — and confirm it
validates.

### Recorded games

Committed under `public/recordings/v1/`:

| gamePk | Game | Why it's here |
| --- | --- | --- |
| `813024` | LAD 5 @ TOR 4 | **2025 World Series Game 7**, labelled as such in the manifest. Eleven innings — 559 frames, 99 at-bats, 364 pitches — so it exercises extra innings, which nothing else here does. |
| `824561` | CIN 9 @ CWS 8 | High-scoring one-run game: 88 at-bats, 343 pitches, 12 pitchers. The busiest substitution path available. |
| `823215` | WSH 10 @ SF 11 | A slugfest at Oracle Park: 84 at-bats, 344 pitches, 33 markers — the most scoring plays of the three. |

**Replay:**

```bash
npm run dev
open 'http://localhost:3000/watch/775302?replay=1'
```

Check, in order:

1. The game starts from the top of the 1st and plays continuously.
2. Pitches, hits and runners animate, with real spray angles and pitch types.
3. Scorebug, play log and lineup track the field; the count advances with the
   pitch, not ahead of it.
4. Scrub to the bottom of the 7th → the field cuts, and HUD, lineup and play log
   all agree with that moment. Scrub backward → same. Stepping by at-bat and by
   half-inning both land on the start of a plate appearance.
5. Click a scoring marker → the play animates from its start, not from its
   aftermath.
6. Speed 4x → animations still complete; nothing clips.
7. `?replay=1&at=3600` deep-links an hour in.
8. Play to the final out → the `GameOver` card shows the real final score.

**Regression:** a live game (in season) must behave exactly as before — the live
path is untouched apart from `useLiveFeed`'s `enabled` flag.

**Checks:** `npm run lint` and `npm run build` clean. The repo has no test suite;
the recorder's validation pass is the closest thing this feature has to one, and
`lib/replay/timeline.ts` is written pure so a test runner can be added later
without restructuring.

## Risks & open questions

| Risk | Mitigation |
| --- | --- |
| Timecode endpoints undocumented and quirky | Tier 1 needs none of them; Tier 2 is Phase 5, gated on hand-verification. |
| ~~Recording sizes larger than estimated~~ | Settled: 215–240 KB gzipped per game, roughly a tenth of the estimate. Committing recordings to the repo is comfortable at this size. |
| Materializing ~500 frames janks the browser | Measure in Phase 2. If it hurts: materialize lazily around the playhead and keep periodic keyframes in the file (every 100th frame) so seeking never walks far. Design the format with room for keyframes now. |
| A `reset()` per seek flashes an empty field | One frame, reads as a cut. If objectionable, the lighter `clearQueue()` + `applySnapshot()` path is available without a format change. |
| MLB rate-limits a 2,000-request Tier-2 run | Sequential with delay, resumable, and it only ever runs offline against finished games. |
| GUMBO shape drifts between seasons | `v` in the format; the recorder validates against the current normalizer at record time, so a bad recording is caught at creation, not at playback. |

Open questions:

- Bucket public or private? Public + CDN is assumed above; private costs one
  presign route.
- With recordings this small, is S3/R2 still wanted at all, or is committing
  them to `public/recordings/` enough? Phase 4 is cheap either way, but three
  games cost 884 KB — the repo-bloat argument for object storage is weaker than
  it looked when the size was assumed to be 1–2 MB per game.
- An extra-inning game and one with a rain delay are still worth recording as
  fixtures; neither shape has been exercised yet.
- Should recordings expire? They are small and immutable; a lifecycle rule can
  be added later if the bucket grows.
