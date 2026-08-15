"use client";

import { useEffect, useState } from "react";
import type { CallOut } from "@/lib/anim/director";
import { useGameStore } from "@/store/gameStore";

const TONE: Record<CallOut["tone"], string> = {
  neutral: "border-bark/15 bg-card text-bark",
  good: "border-grass-deep bg-grass text-card",
  bad: "border-clay bg-card text-clay",
  big: "border-bark bg-clay text-card",
};

/**
 * The director owns callouts on a mutable object so animation never triggers
 * React renders. This polls it at a rate the eye cannot tell from instant.
 */
export function Callout({
  /** Raised clear of the replay transport, which parks on the same edge. */
  lifted = false,
}: {
  lifted?: boolean;
} = {}) {
  const director = useGameStore((s) => s.director);
  const [call, setCall] = useState<CallOut | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const tick = () => {
      const current = director.callout;
      const at = current?.at ?? 0;
      if (at !== lastAt) {
        lastAt = at;
        setCall(current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [director]);

  if (!call) return null;

  return (
    // A wide banner near the bottom of the frame. On a phone it floats just
    // above the thumb controls so it never covers them; on a larger screen it
    // sits above the venue status in the corner, capped in width and centered
    // so it never stretches edge to edge. When a recording is playing it clears
    // the transport bar as well, which is roughly 62px of the same edge.
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-2 sm:px-4 ${
        lifted
          ? "bottom-[calc(10rem+env(safe-area-inset-bottom))] sm:bottom-24"
          : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-14"
      }`}
    >
      <div
        key={call.at}
        className={`flex w-full max-w-[800px] animate-[banner_360ms_cubic-bezier(0.34,1.3,0.5,1)] flex-col items-center gap-0.5 rounded-2xl border-2 px-4 py-3 text-center lip-float sm:gap-1 sm:py-4 ${TONE[call.tone]}`}
      >
        <span className="font-display text-xl font-extrabold leading-tight sm:text-3xl">
          {call.text}
        </span>
        {call.detail && (
          <span className="text-[11px] font-semibold leading-snug opacity-90 sm:text-sm">
            {call.detail}
          </span>
        )}
      </div>
    </div>
  );
}
