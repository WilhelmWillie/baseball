/** The wordmark's baseball: cream leather, two clay seams, little stitches. */
export function Ball({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="21" fill="var(--color-card)" stroke="var(--color-bark)" strokeWidth="2.5" />
      <g
        fill="none"
        stroke="var(--color-clay)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M11 8c5 6 5 26 0 32" />
        <path d="M37 8c-5 6-5 26 0 32" />
        <g strokeWidth="1.6">
          <path d="M14 15l-3.5 1.5M14 21l-4 .8M14 27l-4-.6M14 33l-3.5-1.6" />
          <path d="M34 15l3.5 1.5M34 21l4 .8M34 27l4-.6M34 33l3.5-1.6" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The park itself, as a friendly little vignette: mown grass, an infield of
 * dirt, four figures who are clearly having a nice afternoon.
 */
export function ParkVignette({ className = "" }: { className?: string }) {
  const cap = (x: number, y: number, shirt: string, hat: string) => (
    <g key={`${x}-${y}`}>
      <ellipse cx={x} cy={y + 11} rx="6" ry="2" fill="rgba(31,90,57,0.22)" />
      <rect x={x - 4} y={y} width="8" height="11" rx="4" fill={shirt} />
      <circle cx={x} cy={y - 4} r="4.4" fill="var(--color-clay-soft)" />
      <path
        d={`M${x - 4.6} ${y - 5.4}a4.6 4.6 0 0 1 9.2 0z`}
        fill={hat}
      />
    </g>
  );

  return (
    <svg viewBox="0 0 400 280" className={className} role="img" aria-label="A low-poly ballpark on a sunny afternoon">
      {/* Sky */}
      <defs>
        <clipPath id="park-clip">
          <rect x="0" y="0" width="400" height="280" rx="28" />
        </clipPath>
      </defs>
      <g clipPath="url(#park-clip)">
        <rect width="400" height="280" fill="var(--color-grass-mist)" />

        {/* Sun and a couple of soft clouds */}
        <circle cx="300" cy="48" r="26" fill="var(--color-clay-soft)" opacity="0.55" />
        <circle cx="300" cy="48" r="17" fill="var(--color-card)" />
        <g fill="var(--color-card)" opacity="0.9">
          <ellipse cx="78" cy="52" rx="30" ry="14" />
          <ellipse cx="98" cy="44" rx="20" ry="13" />
          <ellipse cx="196" cy="34" rx="24" ry="11" />
        </g>

        {/* Light towers behind the wall */}
        {[58, 352].map((x) => (
          <g key={x}>
            <rect x={x - 2.5} y="86" width="5" height="60" rx="2.5" fill="var(--color-bark-soft)" />
            <rect x={x - 17} y="70" width="34" height="20" rx="7" fill="var(--color-bark)" />
            <g fill="var(--color-clay-soft)">
              <circle cx={x - 9} cy="80" r="3.4" />
              <circle cx={x} cy="80" r="3.4" />
              <circle cx={x + 9} cy="80" r="3.4" />
            </g>
          </g>
        ))}

        {/* Outfield wall, then the grass that runs up to it */}
        <path
          d="M14 190C14 128 96 104 200 104s186 24 186 86z"
          fill="var(--color-grass-deep)"
        />
        <path
          d="M14 190C14 132 96 110 200 110s186 22 186 80z"
          fill="none"
          stroke="var(--color-clay-soft)"
          strokeWidth="4"
        />
        <path
          d="M14 300C14 148 96 126 200 126s186 22 186 174z"
          fill="var(--color-grass)"
        />
        {/* Mown bands */}
        <g fill="var(--color-grass-soft)" opacity="0.28">
          <path d="M60 300c0-96 50-160 140-172v172z" />
          <path d="M280 300c0-88-30-152-80-172v172z" />
        </g>

        {/* The infield skin: a fan opening from the plate, the way it looks
            from a seat behind home. Foul lines run out along its edges. */}
        <path d="M200 242 L110 211 Q200 115 290 211 Z" fill="var(--color-clay)" opacity="0.9" />
        <ellipse cx="200" cy="243" rx="30" ry="14" fill="var(--color-clay)" opacity="0.9" />
        <path d="M200 236 L240 204 L200 172 L160 204 Z" fill="var(--color-grass)" />
        <g stroke="var(--color-card)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M200 242 L34 186" />
          <path d="M200 242 L366 186" />
        </g>

        {/* Bases and the mound */}
        <g fill="var(--color-card)">
          <rect x="236" y="200" width="8" height="8" rx="2" transform="rotate(45 240 204)" />
          <rect x="196" y="168" width="8" height="8" rx="2" transform="rotate(45 200 172)" />
          <rect x="156" y="200" width="8" height="8" rx="2" transform="rotate(45 160 204)" />
          <path d="M195 238h10v5l-5 4-5-4z" />
        </g>
        <ellipse cx="200" cy="206" rx="15" ry="8" fill="var(--color-clay-soft)" />

        {/* Everybody on the field */}
        {cap(200, 198, "var(--color-card)", "var(--color-grass-deep)")}
        {cap(230, 234, "var(--color-clay)", "var(--color-bark)")}
        {cap(268, 188, "var(--color-card)", "var(--color-grass-deep)")}
        {cap(134, 188, "var(--color-card)", "var(--color-grass-deep)")}
        {cap(200, 152, "var(--color-card)", "var(--color-grass-deep)")}
      </g>
    </svg>
  );
}
