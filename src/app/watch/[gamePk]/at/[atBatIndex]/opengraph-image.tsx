import { brandCardImage, CARD_SIZE, playCardImage } from "@/lib/brand/playcard";
import { tryAtBatCard } from "@/lib/share/atbat";

export const alt = "Watch this at-bat in a low-poly ballpark";
export const size = CARD_SIZE;
export const contentType = "image/png";

/**
 * A day, where the whole-game card gets an hour.
 *
 * That card holds nothing that moves because a scraper caches what it fetches
 * and a score would be wrong within minutes. This one describes a plate
 * appearance that already happened, so every word on it - the batter, the
 * inning, the score going in - is settled for good and can be cached as such.
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

  return playCardImage({
    card,
    headline: card.batter,
    // No outcome: this link is an invitation to watch the at-bat, not a recap.
    subject: `vs. ${card.pitcher}`,
    score: card.scoreBefore,
  });
}
