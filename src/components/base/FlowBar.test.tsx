import * as React from "react";
import { render } from "@testing-library/react";
import FlowBar from "./FlowBar";

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
function bar(fraction: number): HTMLElement {
  const { container } = render(<FlowBar fraction={fraction} />);
  return container.querySelector(".outputProgressBar") as HTMLElement;
}

describe("FlowBar", () => {
  it("scales forward flow from the left edge", () => {
    const element = bar(0.4);
    expect(element).not.toHaveClass("reverseFlow");
    expect(element.style.transform).toBe("scaleX(0.4)");
  });

  it("gives reverse flow its own direction and magnitude", () => {
    const element = bar(-0.4);
    expect(element).toHaveClass("reverseFlow");
    // Sized by width rather than scaleX, so the stylesheet's hatch isn't squashed with the fill
    expect(element.style.width).toBe("40%");
  });

  it("clamps beyond the rating rather than overflowing the row", () => {
    expect(bar(2.5).style.transform).toBe("scaleX(1)");
    expect(bar(-2.5).style.width).toBe("100%");
  });

  it("treats a facility that has never run as neither direction", () => {
    const element = bar(0);
    expect(element).not.toHaveClass("reverseFlow");
    expect(element.style.transform).toBe("scaleX(0)");
  });
});
