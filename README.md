# MLB 3D

Pick a live MLB game and watch it unfold in a low-poly 3D ballpark. Pitches,
batted balls and baserunners are driven by the real MLB Stats API — the app
doesn't simulate baseball, it interprets MLB's event stream and animates it.

```
MLB Stats API → adapter → normalized events → animation queue → three.js
```

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

No API key is needed. The MLB Stats API is public, and all calls are proxied
through this app's own routes so the browser never talks to `statsapi.mlb.com`
directly.

## What's here

**Game selection** (`/`) — today's slate from `GET /api/v1/schedule`, live games
first. If nothing is in progress it says so plainly and offers the simulated
game instead.

**Live viewer** (`/watch/[gamePk]`) — a 3D ballpark with the nine defenders in
their positions, the batter, on-deck hitter and baserunners. The home club take
the field as aliens 👽 and the visitors as robots 🤖, in their real team colors,
so who is who reads instantly. The scorebug carries score, inning, count, outs,
bases, batter and pitcher.

**Game log** — the last play sits under the scorebug; hover it to open the full
log, grouped by half-inning with the running score, scoring plays highlighted.
Click to pin it open.

**Celebrations** — confetti erupts over home plate on every run scored, with
fireworks over the outfield. Home runs get a bigger volley.

**Final screen** — when the game goes final, a card shows the result, the
inning-by-inning line score, and both clubs' box scores (batting and pitching,
with W/L/S decisions). It can be dismissed to keep watching the park.

**Sound** — bat crack, mitt pop, pitch whoosh, firework booms and a crowd that
swells on hits and erupts on home runs, over a continuous low murmur. Everything
is synthesized with Web Audio; there are no audio files. Sounds are cued off the
animation clock, so the crack lands with the swing rather than with the poll that
reported it. Browsers block audio until the page is interacted with, so the first
click anywhere starts it. The 🔊 button mutes.

**Snapshot** — the 📸 button composites the current frame with a baked-in
scorebug and hands you a PNG (shared via the Web Share API on mobile, copied to
the clipboard and downloaded elsewhere).

**Simulated game** (`/watch/demo`) — a scripted game emitted in the exact shape
of MLB's GUMBO feed, so it exercises the same adapter and animation path a real
game does. Useful in the off-hours, and it's how the animation work was
verified. `?at=<seconds>` jumps part-way in.

## Architecture

The renderer never sees MLB's JSON. Two layers sit in between:

| Layer | Location | Job |
| --- | --- | --- |
| Adapter | `src/lib/mlb/` | Typed access to the schedule and GUMBO live feed |
| Normalization | `src/lib/game/` | GUMBO → `GameSnapshot` (world state) + `NormalizedEvent[]` (what just happened) |
| Animation | `src/lib/anim/director.ts` | Compiles events into timed animations; owns every actor's transform and pose |
| Scene | `src/components/scene/` | React Three Fiber; reads the director each frame |

### State never teleports

`useLiveFeed` polls `feed/live` every ~5s while a game is live. New play events
are appended to the director's queue; the freshly built snapshot is held as
`pending`. Only once the queue drains does it get promoted to the visible
snapshot. So a home run plays as pitch → swing → ball flight → runners → score,
rather than the scoreboard jumping and the field catching up.

Two things update earlier on purpose, because they should track what's on
screen: the count advances as each pitch animation resolves, and outs/score
advance when a play's animation finishes.

If the app falls behind (hidden tab, feed hiccup), the queue guard drops
pitch-by-pitch detail and keeps the outcomes, then re-syncs to the feed.

Animations are timed against the wall clock rather than accumulated frame
deltas — a slow frame rate costs smoothness, not correctness.

### Coordinates

Field math is in **feet**, using `lateral` (positive toward right field) and
`depth` (positive toward center). `fp(lateral, depth, height)` converts to
three.js world space. Everything else — fielding spots, base paths, hit
coordinates, the wall profile — is expressed in those terms in
`src/lib/field/geometry.ts`.

Gameday's 2D hit coordinates (`hitData.coordinates`) are mapped back to feet
with the long-established `(coordX - 125.42) * 2.29` conversion. When a play has
no usable coordinates, a trajectory is synthesized from the play description
("to left center field") using a stable hash, so a given play always looks the
same.

### The ballpark

The playing surface is shaped geometry, not a grid: `src/lib/field/surfaces.ts`
builds the grass, foul ground, warning track and infield dirt (an arc centred on
the mound with the grass diamond punched out of it) as `THREE.Shape`s in field
space, which `Field.tsx` turns into flat meshes. Mow stripes come from a
repeating texture rather than per-tile color.

Everything vertical — outfield wall, the raked seating bowl, the crowd, light
towers, the center-field scoreboard — is generated in `src/lib/field/park.ts` as
a flat list of boxes and drawn by `Park.tsx` in a single `InstancedMesh`, so the
whole stadium costs one draw call.

Players are low-poly figures with jointed knees and elbows. Two species share
one skeleton — aliens for the home club, robots for the visitors — so the whole
pose vocabulary drives both. Uniforms come from a hardcoded palette keyed by MLB
team id (the API doesn't publish club colors); if both clubs' primaries are too
close to tell apart, the visitors fall back to their secondary. Species is a
second, redundant read on who is who.

### Celebrations

`src/lib/anim/particles.ts` is a small particle system: confetti as tumbling
paper with flutter, and fireworks as shells that climb, burst into sparks, and
fall. `Effects.tsx` pushes both into instanced meshes each frame — one draw call
each. Like the director, it advances on the wall clock rather than the frame
delta, so a slow frame rate costs smoothness instead of leaving confetti hanging
in mid-air.

The scene renders at full device resolution with antialiasing and a single
shadow-casting sun.

### Cameras

Broadcast (behind the plate, framed on the diamond), ball-tracking (drifts
toward the ball but keeps the diamond in frame), wide (home runs and inning
changes), and a free orbit camera behind the AUTO CAM / FREE CAM toggle.

### Pacing

Runners cover a base in 1.9s (2.7s on a home-run trot) — quicker than life, slow
enough to follow. Real games leave ~20s between pitches, which is plenty of room;
the simulated game paces itself to match so its animations are not clipped.

## Known gaps

- Defensive shifts aren't modelled; fielders stand in standard positions.
- There are no dugouts or bench figures in the 3D scene; the bench is listed in
  the LINEUP panel instead.
- The simulated game runs a scripted 20 at-bats, so it ends after two innings.
- Every park uses the same generic dimensions rather than the real venue's.
- Fielders converge on the ball and throw, but relays and rundowns are a single
  generic throw.
- A game in `Preview` state has no lineup in the feed yet, so the park renders
  empty until first pitch.
