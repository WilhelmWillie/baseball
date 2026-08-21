import posthog from "posthog-js";

/**
 * Client-side instrumentation. Next runs this once, after the document loads
 * and before React hydrates (see the `instrumentation-client` file convention),
 * which makes it the right place to stand analytics up so the very first
 * pageview - UTM params and all - is caught before anything renders.
 */
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

// No key means analytics is simply off. Local dev and preview builds run clean
// without a project key, and every `track()` call downstream no-ops, so nothing
// here needs a try/catch or a guard at the call sites.
if (key) {
  posthog.init(key, {
    api_host: host,
    // App Router navigations are History API pushes; posthog watches those
    // itself in this mode, so there is no route-change listener to wire up.
    // UTM params on the landing URL are parsed into person/session properties
    // automatically - that covers the "capture UTM parameters" requirement.
    capture_pageview: "history_change",
    capture_pageleave: true,
    // Stay anonymous until we ever call identify(), which we do not yet. Keeps
    // us clear of most consent-banner territory for this first release.
    person_profiles: "identified_only",
  });
}
