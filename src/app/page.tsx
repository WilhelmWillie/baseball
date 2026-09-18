import Image from "next/image";
import Link from "next/link";
import { GameList } from "@/components/GameList";
import { Ball } from "@/components/brand/Ball";
import hero from "./hero-ballpark.webp";

/**
 * The game the hero shot was taken in, cued to the plate appearance it shows:
 * Pete Crow-Armstrong leading off the bottom of the first. It is one of the
 * published recordings, so it plays whether or not the Stats API is reachable -
 * and the picture is a way into it rather than a picture of one.
 */
const HERO_GAME = "/watch/824641?replay=1&at=4";

export default function Home() {
  return (
    <main className="min-h-dvh bg-paper bg-[radial-gradient(circle_at_12%_-8%,var(--color-grass-mist),transparent_60%)]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8">
        <nav className="flex items-center justify-between py-6">
          <span className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
            <Ball className="h-8 w-8" />
            <span className="text-clay">Pocket</span>
            <span className="-ml-1 text-grass-deep">Ballpark</span>
          </span>
          <Link
            href="/about"
            className="rounded-full bg-grass px-3.5 py-1.5 text-xs font-bold text-card transition-transform lip-sm hover:-translate-y-0.5"
          >
            About
          </Link>
        </nav>

        <header className="grid items-center gap-8 pb-12 pt-4 sm:pb-16 md:grid-cols-[1fr_1.15fr] md:gap-10">
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-grass-deep sm:text-5xl lg:text-6xl">
              Watch baseball
              <br />
              come to life.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-bark-soft sm:text-lg">
              Pick a game. Grab a seat. Watch every pitch, hit, and play unfold in a
              charming 3D ballpark.
            </p>
          </div>

          {/* A frame of the real thing rather than an illustration of it: the
              park mid-game, taken from the viewer itself, so the promise above is
              made by the thing that has to keep it. */}
          <figure className="relative">
            <Link
              href={HERO_GAME}
              className="group block overflow-hidden rounded-[28px] border-2 border-grass-deep/12 bg-grass-mist transition-all duration-200 lip hover:-translate-y-1 hover:border-grass/60"
            >
              <Image
                src={hero}
                alt="The Pocket Ballpark viewer mid-game: alien Cubs and robot White Sox on a 3D field at Wrigley, confetti over the infield after a home run, with the scorebug and the line score on the board."
                priority
                placeholder="blur"
                sizes="(min-width: 768px) 46vw, 92vw"
                className="block w-full transition-transform duration-300 group-hover:scale-[1.015]"
              />
            </Link>
            <div className="absolute -right-2 -top-4 hidden animate-[bob_5s_ease-in-out_infinite] sm:block">
              <Ball className="h-12 w-12 drop-shadow-[0_5px_0_rgba(74,53,36,0.18)]" />
            </div>
            <figcaption className="mt-3 text-xs font-semibold leading-relaxed text-bark-soft">
              Wrigley Field, August 17: Pete Crow-Armstrong has just led the game
              off with a home run.{" "}
              <Link href={HERO_GAME} className="font-bold text-grass-deep hover:underline">
                Watch this one →
              </Link>
            </figcaption>
          </figure>
        </header>

        <GameList />
      </div>
    </main>
  );
}
