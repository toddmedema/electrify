import * as React from "react";
import { render, screen } from "@testing-library/react";
import TutorialPrompt from "./TutorialPrompt";

describe("TutorialPrompt", () => {
  it("keeps the instruction to one concise line", () => {
    render(
      <TutorialPrompt
        concepts={["build", "generator"]}
        text="Open the generator shop."
      />,
    );

    expect(screen.getByText("Open the generator shop.")).toBeInTheDocument();
    expect(screen.queryByText("Do this to continue:")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("gives the concept sequence an accessible summary", () => {
    render(<TutorialPrompt concepts={["supply", "demand"]} />);

    expect(
      screen.getByLabelText("Tutorial concepts: Supply, Demand"),
    ).toBeInTheDocument();
  });
});
