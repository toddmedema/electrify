import { render } from "@testing-library/react";
import CityOccupant from "./CityOccupant";
import { CityArtwork } from "../TerritoryTileArtwork";

// Decorative SVG art exposes geometry rather than accessible controls.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
it.each(["small", "medium", "large"] as const)(
  "keeps the %s fallback inert, with a street and a pocket park",
  (size) => {
    const { container } = render(
      <CityArtwork size={size} className="city-art" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 500 500");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveClass("city-art");
    expect(svg).toHaveAttribute("stroke-width", "20");
    expect(svg?.querySelector('[fill="#B8D9C3"]')).not.toBeNull();
    expect(svg?.querySelector('[fill="#739A77"]')).not.toBeNull();
    expect(
      svg?.querySelector('[fill="#71858A"][stroke="none"]'),
    ).not.toBeNull();
    expect(svg?.querySelector("[tabindex], [role], a, text")).toBeNull();
    expect(
      svg?.querySelector('[stroke-width="6"], [stroke-width="12"]'),
    ).toBeNull();
  },
);

it("increases the fallback skyline and number of blocks with city size", () => {
  const { container, rerender } = render(<CityOccupant size="small" />);
  let previousHeight = 0;
  let previousBlocks = 0;
  for (const size of ["small", "medium", "large"] as const) {
    rerender(<CityOccupant size={size} />);
    const blocks = [...container.querySelectorAll("rect")];
    const height = Math.max(
      ...blocks.map((block) => Number(block.getAttribute("height"))),
    );
    expect(height).toBeGreaterThan(previousHeight);
    expect(blocks.length).toBeGreaterThan(previousBlocks);
    previousHeight = height;
    previousBlocks = blocks.length;
  }
});

it("maps temporary legacy sector callers to the same mixed city", () => {
  const { container, rerender } = render(
    <CityOccupant variant="residential" />,
  );
  const mixedCity = container.innerHTML;
  rerender(<CityOccupant variant="industrial" />);
  expect(container.innerHTML).toBe(mixedCity);
  rerender(<CityOccupant size="medium" />);
  expect(container.innerHTML).toBe(mixedCity);
});
