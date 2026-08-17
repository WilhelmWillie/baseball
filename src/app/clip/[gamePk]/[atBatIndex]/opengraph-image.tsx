import { brandCardImage, CARD_SIZE, playCardImage } from "@/lib/brand/playcard";
import { hitLine, tryAtBatCard } from "@/lib/share/atbat";

export const alt = "Watch this play in a low-poly ballpark";
export const size = CARD_SIZE;
export const contentType = "image/png";

/**
 * Cached for a day, and it carries the score.
 *
 * A clip is one finished play. What it says - who batted, what happened, how
 * hard the ball was hit, what the score became - cannot change, which is why
 * this card can hold the detail the whole-game card next door deliberately
 * leaves off.
 */
export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ gamePk: string; atBatIndex: string }>;
}) {
  const { gamePk, atBatIndex } = await params;
  const card = await tryAtBatCard(Number(gamePk), Number(atBatIndex));
  if (!card) return brandCardImage();

  // The numbers people quote, when there are any: "Home Run · 108 mph · 442 ft".
  const statcast = hitLine(card.hit);

  return playCardImage({
    card,
    headline: card.batter,
    subject: statcast ? `${card.event} · ${statcast}` : card.event,
    score: card.scoreAfter,
  });
}
