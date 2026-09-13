import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Ball } from "@/components/brand/Ball";
import { SEASON_OPENING_DAY } from "@/lib/game/schedule";
import closeUp from "./close-up.webp";

/**
 * The page that answers "what am I looking at".
 *
 * Everything else here is a way into a game; this is the one page that says
 * where the idea came from and what it is for, which is not much. Static and
 * server-rendered - it touches no feed and never changes.
 */
const title = "About Pocket Ballpark";
const description =
  "Where Pocket Ballpark came from, what it does with MLB's play-by-play, and what it is for — which is honestly not much.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-grass-deep">
        {heading}
      </h2>
      <div className="mt-3 space-y-4 text-base leading-relaxed text-bark-soft">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-paper bg-[radial-gradient(circle_at_12%_-8%,var(--color-grass-mist),transparent_60%)]">
      <div className="mx-auto w-full max-w-3xl px-5 pb-24 sm:px-8">
        <nav className="flex items-center justify-between py-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight"
          >
            <Ball className="h-8 w-8" />
            <span className="text-clay">Pocket</span>
            <span className="-ml-1 text-grass-deep">Ballpark</span>
          </Link>
          <Link
            href="/"
            className="rounded-full border-2 border-grass-deep/12 bg-card px-3 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep"
          >
            Find a game
          </Link>
        </nav>

        <header className="pb-2 pt-4">
          <p className="text-sm font-bold uppercase tracking-wide text-bark-soft">About</p>
          <h1 className="mt-1 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-grass-deep sm:text-5xl">
            A real baseball game,
            <br />
            in a toy ballpark.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-bark">
            Pocket Ballpark takes a game that is actually being played — or any game
            this season already played — and acts it out, pitch by pitch, with
            little aliens and robots in a 3D park. It is a pet project. That is the
            whole pitch.
          </p>
        </header>

        <figure className="mt-8">
          <div className="overflow-hidden rounded-[28px] border-2 border-grass-deep/12 bg-grass-mist lip">
            <Image
              src={closeUp}
              alt="A close view of the ballpark: an alien pitcher in Cubs blue on the mound, his alien catcher crouched behind the plate, and a robot hitter in White Sox grey waiting on the pitch."
              placeholder="blur"
              sizes="(min-width: 640px) 42rem, 92vw"
              className="block w-full"
            />
          </div>
          <figcaption className="mt-3 text-xs font-semibold leading-relaxed text-bark-soft">
            The home club take the field as aliens and the visitors as robots, in
            their real colors, so it is never a question who is who.
          </figcaption>
        </figure>

        <Section heading="Where the idea came from">
          <p>
            A few years ago ESPN carried an NFL game as a Toy Story cartoon —
            Toy Story Funday Football. Not highlights cut together afterwards: the
            live game, as it was being played, with every player on the field
            driving a toy in Andy&apos;s room. Tracking data went in one end and a
            different world came out the other, and the game underneath it was
            still the real one.
          </p>
          <p>
            That stuck with me. Baseball is, if anything, the easier sport to try it
            on: MLB publishes every pitch, every batted ball, every runner and every
            stat line as it happens, which is most of what you need to put a game
            somewhere else. So — same trick, much smaller budget, and a ballpark
            instead of a bedroom.
          </p>
        </Section>

        <Section heading="What it actually does">
          <p>
            Nothing here is simulated. The app reads MLB&apos;s public Stats API,
            translates each play into its own vocabulary, and animates that. A ball
            goes to the right-field gap because that is where it was hit. The
            scorebug&apos;s numbers — the hitter&apos;s average, the pitcher&apos;s
            ERA and pitch count, the line score on the wooden board out past center
            — are the real ones, arriving a few seconds behind the game itself.
          </p>
          <p>
            The park reads the feed too. First pitch at 1:05 plays under a high sun,
            a 7:05 start runs into golden hour and then to the tower lights, and rain
            falls if it was raining. The crowd wears the home club&apos;s colors and
            has its allegiances: it cheers a strikeout by its own pitcher and groans
            at a home run off him.
          </p>
        </Section>

        <Section heading="What it is for">
          <p>
            Honestly? Not much, and that is not a problem to be fixed. I do not
            imagine anyone sitting through nine innings this way when the actual
            broadcast exists. It is for the thirty seconds after something happens:
            watching a walk-off, a triple, or an inning-ending double play acted out
            by toys, and sending it to somebody.
          </p>
          <p>
            Which is why a single plate appearance has its own link. Anything worth
            showing someone can be handed over on its own, without asking them to
            find it in a nine-inning game.
          </p>
        </Section>

        <Section heading="What's in here">
          <ul className="space-y-2">
            <li>
              <Link href="/" className="font-bold text-grass-deep hover:underline">
                Today&apos;s games
              </Link>{" "}
              — anything in progress opens live and follows along; anything finished
              plays back from the start.
            </li>
            <li>
              <Link
                href={`/games/${SEASON_OPENING_DAY}`}
                className="font-bold text-grass-deep hover:underline"
              >
                Every day since Opening Day
              </Link>{" "}
              — any game the season has played, rebuilt from MLB&apos;s own
              play-by-play when you open it. Nothing had to be recorded in advance.
            </li>
            <li>
              A handful of <strong className="font-bold text-bark">recorded games</strong> worth
              watching back, each with a note saying what happened in it.
            </li>
          </ul>
        </Section>

        <Section heading="The fine print">
          <p>
            Data comes from MLB&apos;s public Stats API, the same feed that powers
            Gameday. This is an independent hobby project: it is not affiliated with,
            endorsed by, or connected to MLB, MLB Advanced Media, or any club. Team
            names and colors are theirs.
          </p>
          <p>
            Built with Next.js, React and three.js. The ballpark, the crowd, every
            player and every sound in it are generated in the browser — there are no
            models and no audio files.
          </p>
        </Section>

        <div className="mt-12 rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-center lip">
          <Ball className="mx-auto h-10 w-10 animate-[bob_5s_ease-in-out_infinite]" />
          <p className="mt-3 font-display text-xl font-extrabold text-bark">
            That is the whole explanation.
          </p>
          <p className="mt-1 text-sm text-bark-soft">Go watch a game.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-grass px-4 py-2 text-sm font-bold text-card transition-transform hover:-translate-y-0.5"
          >
            Find a game →
          </Link>
        </div>
      </div>
    </main>
  );
}
