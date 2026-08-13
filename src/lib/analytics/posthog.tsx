"use client";

import posthog from "posthog-js";
import { PostHogProvider, useFeatureFlagEnabled } from "posthog-js/react";

/**
 * Makes the already-initialized posthog client available to React so hooks like
 * feature flags work anywhere in the tree. Initialization itself happens once in
 * `instrumentation-client.ts`, before hydration - this only shares that client.
 * With no project key that client is an inert stub, so this is safe to always
 * render.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

/**
 * Whether a posthog feature flag is on for this visitor. The seam for gating
 * future features (e.g. new camera seats) behind a flag or an experiment;
 * returns `undefined` while flags are still loading.
 */
export function useFlag(flag: string): boolean | undefined {
  return useFeatureFlagEnabled(flag);
}
