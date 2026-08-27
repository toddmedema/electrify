import * as React from "react";
import { render, screen } from "@testing-library/react";
import ConceptIcon, {
  CONCEPT_LABELS,
  CONCEPT_NAMES,
  ConceptNameType,
} from "./ConceptIcon";

describe("ConceptIcon", () => {
  it.each(CONCEPT_NAMES)("gives %s its shared accessible label", (concept) => {
    const view = render(<ConceptIcon concept={concept} />);
    const icon = screen.getByLabelText(CONCEPT_LABELS[concept]);
    expect(icon).toHaveAttribute("data-concept", concept);
    view.unmount();
  });

  it("keeps the vocabulary list and label catalog in sync", () => {
    expect(new Set(CONCEPT_NAMES)).toHaveProperty(
      "size",
      Object.keys(CONCEPT_LABELS).length,
    );
    expect(CONCEPT_NAMES).toEqual(
      expect.arrayContaining(Object.keys(CONCEPT_LABELS) as ConceptNameType[]),
    );
  });
});
