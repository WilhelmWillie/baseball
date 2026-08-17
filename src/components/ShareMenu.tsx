"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hand someone a link to what is on screen.
 *
 * A menu of our own rather than the system share sheet. The sheet looked like
 * the obvious answer - the destination really is a group chat - but it is the
 * platform's UI, it appears only on some devices, and it puts a dozen
 * destinations in front of someone who wanted the URL. A menu is the same
 * everywhere and says what it will do.
 *
 * One item today. It is a menu rather than a button so that the second one does
 * not require rethinking the control.
 */

/** How long "Copied!" stays up before the menu closes itself. */
const CONFIRM_MS = 1200;

export function ShareMenu({
  path,
  label = "Share",
  className,
  placement,
}: {
  /** Root-relative path; the origin is added at click time. */
  path: string;
  label?: string;
  className?: string;
  /**
   * Which way the menu opens. Left off, it follows the controls it sits in:
   * above on a phone, where they run along the bottom edge, and below once they
   * move to the top corner. The same rule the camera picker uses.
   */
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // A menu that can only be dismissed by finding its trigger again is a trap on
  // a phone, where it covers the thing behind it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async () => {
    // Resolved here rather than at render: the server has no origin, and the
    // two passes have to agree.
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access can be refused outright. Putting the URL somewhere
      // selectable is the only thing left.
      window.prompt("Copy this link", url);
      setOpen(false);
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOpen(false);
      setCopied(false);
    }, CONFIRM_MS);
  };

  const position =
    placement === "up"
      ? "bottom-full right-0 mb-2"
      : placement === "down"
        ? "top-full right-0 mt-2"
        : "bottom-full left-1/2 mb-2 -translate-x-1/2 sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mb-0 sm:mt-2 sm:translate-x-0";

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Share this play"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-30 w-44 overflow-hidden rounded-2xl border-2 border-grass-deep/12 bg-card/97 p-1 lip-float ${position}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={copy}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors ${
              copied ? "bg-grass text-card" : "text-bark hover:bg-grass-mist hover:text-grass-deep"
            }`}
          >
            {copied ? "✓ Copied!" : "🔗 Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
