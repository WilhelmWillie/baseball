"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hand someone a link to what is on screen.
 *
 * Two ways out, and which one you get is the platform's call rather than ours.
 * On a phone `navigator.share` opens the system sheet, which is the whole point
 * of this feature - the destination is a group chat, and the sheet is the
 * shortest path to one. Everywhere else it falls back to the clipboard and says
 * so, because a button that silently copies looks broken.
 */
type State = "idle" | "copied";

/** How long "Copied!" stays up. Long enough to read, short enough not to nag. */
const CONFIRM_MS = 1800;

export function ShareButton({
  path,
  title,
  text,
  label = "Share",
  className,
}: {
  /** Root-relative path; the origin is added at click time. */
  path: string;
  title?: string;
  text?: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const confirm = () => {
    setState("copied");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), CONFIRM_MS);
  };

  const share = async () => {
    // Resolved here rather than at render: the server has no origin, and the
    // two passes have to agree.
    const url = new URL(path, window.location.origin).toString();

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // A dismissed sheet throws the same way a failed one does. Falling
        // through to the clipboard would copy a link nobody asked for, so a
        // cancel just ends here.
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      confirm();
    } catch {
      // Clipboard access can be refused outright. Selecting the URL is then the
      // only thing left, and the address bar already holds it on a clip page.
      window.prompt("Copy this link", url);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      title="Copy a link to this play"
      className={className}
    >
      {state === "copied" ? "Copied!" : label}
    </button>
  );
}
