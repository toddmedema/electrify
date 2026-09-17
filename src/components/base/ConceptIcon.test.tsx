import * as React from "react";
import { render, screen } from "@testing-library/react";
import ConceptIcon, { CONCEPT_LABELS, CONCEPT_NAMES } from "./ConceptIcon";

describe("ConceptIcon", () => {
  it("gives every concept its shared accessible label", () => {
    CONCEPT_NAMES.forEach((concept) => {
      const view = render(<ConceptIcon concept={concept} />);
      const icon = screen.getByLabelText(CONCEPT_LABELS[concept]);
      expect(icon).toHaveAttribute("data-concept", concept);
      view.unmount();
    });
  });
});
