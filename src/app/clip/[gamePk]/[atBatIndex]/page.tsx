import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipViewer } from "@/components/ClipViewer";
import { hitLine, scoreLine, tryAtBatCard } from "@/lib/share/atbat";

/**
 * One play, on its own page.
 *
 * The thing the "Clip" button in a game log opens, and the page built to be
 * pasted somewhere: it starts on the batter stepping in, plays the plate
 * appearance, and stops when the play concludes.
 *
 * Nothing is stored to make this work. A clip is `(gamePk, atBatIndex)` and the
 * play is cut out of MLB's feed on request, so a link minted while a game is
 * still being played resolves the same way years later.
 */
type Params = Promise<{ gamePk: string; atBatIndex: string }>;

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

  const statcast = hitLine(card.hit);
  const title = `${card.batter} — ${card.event}${statcast ? ` · ${statcast}` : ""}`;
  const description =
    card.description || `${card.half}, ${scoreLine(card, card.scoreAfter)}.`;
  return {
    title,
    description,
    openGraph: { title, description },
    // `card` is restated rather than inherited: a `twitter` block here replaces
    // the layout's outright, and losing it would drop the card back to a
    // thumbnail - the opposite of what a play is worth sharing as.
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ClipPage({ params }: { params: Params }) {
  const { gamePk, atBatIndex } = await params;
  const id = Number(gamePk);
  const index = parse(atBatIndex);
  if (!Number.isInteger(id) || id <= 0 || index === null) notFound();

  const card = await tryAtBatCard(id, index);
  // A play still in progress has no end to stop on, so there is no clip of it
  // yet - the same judgement `buildClip` makes when the frames are cut.
  if (!card || !card.isComplete) notFound();

  return <ClipViewer gamePk={gamePk} atBatIndex={index} card={card} />;
}
