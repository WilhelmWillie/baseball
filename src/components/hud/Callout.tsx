"use client";

import { useEffect, useState } from "react";
import type { CallOut } from "@/lib/anim/director";
import { useGameStore } from "@/store/gameStore";

const TONE: Record<CallOut["tone"], string> = {
  neutral: "border-white/40 text-white",
  good: "border-emerald-300 text-emerald-200",
  bad: "border-red-400 text-red-200",
  big: "border-amber-300 text-amber-200",
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
    <div className="pointer-events-none flex flex-col items-center font-mono">
      <div
        key={call.at}
        className={`animate-[callout_240ms_ease-out] border-2 bg-slate-950/95 px-5 py-2 text-2xl tracking-[0.2em] shadow-[5px_5px_0_rgba(0,0,0,0.7)] ${TONE[call.tone]}`}
      >
        {call.text}
      </div>
      {call.detail && (
        <div className="mt-1 max-w-md bg-slate-950/85 px-2 py-0.5 text-center text-[11px] tracking-wide text-white/80">
          {call.detail}
        </div>
      )}
    </div>
  );
}
