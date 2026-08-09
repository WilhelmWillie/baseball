import { GameList } from "@/components/GameList";

export default function Home() {
  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_20%_-10%,#1c3350,#0a0f18_60%)]">
      <GameList />
    </main>
  );
}
