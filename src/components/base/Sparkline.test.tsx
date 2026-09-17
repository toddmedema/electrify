/* eslint-disable testing-library/no-container, testing-library/no-node-access --
   The geometry of the drawn SVG is the behaviour under test, and it has no accessible text */
import * as React from "react";
import { render } from "@testing-library/react";
import Sparkline from "./Sparkline";

function draw(element: React.ReactElement) {
  const { container } = render(element);
  return container.querySelector("svg")!;
}

function yValues(svg: SVGElement): number[] {
  return svg
    .querySelector("polyline")!
    .getAttribute("points")!
    .split(" ")
    .map((point) => Number(point.split(",")[1]));
}

describe("Sparkline", () => {
  it("renders an ordinary trend exactly as before", () => {
    const svg = draw(
      <Sparkline values={[1, 3, 2]} color="#123456" ariaLabel="Trend" />,
    );
    expect(svg.getAttribute("width")).toBe("72");
    expect(svg.querySelector("polyline")!.getAttribute("points")).toBe(
      "0.0,19.3 36.0,0.8 72.0,10.0",
    );
    expect(svg.querySelector("polygon")).toBeNull();
    expect(svg.querySelector("circle")).toBeNull();
    expect(svg.querySelector("line")).toBeNull();
    expect(
      svg.querySelector("polyline")!.getAttribute("stroke-dasharray"),
    ).toBeNull();
  });

  it("scales against a shared domain instead of the series' own range", () => {
    const own = yValues(
      draw(<Sparkline values={[0.1, 0.2]} ariaLabel="Own range" height={24} />),
    );
    const shared = yValues(
      draw(
        <Sparkline
          values={[0.1, 0.2]}
          domain={[0, 1]}
          ariaLabel="Shared range"
          height={24}
        />,
      ),
    );
    expect(own[0] - own[1]).toBeCloseTo(22.5);
    expect(shared[0] - shared[1]).toBeCloseTo(2.25, 0);
  });

  it("draws a flat series without NaN", () => {
    const svg = draw(
      <Sparkline
        values={[0, 0, 0]}
        domain={[0, 0]}
        fill
        lowMarker
        ariaLabel="Flat"
      />,
    );
    expect(svg.innerHTML).not.toContain("NaN");
  });

  it("marks the lowest value on a filled line", () => {
    const svg = draw(
      <Sparkline
        values={[0.5, 0.1, 0.3]}
        domain={[0, 1]}
        fill
        lowMarker
        baseline
        ariaLabel="Filled"
      />,
    );
    expect(svg.querySelector("polygon")).not.toBeNull();
    expect(svg.querySelector("line")).not.toBeNull();
    expect(svg.querySelector("circle")!.getAttribute("cx")).toBe("36.0");
  });

  it("leaves a dashed line without fill or marker", () => {
    const svg = draw(
      <Sparkline values={[1, 1]} dash fill lowMarker ariaLabel="Available" />,
    );
    expect(
      svg.querySelector("polyline")!.getAttribute("stroke-dasharray"),
    ).toBe("4 3");
    expect(svg.querySelector("polygon")).toBeNull();
    expect(svg.querySelector("circle")).toBeNull();
  });
});
