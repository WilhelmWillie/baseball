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
export function Callout() {
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
    <div className="pointer-events-none flex flex-col items-center">
      <div
        key={call.at}
        className={`animate-[callout_320ms_cubic-bezier(0.34,1.56,0.64,1)] rounded-2xl border-2 px-4 py-2 font-display text-xl font-extrabold lip-float sm:px-6 sm:py-2.5 sm:text-3xl ${TONE[call.tone]}`}
      >
        {call.text}
      </div>
      {call.detail && (
        <div className="mt-1.5 max-w-md rounded-full bg-card/95 px-3 py-1 text-center text-[11px] font-semibold text-bark lip-float">
          {call.detail}
        </div>
      )}
    </div>
  );
}
