import { render, screen } from "@testing-library/react";
import { chartPalette } from "../../Theme";
import { demandRange, PolicyDemandLegend } from "./PolicyDemandChart";

describe("demandRange", () => {
  it("fits the axis to the curves so a small program change is visible", () => {
    const [min, max] = demandRange(900e6, 1000e6);
    expect(min).toBeCloseTo(890e6);
    expect(max).toBeCloseTo(1010e6);
  });

  it("never runs below zero", () => {
    expect(demandRange(1e6, 100e6)[0]).toBe(0);
  });

  it("still gives a flat day some height", () => {
    const [min, max] = demandRange(500, 500);
    expect(max).toBeGreaterThan(min);
  });
});

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
describe("PolicyDemandLegend", () => {
  it("keys each plan with the plotted line's colour and dash rather than a text glyph", () => {
    const { container } = render(<PolicyDemandLegend />);
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("With this change")).toBeInTheDocument();
    const lines = container.querySelectorAll(".chartLegendSwatch-line line");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("stroke", chartPalette().demand);
    expect(lines[0]).toHaveAttribute("stroke-dasharray", "none");
    expect(lines[1]).toHaveAttribute("stroke", chartPalette().supply);
    expect(lines[1]).toHaveAttribute("stroke-dasharray", "6 4");
  });
});
