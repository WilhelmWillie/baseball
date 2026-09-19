/**
 * A calendar page, drawn the way everything else here is drawn: rounded corners,
 * a chunky outline, dots for days rather than a grid of hairlines that would
 * disappear at this size.
 *
 * Inked in `currentColor` so it takes the colour of whatever it sits inside -
 * cream on the home page's grass button, deep green on the season nav's paper
 * pill - and marked `aria-hidden`, since both of those say "date" in words.
 */
export function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="4.5" />
      <path d="M3 10.5h18M8 3v4M16 3v4" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.2" cy="14.6" r="1.25" />
        <circle cx="12" cy="14.6" r="1.25" />
        <circle cx="15.8" cy="14.6" r="1.25" />
        <circle cx="8.2" cy="18" r="1.25" />
        <circle cx="12" cy="18" r="1.25" />
      </g>
    </svg>
  );
}
