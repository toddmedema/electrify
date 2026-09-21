import * as React from "react";
import { render } from "@testing-library/react";
import FlowBar from "./FlowBar";

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
function bar(fraction: number, color = "#ac4e13"): HTMLElement {
  const { container } = render(<FlowBar fraction={fraction} color={color} />);
  return container.querySelector(".outputProgressBar") as HTMLElement;
}

describe("FlowBar", () => {
  it("scales forward flow from the left edge in the row's own accent", () => {
    const element = bar(0.4);
    expect(element).not.toHaveClass("reverseFlow");
    expect(element.style.transform).toBe("scaleX(0.4)");
    expect(element.style.width).toBe("");
    expect(element.style.backgroundColor).toBe("rgba(172, 78, 19, 0.18)");
  });

  it("gives reverse flow its own class, colour and magnitude", () => {
    const element = bar(-0.4);
    expect(element).toHaveClass("reverseFlow");
    // Sized by width rather than scaleX, so the stylesheet's hatch isn't squashed with the fill
    expect(element.style.width).toBe("40%");
    expect(element.style.transform).toBe("");
    expect(element.style.backgroundColor).not.toBe("rgba(172, 78, 19, 0.18)");
  });

  it("keeps full reverse flow distinguishable from full forward flow", () => {
    const forward = bar(1);
    const reverse = bar(-1);
    // Both cover the whole row, so the class carrying the hatch is the only thing standing
    // between them and being the same picture
    expect(forward).not.toHaveClass("reverseFlow");
    expect(reverse).toHaveClass("reverseFlow");
    expect(reverse.style.width).toBe("100%");
  });

  it("clamps beyond the rating rather than overflowing the row", () => {
    expect(bar(2.5).style.transform).toBe("scaleX(1)");
    expect(bar(-2.5).style.width).toBe("100%");
  });

  it("leaves background-image to the stylesheet so the hatch survives", () => {
    // Setting the `background` shorthand inline would clear background-image and take the
    // diagonal with it, leaving hue as the only thing marking direction
    expect(bar(-0.5).style.backgroundImage).toBe("");
    expect(bar(0.5).style.backgroundImage).toBe("");
  });

  it("treats a facility that has never run as neither direction", () => {
    const element = bar(0);
    expect(element).not.toHaveClass("reverseFlow");
    expect(element.style.transform).toBe("scaleX(0)");
  });
});
