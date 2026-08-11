# Ballpark

**Watch baseball come to life.** Pick a game. Grab a seat. Watch every pitch,
hit, and baserunner unfold in a charming low-poly ballpark.

Everything on the field is driven by the real MLB Stats API — the app doesn't
simulate baseball, it interprets MLB's event stream and animates it.

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
first. Only games actually in progress open: a game before first pitch has no
lineup in the feed and one that has finished has nothing left to animate, so
those cards are shown but not clickable. If nothing is in progress it says so
plainly and offers the simulated game instead.

**Live viewer** (`/watch/[gamePk]`) — a 3D ballpark with the nine defenders in
their positions, the batter, on-deck hitter and baserunners. The home club take
the field as aliens 👽 and the visitors as robots 🤖, in their real team colors,
so who is who reads instantly. The stands wear the home club's colours too, with
a visible minority in the visitors' and the rest in neutral street clothes. The
scorebug carries score, inning, count, outs, bases, and a line for each of the
two players who matter: the hitter's season average and what he has done today,
the pitcher's ERA, pitch count, innings and strikeouts.

**Game log** — the last play sits under the scorebug; hover it to open the full
log, grouped by half-inning with the running score, scoring plays highlighted.
Click to pin it open.

**Time of day and weather** — the feed reports first pitch and what the sky was
doing, and the park is lit from it. A 1:05 start plays under a high sun, a 7:05
one runs into golden hour and then to a night game under the tower lights, and
an overcast day is flat and grey. Rain and snow fall, wind blows the confetti
and the dust downfield, and a closed roof gets its own indoor rig. The scorebug
prints the conditions it is lighting from.

**Celebrations** — the park celebrates its own club only: confetti over the
plate and fireworks over the outfield when the *home* side scores, and nothing
but a groan when the visitors do. Home runs get a bigger volley. Dirt sprays off the
first hop, dust hangs where a runner slides in, and the mound puffs as the
pitcher lands. Anyone retired beams out: a column of motes in their club's
colour, and the figure shrinks up into it.

**Final screen** — when the game goes final, a card shows the result, the
inning-by-inning line score, and both clubs' box scores (batting and pitching,
with W/L/S decisions). It can be dismissed to keep watching the park.

**Sound** — bat crack, mitt pop, pitch whoosh, firework booms and a crowd with
an allegiance: it is the *home* crowd, so it cheers what helps the home club
and groans at everything else. A strikeout by the home pitcher gets a cheer;
a home run by the visitors gets a groan. Everything
is synthesized with Web Audio; there are no audio files. There is no continuous
ambience bed — see the TODO in `src/lib/audio/sfx.ts`, which wants real recorded
material rather than the filtered noise that used to sit there. Sounds are cued off the
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

The call itself waits too. Naming a play the instant it starts gives away every
outcome worth watching — a double play, a triple, a ball off the wall — so the
callout is cued to the moment the diamond has settled it: when the last runner
stops, or when the throw arrives. A home run is the one exception, since it is
decided the moment the ball clears the wall.

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
the tower lights can burn unlit by the sun after dark. Two rules keep a bowl of
several thousand boxes from tearing itself apart: how many spectators a row
holds is derived from the arc that row actually spans, rather than being a fixed
count crammed into whatever width is available; and row blocks are cut deeper
than the gap between rows, because boxes that interpenetrate look solid while
boxes whose faces land on exactly the same plane flicker. Foul ground
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
mound.

Nobody bends their knees to stand. A knee angle on this rig swings the shin
backwards, heel toward the butt, so "a little soft" on a standing figure reads
as a half-kneel — the athletic look has to come from the forward lean, the
weight shift and the breath instead. Where a figure genuinely does sit — a
hitter's stance, a fielder reaching for a ball — the hip flexes first and the
knee brings the shin back to vertical, which is how a crouch actually works.

The batting stance needed a joint the rig did not have. With only a shoulder
spread to work with, the only way to bring two hands onto one bat is to rotate
both arms inward, which buries the upper arms inside the ribcage and leaves the
forearms sprouting from the sternum. Adding an inward swing at the *elbow* lets
the upper arms hang outside the body where they belong; the stance angles are
then solved numerically against the chest volume rather than guessed.

Between pitches the idle has two layers. Underneath, continuous detuned waves —
breath, weight shift, a head that wanders. On top, occasional gestures on their
own slow cycles: rocking onto the other foot, a sharp glance somewhere, a little
reset hop, a glove adjustment. The gestures are what stop a field of nine from
reading as nine copies of the same sine wave.

Players react to what just happened, too: a pitcher who has given up a hit puts
his hands on his hips and shakes his head, and a hitter who pulls up safe at a
bag throws his fists up and then turns to clap toward the dugout.

Only hitters and runners wear anything on their heads — a cap perched on a
tapered alien cranium never sat right. What they wear is a real batting helmet,
built in a frame whose **origin is the rim**: the caller drops it at the height
where the helmet should stop and the face begins, and a `height` factor stretches
the shell over however much skull is above that line. That is what makes it
fittable to two very different heads, and the fit is solved against the actual
skull geometry rather than by eye — an alien cranium rises a full unit above the
eyes and needs a tall shell, while a robot's box head has barely any headroom
above the visor but needs a wide one, because containing a box's top corners in
an ellipsoid costs width. Add a trim rim picking the shape out, a raised centre
ridge with vents either side, and a brim on the rim line angled down over the
brow, matte black underneath the way a real one is to cut glare. Hitters wear a
single ear flap on the side turned toward the pitcher, runners a double.
Antennae route out through the back rather than straight up through the crown.

Gloves are built rather than approximated — fanned finger stalls, a laced
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

After dark the field is lit from the four towers you can actually see rather
than from one light overhead: `TowerLights.tsx` hangs a spotlight on each,
aimed across the field rather than at the middle so the beams cross and cover
it evenly. Two of the four cast real shadows, which is what gives every player
the two or three faint shadows fanning out in different directions that say
"night game" more than darkness does.

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

Broadcasts do not glide between angles — they cut - and they change lenses to
say something about the moment. The director owns a shot list: **broadcast**
behind the plate, **slot** over the catcher on any two-strike pitch, **mound** on
a long lens every fourth pitch (cut back at release so the pitch stays
trackable), **ball** tracking a batted ball, **low** at field level down the
third-base line off a home run or a triple, **wide** as the ball leaves the park,
and **follow** travelling with the runner on the trot. Each shot holds for a
minimum time so nothing strobes when several things happen at once, and hard
contact knocks the lens for about half a second. There is no manual camera: the
shot list covers the game better than dragging an orbit control does.

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

The whole point of the animation is that a viewer can follow what happened, so
everything runs slower than the physics would give. A fly ball hangs for 3.4s, a
home run 4.2s; hang time is the part of a batted ball you actually read — where
it is going, who is chasing it, whether it will drop. Runners cover a base in
2.6s (3.4s on a home-run trot). A double that is over before you have found the
ball has not communicated anything.

Real games leave ~20s between pitches, which is plenty of room; the simulated
game paces itself to match so its animations are not clipped.

### Walks, strikeouts and who is actually running

The feed lists a strikeout as the batter being put out, which is true but not
what it looks like: he does not run to first and get called out there, he
leaves the box. Batter tracks are dropped on a strikeout, and the beam-out plays
at the plate instead.

A walk is not a race either — the batter drops the bat and strolls down at
4.2s per base, in a gait of its own. And the map from a runner move to an actor
now only considers actors on the *batting* side that are not fielders, so a
stray id match can never put a defender on the basepaths wearing the wrong
uniform and the wrong species.

The bat is only visible in a batting pose, so it disappears the moment the
hitter leaves the box however he got on.

### A hit is not an out

Every batted ball used to end with the fielder playing a catch at the landing
spot, which made a clean single look exactly like a flyout. The ball now knows
whether it was caught: on a `field_out`, `double_play` or `sac_fly` off a ball in
the air it finishes at glove height and never touches the grass, and on anything
else it lands, takes two decaying hops while it rolls out, throws dirt, and is
run down and gathered before the throw. Runners who are out have their tracks
pushed past that moment, so a flyout cannot resolve while the ball is still up.

### On a phone

The scoreboard becomes a full-width band across the top and the controls move to
a bar along the bottom, where a thumb reaches them.


`fov` in three.js is vertical, so a tall narrow viewport sees a much *narrower*
slice of the world horizontally — on a portrait phone the diamond falls out of
frame at either side. `Framing` holds the horizontal field of view roughly
constant instead, widening the vertical one as the aspect narrows. That leaves a
lot of empty grass above and below, so the camera rig also pulls its framing in
toward the infield in proportion to how portrait the screen is.

The controls drop to their icons, the weather line and the connection badge are
dropped, and the log's hint says "tap" rather than "hover".

## Known gaps

- Defensive shifts aren't modelled; fielders stand in standard positions.
- There are no dugouts or bench figures in the 3D scene; the bench is listed in
  the Lineup panel instead.
- The simulated game runs a scripted 20 at-bats, so it ends after two innings.
- Every park uses the same generic dimensions rather than the real venue's.
- Fielders converge on the ball and throw, but relays and rundowns are a single
  generic throw.
- A game in `Preview` state has no lineup in the feed yet, so the park renders
  empty until first pitch.
