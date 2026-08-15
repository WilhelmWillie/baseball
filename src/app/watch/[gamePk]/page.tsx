import { notFound } from "next/navigation";
import { Viewer, type ViewerMode } from "@/components/Viewer";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ gamePk: string }>;
  searchParams: Promise<{ at?: string; replay?: string }>;
}) {
  const { gamePk } = await params;
  const { at, replay } = await searchParams;

  // Every game is a numeric gamePk now that the simulator is gone; anything
  // else would render a viewer that can never load a feed.
  const id = Number(gamePk);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // A recorded game is finished by definition, so `?replay=1` can never collide
  // with the same gamePk being live.
  const isReplay = replay === "1" || replay === "true";
  const mode: ViewerMode = isReplay ? "replay" : "live";

  // ?at=<n> opens a recording on the nth plate appearance, 1-based.
  const openAt = Math.max(0, (Number(at ?? 0) || 0) - 1);

  return <Viewer gamePk={gamePk} mode={mode} startAtBat={isReplay ? openAt : 0} />;
}
