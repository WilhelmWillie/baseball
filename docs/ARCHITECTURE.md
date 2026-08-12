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
`start`, `lint`. No test suite — the simulated game at `/watch/demo` is how the
animation path is exercised.

## Directory map

```
src/
  app/          routes and API proxies (App Router)
  components/   React: HUD (DOM) and scene (R3F)
  hooks/        useLiveFeed — the polling loop
  store/        zustand store; the snapshot-promotion rule lives here
  lib/
    mlb/        raw Stats API: client, response types, team palettes
    game/       normalization — GUMBO into this app's vocabulary
    anim/       the director, pitch shapes, particles
    field/      field math, park construction, sky and weather
    audio/      Web Audio synthesis
    sim/        scripted demo game, emitted in GUMBO's shape
```

Roughly 11.1k lines across 43 source files. Two files dominate:
`lib/anim/director.ts` (1515) and `components/scene/Player.tsx` (1375).

## Routes

| Route | File | Notes |
| --- | --- | --- |
| `/` | `app/page.tsx` → `components/GameList.tsx` | Today's slate. Only in-progress games are clickable. |
| `/watch/[gamePk]` | `app/watch/[gamePk]/page.tsx` → `components/Viewer.tsx` | The viewer. Server component; awaits `params`/`searchParams` (both are Promises) and hands plain props to the client. |
| `/watch/demo` | same | `gamePk === "demo"` routes to the simulator. `?at=`, `?hour=`, `?wx=`, `?wind=` are read here. |
| `GET /api/games` | `app/api/games/route.ts` | Today + yesterday's schedule, sorted live-first. Never 500s — on upstream failure it returns 200 with an `error` field so the page can still render. |
| `GET /api/game/[gamePk]` | `app/api/game/[gamePk]/route.ts` | Live-feed proxy. 3s in-memory cache keyed by `gamePk`, capped at 32 entries. `demo` is intercepted here and served from `lib/sim/`. |

Both API routes set `dynamic = "force-dynamic"` and `Cache-Control: no-store`.
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
live, 15s idle, 1.8s demo, 1.5s while a pitch is held waiting on its result.
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
| `Crowd.tsx` | The spectators — body, head and hair as three `InstancedMesh`es, with an idle bob |
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

### The simulator

**`lib/sim/script.ts`** — a scripted 20 at-bats.
**`lib/sim/feed.ts`** — renders that script as a GUMBO-shaped response for an
elapsed time, so the demo exercises the same normalization and animation path a
real game does. `DEMO_GAME_PK = 747001`.

## Conventions

- **Field math is in feet**, in `lateral`/`depth`. Convert with `fp()`. Do not
  hand-write world-space vectors.
- **`"use client"` starts at `Viewer`, `GameList`, the store and the hook.**
  Everything under `lib/game/`, `lib/mlb/` and `lib/sim/` is isomorphic; the API
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
| The demo game's script | `lib/sim/script.ts` |

## Notes

- `AGENTS.md` warns that this version of Next.js differs from what a model may
  have memorized, and points at `node_modules/next/dist/docs/`. Install
  dependencies before relying on framework conventions; the bundled docs are the
  authority, not recall.
- Known gaps in the simulation itself (no defensive shifts, generic park
  dimensions, no relays or rundowns) are listed at the end of the README.
