import * as React from "react";
import { render, screen } from "@testing-library/react";
import TutorialPrompt from "./TutorialPrompt";

describe("TutorialPrompt", () => {
  it("gives the concept sequence an accessible summary", () => {
    render(<TutorialPrompt concepts={["supply", "demand"]} />);

    expect(
      screen.getByLabelText("Tutorial concepts: Supply, Demand"),
    ).toBeInTheDocument();
  });
});
