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

**Time of day and weather** — the feed reports first pitch and what the sky was
doing, and the park is lit from it. A 1:05 start plays under a high sun, a 7:05
one runs into golden hour and then to a night game under the tower lights, and
an overcast day is flat and grey. Rain and snow fall, wind blows the confetti
and the dust downfield, and a closed roof gets its own indoor rig. The scorebug
prints the conditions it is lighting from.

**Celebrations** — confetti erupts over home plate on every run scored, with
fireworks over the outfield. Home runs get a bigger volley. Dirt sprays off the
first hop, dust hangs where a runner slides in, and the mound puffs as the
pitcher lands.

**Final screen** — when the game goes final, a card shows the result, the
inning-by-inning line score, and both clubs' box scores (batting and pitching,
with W/L/S decisions). It can be dismissed to keep watching the park.

**Sound** — bat crack, mitt pop, pitch whoosh, firework booms and a crowd with
an allegiance: it is the *home* crowd, so it cheers what helps the home club
and groans at everything else. A strikeout by the home pitcher gets a cheer;
a home run by the visitors gets a groan. Everything
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
verified. `?at=<seconds>` jumps part-way in; `?hour=`, `?wx=` and `?wind=` put
it under any sky you like (`?hour=20.5`, `?wx=Rain&wind=14 mph, L To R`).

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

Everything vertical — outfield wall, the raked seating bowl, bleachers running
down both foul lines behind a low padded wall, the crowd, light towers and a
city skyline on three hazy rings beyond the park — is generated in
`src/lib/field/park.ts` as a flat list of boxes and drawn by `Park.tsx` in a
single `InstancedMesh` — plus a second, tiny one holding just the lamp faces, so
the tower lights can burn unlit by the sun after dark. Foul ground
tapers sharply past the bases, so the seats come right up against the lines
rather than leaving acres of empty dirt.

Players are low-poly figures with jointed knees and elbows, drawn at roughly
2.4x life size — they exist to communicate the state of the game from a camera
80 feet up, not to be anatomically sensible next to a 90-foot base path. Two
species share one skeleton — aliens for the home club, robots for the visitors
— so the whole pose vocabulary drives both. Panels are chamfered rather than
hard-edged (`components/scene/geometry.ts` builds rounded boxes from an
extruded, bevelled profile, since three.js has none in core), and they use
Phong shading so the directional lights give them a specular highlight.

Nobody stands still: between pitches everyone breathes, shifts their weight and
turns their head, on detuned waves seeded per player so no two are in step. The
catcher gets his own squat pose with the legs folded under him, facing the
mound. Gloves are built rather than approximated — fanned finger stalls, a laced
web, a padded heel — and they differ by position: a round mitt for the catcher,
presented down the arm at the pitcher, and a longer one at first.

The bat is hung on the point where the arm chain actually puts the hands —
`handAnchor()` walks the same shoulder/elbow offsets the model is built from and
returns the spot the two hands close on, so the grip can't drift out of sync
with the stance. It hangs off the torso rather than off an arm (a child of the
arm inherits the whole chain and ends up pointing into the batter's own back),
cocked up over the rear shoulder at rest and levelling off through the swing
while the torso twist carries it through the zone. The batter's arms barely
leave the stance during a swing, for the same reason: move them and the hands
visibly let go. Uniforms come from a hardcoded palette keyed by MLB
team id (the API doesn't publish club colors); if both clubs' primaries are too
close to tell apart, the visitors fall back to their secondary. Species is a
second, redundant read on who is who.

### Weather and light

`src/lib/field/sky.ts` turns the feed's start time and weather string into a
lighting rig: sun position on an arc, its colour and strength, ambient and
hemisphere fill, sky turbidity, fog, and whether the tower lights are on. Past
dusk it stops using the sky shader entirely — the Preetham model that shader
implements only describes a daylit atmosphere, and pushed past sunset it returns
a murky grey-brown rather than a night sky, so after dark the scene paints a flat
background and switches to a warm, near-shadowless tower rig.

Wind is parsed from MLB's phrasing ("8 mph, Out To CF") into a world-space
velocity, and everything light enough — confetti, dust, rain — drifts downwind.

### Celebrations

`src/lib/anim/particles.ts` is a small particle system: confetti as tumbling
paper with flutter, fireworks as shells that climb, burst into sparks, and
fall, and dirt in two flavours — a `puff` that swells and hangs where a runner
slides or a fielder brakes, and a `spray` thrown along a direction for the ball's
first hop and the hitter's back foot. `Effects.tsx` pushes both into instanced meshes each frame — one draw call
each. Like the director, it advances on the wall clock rather than the frame
delta, so a slow frame rate costs smoothness instead of leaving confetti hanging
in mid-air.

The scene renders at full device resolution with antialiasing and a single
shadow-casting sun.

### Cameras

Broadcasts do not glide between angles - they cut - and they change lenses to
say something about the moment. The director owns a shot list: **broadcast**
behind the plate, **slot** over the catcher on any two-strike pitch, **mound** on
a long lens every fourth pitch (cut back at release so the pitch stays
trackable), **ball** tracking a batted ball, **low** at field level down the
third-base line off a home run or a triple, **wide** as the ball leaves the park,
and **follow** travelling with the runner on the trot. Each shot holds for a
minimum time so nothing strobes when several things happen at once, and hard
contact knocks the lens for about half a second. FREE CAM hands an orbit camera
to the viewer.

Name plates scale down as the camera closes in - sprites otherwise grow with
proximity, and on a tight shot a plate would fill the frame.

### Grounding

The sun casts real shadows, but a 2048px shadow map spread over a whole park
cannot resolve the few inches directly under a player's feet, which is exactly
the part that says "standing on the ground". `Shadows.tsx` adds two cheap
passes: an instanced contact blob under every actor, and one under the ball that
spreads and fades with height - the cue that tells you how deep a fly ball is.
A vertex-alpha band follows `fieldRadius` around the edge of the field so the
grass does not meet the stands at a hard, evenly-lit seam.

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
