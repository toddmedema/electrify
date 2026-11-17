import * as React from "react";
import type { FacilityMapStatusKind } from "./FacilityMapStatus";

function glyph(kind: Exclude<FacilityMapStatusKind, "unknown">) {
  switch (kind) {
    case "construction":
      return (
        <>
          <path d="M-22 10V2A22 22 0 0 1 22 2V10H28V20H-28V10Z" />
          <path d="M0-18V3" fill="none" stroke="#FFF8E1" strokeWidth={6} />
        </>
      );
    case "paused":
      return <path d="M-20-24H-7V24H-20ZM7-24H20V24H7Z" />;
    case "producing":
      return (
        <path
          fill="var(--delta-good)"
          d="M-24-6H-6V-24H6V-6H24V6H6V24H-6V6H-24Z"
        />
      );
    case "charging":
      return <path d="M0-27L25-2H9V25H-9V-2H-25Z" transform="rotate(180)" />;
    case "idle":
      return <path fill="var(--delta-bad)" d="M-25-6H25V6H-25Z" />;
  }
}

/** Decorative sibling of the facility body in its uniformly scaled 500-unit canvas. */
export default function FacilityMapStatusArtwork({
  kind,
}: {
  kind: FacilityMapStatusKind;
}) {
  if (kind === "unknown") return null;
  return (
    <g
      className="facilityMapStatusArtwork"
      transform="translate(424 345)"
      pointerEvents="none"
      aria-hidden="true"
      fill="#000"
      stroke="none"
    >
      <circle r={42} fill="#FFF8E1" stroke="#000" strokeWidth={12} />
      {glyph(kind)}
    </g>
  );
}
