/**
 * When a baseball game is over, worked out from the state of play rather than
 * waited for.
 *
 * MLB flips `abstractGameState` to "Final" some way after the last out - long
 * enough that an ending sits idle while the feed catches up. But the rules
 * already say when a game is decided, and the linescore carries everything they
 * need: the inning, which half, the out count and the score. `deriveGameOver`
 * reads that off and answers immediately.
 *
 * It is deliberately a pure function of one snapshot, and that is what makes it
 * safe against a reversal. Nothing is latched: a game-ending out overturned on
 * review drops the out count back under three (or takes the run back off the
 * board), and the very next snapshot reads "not over" again with no state to
 * unwind. The caller ORs this with the feed's own Final/Game-Over status, so
 * the authoritative signal still wins the moment it arrives.
 */
export interface GameOverInput {
  /** Current inning number (1-based). */
  inning: number;
  isTopInning: boolean;
  /** `linescore.inningState`: "Top" | "Middle" | "Bottom" | "End". */
  inningState: string;
  outs: number;
  homeScore: number;
  awayScore: number;
  /** Usually 9; 7 for doubleheader games, higher once extras are scheduled. */
  scheduledInnings: number;
}

export function deriveGameOver({
  inning,
  isTopInning,
  inningState,
  outs,
  homeScore,
  awayScore,
  scheduledInnings,
}: GameOverInput): boolean {
  // Too early to end: a lead in the middle innings is not a final, and extras
  // only push the bar higher.
  if (inning < scheduledInnings) return false;
  // A tie never ends a game - it goes to another inning.
  if (homeScore === awayScore) return false;

  // The visitors' half of the final inning is complete: the feed has moved to
  // the middle break, or on into the home half.
  const topHalfDone = inningState === "Middle" || !isTopInning;
  // The home half is complete: the feed has moved to the between-innings break,
  // or the third out is already on the board with the home side still batting.
  const bottomHalfDone = inningState === "End" || (!isTopInning && outs >= 3);

  // Home wins: once the top of the last inning is done and the home side leads,
  // they do not bat - or, if this is their half, they have just walked it off.
  if (homeScore > awayScore && topHalfDone) return true;
  // Visitors win: the home side has finished batting and did not catch up.
  if (awayScore > homeScore && bottomHalfDone) return true;

  return false;
}
