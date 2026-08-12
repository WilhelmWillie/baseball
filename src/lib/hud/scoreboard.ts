/**
 * How much of the scoreboard is on screen.
 *
 * The panel is the one thing permanently between the viewer and the park, and
 * how much of it earns its place depends entirely on why someone is watching:
 * following a game wants the full card, watching the ballpark wants the score
 * and nothing else, and a screenshot wants none of it.
 */
export type ScoreboardMode = "full" | "mini" | "hidden";

export const DEFAULT_SCOREBOARD_MODE: ScoreboardMode = "full";

export interface ScoreboardModeOption {
  id: ScoreboardMode;
  label: string;
  /** One line under the label in the picker. */
  hint: string;
}

export const SCOREBOARD_MODES: ScoreboardModeOption[] = [
  { id: "full", label: "Full", hint: "Score, count and the last play" },
  { id: "mini", label: "Minimized", hint: "Score, inning, outs, bases" },
  { id: "hidden", label: "Hidden", hint: "Nothing but the park" },
];

/** The next mode round the loop, for the collapse control on the panel itself. */
export function nextScoreboardMode(mode: ScoreboardMode): ScoreboardMode {
  const index = SCOREBOARD_MODES.findIndex((m) => m.id === mode);
  return SCOREBOARD_MODES[(index + 1) % SCOREBOARD_MODES.length].id;
}

const STORAGE_KEY = "pocket-ballpark:scoreboard";

/** What the viewer last chose, if the browser remembers it. */
export function storedScoreboardMode(): ScoreboardMode | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return SCOREBOARD_MODES.some((m) => m.id === saved) ? (saved as ScoreboardMode) : null;
  } catch {
    return null;
  }
}

export function rememberScoreboardMode(mode: ScoreboardMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private browsing, or a full quota. The choice just will not stick.
  }
}
