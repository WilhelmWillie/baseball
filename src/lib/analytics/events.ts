import posthog from "posthog-js";
import type { CameraView } from "@/lib/anim/views";

/** Whether a game is being watched live or from a recording. */
export type GameMode = "live" | "replay";

/**
 * Every product event the app can send, each with its exact payload.
 *
 * This union is the single place the event vocabulary lives: a new feature adds
 * one line here and one `track()` call at the point it happens, and the compiler
 * makes sure the two agree. Pageviews and UTM capture are handled separately by
 * posthog's autocapture (see `instrumentation-client.ts`) and are not listed here.
 */
export type AnalyticsEvent =
  | { name: "game_opened"; props: { gamePk: string; mode: GameMode } }
  | {
      name: "game_loaded";
      props: {
        gamePk: string;
        mode: GameMode;
        home: string;
        away: string;
        venue: string;
        isLive: boolean;
      };
    }
  | {
      name: "game_watch_ended";
      props: { gamePk: string; mode: GameMode; durationSeconds: number; reachedFinal: boolean };
    }
  | { name: "camera_switched"; props: { from: CameraView; to: CameraView; gamePk: string } }
  | { name: "game_selected"; props: { gamePk: string; mode: GameMode; state: string } }
  | { name: "sound_toggled"; props: { on: boolean; gamePk: string } }
  | { name: "scoreboard_mode_changed"; props: { scoreMode: string; gamePk: string } }
  | { name: "feed_error"; props: { gamePk: string; message: string } };

type EventName = AnalyticsEvent["name"];
type PropsFor<N extends EventName> = Extract<AnalyticsEvent, { name: N }>["props"];

/**
 * Send one product event. A no-op until posthog has actually initialized (no
 * project key in the environment), so call sites never have to guard for that.
 */
export function track<N extends EventName>(name: N, props: PropsFor<N>): void {
  if (!posthog.__loaded) return;
  posthog.capture(name, props);
}
