import { render } from "@testing-library/react";
import type { FacilityMapStatusKind } from "./FacilityMapStatus";
import FacilityMapStatusArtwork from "./FacilityMapStatusArtwork";

// SVG geometry is decorative, so its inertness and visual distinction need DOM inspection.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
const knownKinds: Exclude<FacilityMapStatusKind, "unknown">[] = [
  "construction",
  "paused",
  "producing",
  "idle",
  "charging",
];

it.each(knownKinds)("keeps %s artwork decorative and pointer-inert", (kind) => {
  const { container } = render(
    <svg>
      <FacilityMapStatusArtwork kind={kind} />
    </svg>,
  );
  const marker = container.querySelector("g");
  expect(marker).toHaveAttribute("aria-hidden", "true");
  expect(marker).toHaveAttribute("pointer-events", "none");
  expect(
    marker?.querySelector("[tabindex], [role], a, title, desc"),
  ).toBeNull();
});

it("gives each known state a distinct shape and removes the marker for unknown output", () => {
  const { container, rerender } = render(<svg />);
  const shapes = new Set<string>();
  for (const kind of knownKinds) {
    rerender(
      <svg>
        <FacilityMapStatusArtwork kind={kind} />
      </svg>,
    );
    shapes.add(container.innerHTML);
  }
  expect(shapes.size).toBe(knownKinds.length);
  rerender(
    <svg>
      <FacilityMapStatusArtwork kind="unknown" />
    </svg>,
  );
  expect(container.querySelector("svg")).toBeEmptyDOMElement();
});

it.each([
  ["producing", "#2E7D32"],
  ["idle", "#C62828"],
] as const)("uses the semantic color for %s", (kind, color) => {
  const { container } = render(
    <svg>
      <FacilityMapStatusArtwork kind={kind} />
    </svg>,
  );
  expect(container.querySelector("g > path")).toHaveAttribute("fill", color);
});
