import { inkOn } from "@/lib/mlb/teams";
import type { Species } from "@/lib/game/species";

/**
 * Who is out there, as a glyph. The park fields aliens for the home club and
 * robots for the visitors, and until now the panel said so only in the team
 * colors - which is no help at all when both clubs turn up in navy. These are
 * the same two faces the models wear, small enough to sit in the color chip
 * the scoreboard already draws.
 *
 * `ink` paints the face and `cut` is punched out of it for the eyes, so a
 * badge only ever uses two colors: the club's, and whichever ink reads on it.
 */
export function SpeciesGlyph({
  species,
  ink,
  cut,
  className = "h-4 w-4",
}: {
  species: Species;
  ink: string;
  cut: string;
  className?: string;
}) {
  if (species === "alien") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        {/* Two stalks, then one smooth egg of a head under them. */}
        <path
          d="M9.5 3.6 8.2 1.9M14.5 3.6 15.8 1.9"
          stroke={ink}
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <circle cx="7.9" cy="1.5" r="1.2" fill={ink} />
        <circle cx="16.1" cy="1.5" r="1.2" fill={ink} />
        <path
          d="M12 3C6.8 3 3 7.1 3 11.5c0 5 5.3 10.2 9 10.2s9-5.2 9-10.2C21 7.1 17.2 3 12 3Z"
          fill={ink}
        />
        {/* Two big glossy domes, which is the whole of an alien's face. */}
        <ellipse cx="7.9" cy="11" rx="3.3" ry="3.7" fill={cut} transform="rotate(-14 7.9 11)" />
        <ellipse cx="16.1" cy="11" rx="3.3" ry="3.7" fill={cut} transform="rotate(14 16.1 11)" />
        {/* And a smile, which is the rest of it. */}
        <path
          d="M10.2 16.6Q12 18.2 13.8 16.6"
          fill="none"
          stroke={cut}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {/* A screen in a case, on a stubby aerial, with a disc for each ear. */}
      <path d="M16.4 4.4V2.2" stroke={ink} strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="16.4" cy="1.7" r="1.2" fill={ink} />
      <rect x="5.4" y="3.8" width="13.2" height="5" rx="2.3" fill={ink} />
      <circle cx="3.4" cy="13.4" r="2.1" fill={ink} />
      <circle cx="20.6" cy="13.4" r="2.1" fill={ink} />
      <rect x="2.7" y="7.4" width="18.6" height="12" rx="3.4" fill={ink} />
      <rect x="5.3" y="9.6" width="13.4" height="7.6" rx="2.4" fill={cut} />
      <ellipse cx="9.2" cy="13.4" rx="1.7" ry="2" fill={ink} />
      <ellipse cx="14.8" cy="13.4" rx="1.7" ry="2" fill={ink} />
    </svg>
  );
}

/**
 * The club chip the scoreboard has always drawn, now with a face in it. The
 * cream ring is what keeps it legible against whatever the park is doing
 * behind the panel.
 */
export function TeamBadge({
  species,
  color,
  className = "h-5 w-5",
}: {
  species: Species;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ring-2 ring-card ${className}`}
      style={{ backgroundColor: color }}
      title={species === "alien" ? "Home club - aliens" : "Visiting club - robots"}
    >
      <SpeciesGlyph
        species={species}
        ink={inkOn(color)}
        cut={color}
        className="h-[74%] w-[74%]"
      />
    </span>
  );
}
