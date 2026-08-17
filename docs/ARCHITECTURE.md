# Repository structure

A map of the codebase: where things live, what each file is responsible for,
and which file to open for a given change.

This document covers **where**. The [README](../README.md) covers **why** — the
design reasoning behind the animation timing, the ballpark geometry, the
lighting model and the rest. Neither repeats the other.

## What this is

A Next.js app that renders a live MLB game as a low-poly 3D ballpark. It does
not simulate baseball. It reads MLB's public Stats API, normalizes the event
stream into its own vocabulary, and animates that.

```
statsapi.mlb.com
      │
      ▼
lib/mlb/          fetch + typed access to the raw GUMBO feed
      │
      ▼
lib/game/         GUMBO ──▶ GameSnapshot (world state)
                        └─▶ NormalizedEvent[] (what just happened)
      │
      ▼
lib/anim/         events ──▶ timed animations; owns every transform and pose
      │
      ▼
components/scene/ React Three Fiber; reads the director each frame
```

The boundary that matters: **the renderer never sees MLB's JSON.** Everything
downstream of `lib/game/` speaks in `GameSnapshot` and `NormalizedEvent`.

## Stack

| | |
| --- | --- |
| Framework | Next.js 16.3 (App Router), React 19.2 |
| 3D | three.js 0.185 via `@react-three/fiber` 9 + `@react-three/drei` 10 |
| State | zustand 5 |
| Styling | Tailwind CSS 4 (via `@tailwindcss/postcss`) |
| Language | TypeScript 5, `strict` |

`@/*` maps to `./src/*` (`tsconfig.json`). Scripts: `npm run dev`, `build`,
`start`, `lint`, `record`. No test suite — recorded games under
`public/recordings/` are how the animation path is exercised, and the recorder's
own validation pass is the closest thing to one.

## Directory map

```
src/
  app/          routes and API proxies (App Router)
  components/   React: HUD (DOM) and scene (R3F)
  hooks/        useLiveFeed and useReplay — the two feed drivers
  store/        zustand store; the snapshot-promotion rule lives here
  lib/
    mlb/        raw Stats API: client, response types, team palettes
    game/       normalization — GUMBO into this app's vocabulary
    anim/       the director, pitch shapes, particles
    field/      field math, park construction, sky and weather
    audio/      Web Audio synthesis
    replay/     recording format: reconstruction, encoding, validation
```

Roughly 15.4k lines across 56 source files. Two files dominate:
`lib/anim/director.ts` and `components/scene/Player.tsx`.

## Routes

| Route | File | Notes |
| --- | --- | --- |
| `/` | `app/page.tsx` → `components/GameList.tsx` | Today's slate. Only in-progress games are clickable. |
| `/watch/[gamePk]` | `app/watch/[gamePk]/page.tsx` → `components/Viewer.tsx` | The viewer. Server component; awaits `params`/`searchParams` (both are Promises) and hands plain props to the client. |
| `/watch/[gamePk]?replay=1` | same | Plays a recording from `public/recordings/`. `?at=<n>` opens on the nth plate appearance. |
| `/watch/[gamePk]/at/[atBatIndex]` | `app/watch/[gamePk]/at/[atBatIndex]/page.tsx` | The same recorded game, cued to one plate appearance by MLB's index for it. What the transport's share button hands out. |
| `/clip/[gamePk]/[atBatIndex]` | `app/clip/[gamePk]/[atBatIndex]/page.tsx` → `components/ClipViewer.tsx` | One play, on its own, ending on a share card. Works for live games as well as finished ones. |
| `GET /api/games` | `app/api/games/route.ts` | Today + yesterday's schedule, sorted live-first. Never 500s — on upstream failure it returns 200 with an `error` field so the page can still render. |
| `GET /api/game/[gamePk]` | `app/api/game/[gamePk]/route.ts` | Live-feed proxy. 3s in-memory cache keyed by `gamePk`, capped at 32 entries. |
| `GET /api/clip/[gamePk]/[atBatIndex]` | `app/api/clip/[gamePk]/[atBatIndex]/route.ts` | Cuts one plate appearance out of a game's feed and returns it in the recording format. 404 for a play that is missing or still in progress. |

The feed routes set `dynamic = "force-dynamic"` and `Cache-Control: no-store`.
`/api/clip` is the exception and caches hard, because a finished play never
changes again.
The browser never contacts `statsapi.mlb.com` directly; everything is proxied,
and no API key is involved.

`app/layout.tsx` types its props as `LayoutProps<"/">` — a globally available
route-aware helper, not an import.

## Key files

### The feed in

**`lib/mlb/client.ts`** — the only file that knows the Stats API's URLs.
`fetchSchedule()`, `fetchLiveFeed()`, `easternDate()` (MLB's schedule day runs
on US Eastern, so "today" is not the local date), and the `isLiveStatus` /
`isFinalStatus` predicates that decode MLB's status codes.

**`lib/mlb/types.ts`** — the slice of GUMBO actually read, with almost every
field optional. The feed's shape varies with game state and a missing field must
never take the viewer down.

**`lib/mlb/teams.ts`** — club colors keyed by MLB team id. Hardcoded because the
API does not publish them.

### Normalization

**`lib/game/types.ts`** — *read this first.* The vocabulary everything
downstream speaks:

- `GameSnapshot` — the renderer's whole view of the world: score, count,
  defense by position, batter, runners, box scores, conditions.
- `NormalizedEvent` — a union of `PitchEvent`, `PlayResultEvent`, `ActionEvent`,
  `InningChangeEvent`. `PlayResultEvent.kind` is the bucket the animator
  branches on (`home_run`, `double_play`, `sac_fly`, …).
- `FeedCursor` — how far through the feed the normalizer has read, including the
  `hold` that keeps a pitch back until its result arrives.

**`lib/game/normalize.ts`** — `buildSnapshot(feed)` and `buildHistory(feed)`.
Pure functions from a feed response to state; no incremental logic.

**`lib/game/events.ts`** — `extractEvents(feed, cursor)`: walks the feed forward
and emits what is new. The subtle part of the codebase. It re-counts balls and
strikes from the pitches rather than trusting the feed's `count` field (which is
documented inconsistently), and it decides which pitch ended an at-bat *before*
MLB publishes the result, so the pitch and its outcome can animate as one motion.

**`lib/game/schedule.ts`** — `summarizeGame()` / `sortGames()` for the home page.

### State and the polling loop

**`hooks/useLiveFeed.ts`** — polls `/api/game/[gamePk]`. Interval varies: 5s
live, 15s idle, 1.5s while a pitch is held waiting on its result.
Backs off on failure, re-polls immediately when the tab becomes visible, and
only surfaces an error after two consecutive failures.

**`store/gameStore.ts`** — the zustand store, and the invariant that makes the
whole thing work:

> `snapshot` is what the HUD shows. `pending` is what the feed says. A new
> snapshot is only promoted once the director's queue has drained.

That is why a home run plays as pitch → swing → flight → runners → score rather
than the scoreboard jumping and the field catching up. Two things deliberately
update early, via director callbacks, because they should track what is on
screen: `onCount` advances the count as each pitch resolves, and `onPlayResolved`
advances outs and score when a play's animation finishes.

### Animation

**`lib/anim/director.ts`** — the largest and most central file. It owns:

- `actors: Map<string, Actor>` — every figure's transform, pose and pose phase.
- The animation queue: `enqueue()`, `update(dt)`, `isIdle()`, `clearQueue()`.
- Compilation — `compilePitch`, `compileAtBat`, `compileResult`,
  `compileAction`, `compileInningChange` turn events into timed animations.
- The camera shot list — `desiredCamera(view)`, `cameraCut`, `cameraShake`.
- Callbacks out: `onCount`, `onPlayResolved`, `onSound`.

Timing constants live near the top with the reasoning attached (runner speed,
swing duration, throw release fraction, the plate-height mapping that fits a
real strike zone onto figures drawn at 2.4× life size).

**`lib/anim/views.ts`** — the four camera modes the viewer can pick between.
`broadcast` (the default) defers to the director's shot list; `home_plate` looks
out over the whole diamond from behind the plate, `umpire` is first-person, and
`sky` is near enough straight down. Each fixed one is a position, an aim, a lens
and how far its gaze pans after a ball hit away from it. Also the localStorage
helpers that remember the choice.

**`lib/anim/pitches.ts`** — per-pitch-type `drop` and `run`, in g, applied as
accelerations so the shape develops over the flight the way a real pitch does.

**`lib/anim/particles.ts`** — `Fx`: confetti, fireworks, dirt puffs and sprays,
beam-outs. Plain arrays advanced on the wall clock; touches no React and no
three.js beyond `Vector3`/`Color`.

### The field

**`lib/field/geometry.ts`** — the coordinate system everything else assumes.
Field math is in **feet**, as `lateral` (positive toward right field) and
`depth` (positive toward center); `fp(lateral, depth, height)` converts to
three.js world space. Also base positions, `wallDistance(theta)`, and the clamp
that stops a fielder chasing a ball through the wall.

**`lib/field/surfaces.ts`** — grass, foul ground, warning track and infield dirt
as `THREE.Shape`s in field space.

**`lib/field/park.ts`** — everything vertical (wall, seating bowl, light towers,
skyline) as a flat list of `Block`s for one `InstancedMesh`, plus `buildCrowd()`,
which seats a `Fan[]` against the same rows. Both come out of one pass and are
cached together: the crowd is laid out on the bowl's geometry, and building it
separately would mean writing that geometry down twice.

**`lib/field/sky.ts`** — `Conditions` (hour, cloud, precipitation, roof, wind)
and `skyLook()`, which turns them into a lighting rig: sun arc, color, fog,
whether the towers are lit. Also `parseWind()` and `parseLocalHour()`, which
decode MLB's phrasing.

### Rendering

**`components/Viewer.tsx`** — the client shell. Wires `useLiveFeed` to the
store, lays out the HUD, and loads the scene via `next/dynamic` with
`ssr: false` (three.js cannot render on the server).

**`components/scene/Scene.tsx`** — the `<Canvas>` and the two `useFrame` loops:
`Engine` advances the director and calls `settle()` when the queue drains;
`CameraRig` asks the director for the shot the chosen camera mode wants, cuts to
it, applies the shot's lens and widens framing on portrait viewports.

| Component | Draws |
| --- | --- |
| `Field.tsx` | The playing surface from `surfaces.ts`, plus mow stripes |
| `Park.tsx` | All of `park.ts` in one `InstancedMesh`, plus a tiny second one for lamp faces |
| `Crowd.tsx` | The spectators — body, head, eyes and two hair shapes as five `InstancedMesh`es, with an idle bob |
| `Backstop.tsx` | The dark scrim behind the plate; hidden for cameras standing behind it |
| `Player.tsx` | The jointed figures — two species on one skeleton, plus helmets, gloves, bat |
| `Ball.tsx` | The ball and its comet trail |
| `Effects.tsx` | Pushes `Fx` particles into instanced meshes |
| `Weather.tsx` | Rain and snow |
| `Shadows.tsx` | Contact blobs and the ground-occlusion band |
| `TowerLights.tsx` | Four spotlights after dark; two cast real shadows |
| `geometry.ts` | Rounded/chamfered boxes (three.js has none in core) |
| `textures.ts` | Canvas textures for jersey numbers and name plates |

HUD components are plain DOM over the canvas: `hud/Scorebug.tsx`,
`hud/Callout.tsx`, `hud/History.tsx`, `hud/GameOver.tsx`.

**`lib/audio/sfx.ts`** — the `sfx` singleton. Every sound is synthesized with
Web Audio primitives; there are no audio files. Cued off the animation clock, so
the crack lands with the swing rather than with the poll that reported it.

### Recording

Capturing a real game so it can be replayed, and playing it back. Design and
rationale live in [RECORDING.md](./RECORDING.md). Three real games are committed
under `public/recordings/`; `/watch/[gamePk]?replay=1` plays them.

**`lib/replay/format.ts`** — *read this first.* The on-disk contract shared by
the recorder and, later, the player: `FrameLine` (one keyframe then RFC-6902
patches), `RecordingManifest` (the seek index and scrub-bar markers), and
`frameFingerprint()`, which decides what counts as a frame — a frame is kept
only when something the renderer would react to changes.

**`lib/replay/reconstruct.ts`** — `reconstructFrames(finalFeed)`. A finished
GUMBO document carries the whole game *and* its timing, so one request is enough
to rebuild what the feed looked like at every moment: plays and pitches are
revealed in order and the linescore is rolled back to match. The linescore is
the part that matters — `buildSnapshot` reads the entire defensive alignment,
the batter and the runners off it, so a naive slice of the final feed would put
the closer on the mound in the first inning.

**`lib/replay/encode.ts`** — `dedupeFrames`, `encodeFrames`, `buildManifest`,
and `verifyEncoding`, which replays the encoded stream back into frames so a
recording is only ever published on the strength of the bytes that will be read,
not the objects in memory. Patches are diffed against JSON-normalized feeds
because `undefined` keys do not survive serialization.

**`lib/replay/validate.ts`** — `validateFrames()` walks a recording through the
real `buildSnapshot` / `extractEvents` exactly the way the store does. With no
test suite in the repo, this is what makes a recording trustworthy enough to use
as a fixture.

**`scripts/record-game.ts`** — the CLI (`npm run record`). Lists a day's games,
records one, or re-records from a saved feed with `--from`. Needs outbound
access to `statsapi.mlb.com`.

### Playback

**`lib/replay/source.ts`** — `loadRecording(gamePk)` → a `RecordingPlayer`.
Materializing every frame would be most of a gigabyte, so it keeps **one
document** and walks it with `applyPatch`, plus a checkpoint every 50 frames to
bound how far a backward seek has to rewind. Recordings live behind a base URL
and nothing else: `public/recordings/` is served at `/recordings`, and
`NEXT_PUBLIC_RECORDINGS_BASE_URL` repoints it at a bucket without a code change.

**`lib/replay/timeline.ts`** — indexes a recording by plate appearance:
`buildAtBats`, `buildMarkers`, `atBatAtFrame`, `stepHalfInning`. Also
`REPLAY_BEATS` — how long the park rests between plays. Pure functions; the
place to change pacing, or what the scrub bar can land on.

**`hooks/useReplay.ts`** — the mirror of `useLiveFeed`: same `ingest`, no
network and **no clock**. Two gates: the next frame goes over only once
`director.isIdle()`, so an animation is never interrupted by the one behind it,
and then only after `beatAfter` has elapsed, which is a floor on the space
between plays rather than a schedule. A held pitch is the one deliberate park
that counts as ready and skips the beat, since advancing is what releases it and
the hold exists to fuse a pitch to its outcome.

**`components/hud/Transport.tsx`** — play/pause, at-bat and half-inning
stepping, a scrub bar ticked with half-innings and scoring plays, and the share
button that hands out the plate appearance on screen.

### Sharing

Every play in the app has a permanent URL, and none of it is stored. A play is
`(gamePk, atBatIndex)` — MLB's own numbering, which `HistoryEntry.id` and
`AtBat.atBatIndex` already speak — so both share surfaces rebuild what they need
from the feed on request. There is no database, no publish step and no link rot.

**`lib/replay/clip.ts`** — `buildClip(feed, atBatIndex)`. The idea the whole
feature rests on: `reconstructFrames` works on a *live* feed as well as a final
one, and each plate appearance falls out of it as a contiguous run of frames
tagged with its `atBatIndex` — a set frame, one per pitch, then the result. That
run is the clip. It is trimmed so every frame carries only its own play (a
ninth-inning clip would otherwise haul ~690 KB of completed plays around) and
encoded with the ordinary `dedupeFrames`/`encodeFrames` path, so the client
plays it as a very short recording rather than down a second code path. Returns
null for a play still in progress: a clip has to know where it ends.

**`lib/share/atbat.ts`** — `fetchAtBatCard(gamePk, atBatIndex)`, everything a
share card or a clip page needs to describe one plate appearance. Reads
`/v1/game/{gamePk}/playByPlay` rather than the live feed, an order of magnitude
smaller, because a scraper is waiting on it. Carries the score both before and
after the play; the two cards want different ones.

**`lib/brand/playcard.tsx`** — the card both share links draw. Unlike the
whole-game card it carries the score, and the comment there explains why that is
not a contradiction: a plate appearance is a fixed historical fact, so it can be
cached hard *and* say more.

**`components/ClipViewer.tsx`** — a sibling of `Viewer`, not a mode of it. Keys
its ending card off `useReplay`'s `settled` rather than `ended`: the frame
carrying a home run is handed over as the pitch is released, and the swing,
flight, trot and celebration all happen after it.

The store gains one action for this: `seek(feed)`, which is `reset()` then
`ingest()`. A seek is a cut, and `ingest`'s first-read branch already jumps to
an arbitrary moment via `seedCursor` without replaying what came before.

## Conventions

- **Field math is in feet**, in `lateral`/`depth`. Convert with `fp()`. Do not
  hand-write world-space vectors.
- **`"use client"` starts at `Viewer`, `GameList`, the store and the hook.**
  Everything under `lib/game/`, `lib/mlb/` and `lib/replay/` is isomorphic; the API
  routes and both page components are server-side.
- **Animations run on the wall clock**, not accumulated frame deltas — a slow
  frame rate costs smoothness, not correctness. Both the director and `Fx`
  follow this.
- **The feed is authoritative and self-healing.** Anything the animation queue
  drops while catching up is corrected by the next promoted snapshot, so
  degrading under load is safe.
- **Missing feed fields are normal.** Guard rather than assert.

## Where to change what

| To change… | Open |
| --- | --- |
| How a play is interpreted | `lib/game/events.ts` |
| What the HUD knows about | `GameSnapshot` in `lib/game/types.ts`, then `normalize.ts` |
| Timing, pacing, poses, camera cuts | `lib/anim/director.ts` |
| Where the fixed camera modes sit | `lib/anim/views.ts` |
| How a pitch moves | `lib/anim/pitches.ts` |
| Field dimensions, base paths, wall shape | `lib/field/geometry.ts` |
| Stands, towers, skyline | `lib/field/park.ts` |
| Lighting, time of day, weather | `lib/field/sky.ts` |
| What a player looks like | `components/scene/Player.tsx` |
| Sounds | `lib/audio/sfx.ts` |
| Club colors | `lib/mlb/teams.ts` |
| Polling behaviour | `hooks/useLiveFeed.ts` |
| When state becomes visible | `store/gameStore.ts` |
| What a recording stores | `lib/replay/format.ts` |
| How a game is reconstructed from its final feed | `lib/replay/reconstruct.ts` |
| What makes a recording valid | `lib/replay/validate.ts` |
| How a recording is paced | `REPLAY_BEATS` in `lib/replay/timeline.ts` |
| What the scrub bar can land on | `lib/replay/timeline.ts` |
| Replay transport and seeking | `hooks/useReplay.ts`, `components/hud/Transport.tsx` |
| Where a clip starts and stops | `lib/replay/clip.ts` |
| How a clip is paced | `CLIP_BEATS` in `lib/replay/timeline.ts` |
| What a share card says | `lib/share/atbat.ts`, `lib/brand/playcard.tsx` |

## Notes

- `AGENTS.md` warns that this version of Next.js differs from what a model may
  have memorized, and points at `node_modules/next/dist/docs/`. Install
  dependencies before relying on framework conventions; the bundled docs are the
  authority, not recall.
- Known gaps in the simulation itself (no defensive shifts, generic park
  dimensions, no relays or rundowns) are listed at the end of the README.
