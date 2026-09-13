"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

/**
 * The way back out of a page someone arrived at from somewhere else.
 *
 * A clip is a link: it is opened from a game log, from a day's slate, or from a
 * group chat, and "back" means something different in each case. So the button
 * reads the referrer and points at whatever opened this page, falling back to
 * the games when nothing here did - which is exactly the case for the link that
 * was pasted somewhere.
 *
 * When the page it came from is still the entry behind this one, the click goes
 * through history rather than navigating: a game resumed that way is still
 * where it was left, and a fresh navigation would both lose that and pay to
 * rebuild the whole feed to get back to it.
 */

/** Where a page of ours sits, named from its path alone. */
function nameFor(pathname: string): { label: string; title: string } {
  if (pathname.startsWith("/watch/")) return { label: "Game", title: "Back to the game" };
  if (pathname.startsWith("/games/")) {
    return { label: "Games", title: "Back to that day's games" };
  }
  if (pathname === "/") return { label: "Games", title: "All the games" };
  return { label: "Back", title: "Back to where you came from" };
}

interface Origin {
  /** Root-relative, so this stays a real link even when history is not usable. */
  href: string;
  label: string;
  title: string;
  /** Whether the entry behind this page is that page, so `back()` lands on it. */
  inHistory: boolean;
}

/** The page this one was opened from, or null if that was not one of ours. */
function cameFrom(): Origin | null {
  const referrer = document.referrer;
  if (!referrer) return null;

  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  // Somewhere else entirely - a chat app, a search result, a social preview -
  // is not somewhere to send anyone back to.
  if (url.origin !== window.location.origin) return null;
  // Nor is this page itself: a reload keeps the referrer it was loaded with,
  // and a refresh on a clip opened cold would otherwise offer to go nowhere.
  if (url.pathname === window.location.pathname) return null;

  return {
    href: `${url.pathname}${url.search}${url.hash}`,
    ...nameFor(url.pathname),
    // `history.length` is the tab's, so this says "something is behind us", not
    // what. Together with a same-origin referrer it is enough: the entry behind
    // a document is the page that linked to it. Opening the clip in a new tab
    // keeps the referrer but starts a fresh stack, which is what this catches.
    inHistory: window.history.length > 1,
  };
}

/**
 * The answer, worked out once.
 *
 * `useSyncExternalStore` asks on every render and compares what it gets, so
 * this has to hand back the same object each time - and it can, because the
 * referrer is fixed for the life of the document.
 */
let resolved: Origin | null | undefined;

function currentOrigin(): Origin | null {
  if (resolved === undefined) resolved = cameFrom();
  return resolved;
}

/** There is nothing to subscribe to: the value never changes under the page. */
const fixed = () => () => {};

/** The server has no referrer, so every page starts on its fallback. */
const nothing = () => null;

export function BackLink({
  fallback = "/",
  className,
}: {
  /** Where to go when nothing in this app opened this page. */
  fallback?: string;
  className?: string;
}) {
  const router = useRouter();
  // Read rather than held in state: the server renders the fallback, and the
  // browser swaps in where it actually came from as it hydrates.
  const origin = useSyncExternalStore(fixed, currentOrigin, nothing);

  const target = origin ?? { href: fallback, ...nameFor(fallback), inHistory: false };

  return (
    <Link
      href={target.href}
      // Prefetching would rebuild a game server-side for a link most people
      // never take - the same reason the game log's Clip links are plain
      // anchors.
      prefetch={false}
      onClick={(event) => {
        if (!target.inHistory) return;
        // A modified click is asking for a new tab or window, which has no
        // history to go back through.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        router.back();
      }}
      title={target.title}
      aria-label={target.title}
      className={className}
    >
      ←<span className="hidden sm:inline"> {target.label}</span>
    </Link>
  );
}
