import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Ball } from "@/components/brand/Ball";
import closeUp from "./close-up.webp";

/**
 * The page that answers "what am I looking at".
 *
 * Everything else here is a way into a game; this is the one page that says
 * where the idea came from and how it works. Static and server-rendered - it
 * touches no feed and never changes.
 */
const title = "About Pocket Ballpark";
const description =
  "Where Pocket Ballpark came from, and how it turns MLB's live play data into a 3D toy ballpark.";

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
            className="rounded-full bg-grass px-3.5 py-1.5 text-xs font-bold text-card transition-transform lip-sm hover:-translate-y-0.5"
          >
            Find a game
          </Link>
        </nav>

        <header className="pb-2 pt-4">
          <p className="text-sm font-bold uppercase tracking-wide text-bark-soft">About</p>
          <h1 className="mt-1 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-grass-deep sm:text-5xl">
            Watch baseball live in a 3D toy ballpark
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-bark">
            Pocket Ballpark takes a real baseball game, either one that&apos;s being
            played right now or one from earlier this season, and plays it out pitch by
            pitch with little aliens and robots in a 3D park.
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
            The home team plays as aliens and the visiting team as robots, in their
            real team colors.
          </figcaption>
        </figure>

        <Section heading="Where the idea came from">
          <p>
            A few years ago, ESPN broadcasted a live NFL game as a Toy Story cartoon.
            Every play was re-created to look as if the players were toys playing a
            game in Andy&apos;s bedroom.
          </p>
          <p>
            I loved that concept, and thought it&apos;d be fun to try to do this with
            baseball. Baseball is a good fit for it, too. The game already happens one
            pitch at a time, with a pause in between, and MLB publishes data on all of
            it while the game is going on. So there isn&apos;t much to make up. You
            mostly just have to draw it.
          </p>
        </Section>

        <Section heading="How it works">
          <p>
            MLB has a public API that reports every pitch and every play while a game
            is going on. Pocket Ballpark reads that feed, works out what each play was,
            and turns it into animations in the ballpark. The players, the ball, the
            score and the stats on the scorebug all come from the real game, a few
            seconds behind it.
          </p>
        </Section>

        <Section heading="Say hi">
          <p>
            I&apos;m Willie, and I built this. If you have questions, feedback, or an
            idea for something it should do, I&apos;d really like to hear it. The
            easiest way to reach me is on X at{" "}
            <a
              href="https://x.com/Wilhelm_Willie"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-grass-deep underline decoration-grass/50 underline-offset-2 hover:text-clay"
            >
              @Wilhelm_Willie
            </a>
            . Happy to talk about baseball, or the 3D side of it, or anything else.
          </p>
        </Section>

        <Section heading="The fine print">
          <p>
            The data comes from MLB&apos;s public Stats API, the same feed behind
            Gameday. This is an independent hobby project. It&apos;s not affiliated
            with, endorsed by, or connected to MLB, MLB Advanced Media, or any club.
            Team names and colors belong to them.
          </p>
          <p>
            Built with Next.js, React and three.js. The ballpark, the crowd, the
            players and every sound in it are generated in the browser, so there are no
            3D models or audio files behind any of it.
          </p>
        </Section>

        <div className="mt-12 rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-center lip">
          <Ball className="mx-auto h-10 w-10 animate-[bob_5s_ease-in-out_infinite]" />
          <p className="mt-3 font-display text-xl font-extrabold text-bark">
            That&apos;s about it.
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
