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
        {/* A cranium wide at the brow and tapering to a small chin. */}
        <path
          d="M12 2.5C7 2.5 3.6 5.7 3.6 10.2c0 4.5 3.7 8.9 8.4 11.3 4.7-2.4 8.4-6.8 8.4-11.3C20.4 5.7 17 2.5 12 2.5Z"
          fill={ink}
        />
        {/* Two big glossy almonds, which is most of an alien's face. */}
        <ellipse cx="8.3" cy="10.4" rx="2.7" ry="1.7" fill={cut} transform="rotate(-20 8.3 10.4)" />
        <ellipse
          cx="15.7"
          cy="10.4"
          rx="2.7"
          ry="1.7"
          fill={cut}
          transform="rotate(20 15.7 10.4)"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {/* A box head on a stubby aerial, with a grille for a mouth. */}
      <rect x="11.1" y="3.4" width="1.8" height="3.8" rx="0.9" fill={ink} />
      <circle cx="12" cy="2.6" r="1.8" fill={ink} />
      <rect x="3" y="6.8" width="18" height="14" rx="3.2" fill={ink} />
      <rect x="6.5" y="9.6" width="3.8" height="3.8" rx="1.3" fill={cut} />
      <rect x="13.7" y="9.6" width="3.8" height="3.8" rx="1.3" fill={cut} />
      <rect x="8.4" y="16.1" width="7.2" height="1.9" rx="0.95" fill={cut} />
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
