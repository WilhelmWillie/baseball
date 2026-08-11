import { GameList } from "@/components/GameList";
import { Ball, ParkVignette } from "@/components/brand/Ball";

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
          <span className="hidden rounded-full border-2 border-grass-deep/10 bg-card px-3 py-1.5 text-xs font-semibold text-bark-soft sm:inline">
            Powered by the MLB Stats API
          </span>
        </nav>

        <header className="grid items-center gap-8 pb-12 pt-4 sm:pb-16 md:grid-cols-[1.05fr_1fr] md:gap-10">
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-grass-deep sm:text-5xl lg:text-6xl">
              Watch baseball
              <br />
              come to life.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-bark-soft sm:text-lg">
              Pick a game. Grab a seat. Watch every pitch, hit, and baserunner unfold in a
              charming low-poly ballpark.
            </p>
          </div>

          <div className="relative">
            <ParkVignette className="w-full rounded-[28px] border-2 border-grass-deep/12 lip" />
            <div className="absolute -right-2 -top-4 hidden animate-[bob_5s_ease-in-out_infinite] sm:block">
              <Ball className="h-12 w-12 drop-shadow-[0_5px_0_rgba(74,53,36,0.18)]" />
            </div>
          </div>
        </header>

        <GameList />
      </div>
    </main>
  );
}
