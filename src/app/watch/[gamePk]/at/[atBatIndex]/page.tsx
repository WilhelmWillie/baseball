import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Viewer } from "@/components/Viewer";
import { scoreLine, tryAtBatCard } from "@/lib/share/atbat";

/**
 * A recorded game, cued to one plate appearance.
 *
 * What the share button in the transport hands out. The whole game is here -
 * transport, log, the rest of the innings - it just opens where the person
 * sharing it was, so a recipient can keep watching rather than only look.
 *
 * A path segment rather than `?at=`, because an `opengraph-image` is only ever
 * given `params`: a card describing the plate appearance is impossible to build
 * from a query string. The older `/watch/[gamePk]?replay=1&at=<ordinal>` still
 * works and is unchanged.
 */
type Params = Promise<{ gamePk: string; atBatIndex: string }>;

/** MLB's index for a plate appearance, or null if this is not one. */
function parse(raw: string): number | null {
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { gamePk, atBatIndex } = await params;
  const index = parse(atBatIndex);
  if (index === null) return {};

  const card = await tryAtBatCard(Number(gamePk), index);
  if (!card) return {};

  // The score *before* the play: this link drops someone into a situation, and
  // spoiling how it turns out would be a strange thing for it to do.
  const title = `${card.batter} — ${card.half} · ${scoreLine(card, card.scoreBefore)}`;
  const description = `${card.batter} bats against ${card.pitcher}. Watch it unfold in a low-poly ballpark.`;
  return {
    title,
    description,
    openGraph: { title, description },
    // A `twitter` block here replaces the layout's rather than merging with it,
    // so `card` has to be restated or the preview shrinks to a thumbnail.
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function WatchAtBatPage({ params }: { params: Params }) {
  const { gamePk, atBatIndex } = await params;
  const id = Number(gamePk);
  const index = parse(atBatIndex);
  if (!Number.isInteger(id) || id <= 0 || index === null) notFound();

  return <Viewer gamePk={gamePk} mode="replay" startAtBatIndex={index} />;
}
