import * as React from "react";
import { render } from "@testing-library/react";
import FacilityRowText from "./FacilityRowText";
import { constructionStatus } from "./ConstructionProgress";

/* eslint-disable testing-library/no-node-access, testing-library/no-container */
describe("constructionStatus", () => {
  it("reads as a rounded percentage with the months still to go", () => {
    expect(constructionStatus(0.256, 0.75)).toEqual({
      reading: "Building 26%",
      detail: "9 months left",
      // What an intertie's accessible name says, so speech input can name what the row shows
      label: "Building 26% · 9 months left",
    });
  });

  it("rounds a partial month up and says 'month' for exactly one", () => {
    expect(constructionStatus(0.5, 0.08).detail).toBe("1 month left");
    expect(constructionStatus(0.5, 0.001).detail).toBe("1 month left");
    expect(constructionStatus(0.5, 1.08).detail).toBe("13 months left");
  });
});

describe("FacilityRowText", () => {
  function rowText(
    props: Partial<React.ComponentProps<typeof FacilityRowText>> = {},
  ) {
    const { container } = render(
      <FacilityRowText
        name={<span className="facilityName">Northern intertie</span>}
        status="Building 40%"
        detail="6 months left"
        {...props}
      />,
    );
    return container.querySelector(".facilityText") as HTMLElement;
  }

  it("leads with the reading and keeps the detail separate so it can give way first", () => {
    const text = rowText();
    expect(text.querySelector(".facilityName")).toHaveTextContent(
      "Northern intertie",
    );
    expect(text.querySelector(".facilityStatus")).toHaveTextContent(
      "Building 40%",
    );
    const detail = text.querySelector(".facilityStatusDetail")!;
    expect(detail).toHaveTextContent("· 6 months left");
    // The separator is only punctuation, so a screen reader is not asked to read it out
    expect(detail.querySelector(".facilityStatusSeparator")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("draws no detail and no meter for a row that is not being built", () => {
    const text = rowText({
      status: "Idle 0/270MW",
      detail: undefined,
    });
    expect(text.querySelector(".facilityStatusDetail")).toBeNull();
    expect(text.querySelector(".constructionProgress")).toBeNull();
  });

  it.each([true, false])(
    "draws the construction meter as a decorative sibling of the text (paused: %s)",
    (paused) => {
      const text = rowText({ progress: { builtFraction: 0.4, paused } });
      const bar = text.querySelector(".constructionProgress")!;
      // The percentage is in the text already, so the meter stays out of the accessibility tree
      expect(bar).toHaveAttribute("aria-hidden", "true");
      expect(bar).toHaveAttribute("data-paused", String(paused));
      expect(bar.parentElement).toBe(text);
      // The fill is sized and nothing else: its colour belongs to the stylesheet, so every row
      // type draws the same neutral meter
      const fill = bar.querySelector(".constructionProgressFill")!;
      expect(fill.getAttribute("style")).toBe("width: 40%;");
    },
  );

  it("places an extra line after the status without disturbing it", () => {
    const text = rowText({
      children: <span className="utilityAcquisitionHint">Hint</span>,
    });
    expect(text.lastElementChild).toHaveClass("utilityAcquisitionHint");
    expect(text.querySelector(".facilityStatus")).toHaveTextContent(
      "Building 40%",
    );
  });
});
