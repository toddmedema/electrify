import * as React from "react";
import { render, screen } from "@testing-library/react";
import TutorialPrompt from "./TutorialPrompt";

describe("TutorialPrompt", () => {
  it("names the required action for a gated step", () => {
    render(
      <TutorialPrompt
        concepts={["build", "generator"]}
        text="Open the generator shop."
        action={["build", "generator"]}
      />,
    );

    expect(screen.getByText("Do this to continue:")).toBeInTheDocument();
    expect(screen.getByText("build then generator")).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "Required action: build then generator",
      }),
    ).toBeInTheDocument();
  });

  it("gives the concept sequence an accessible summary", () => {
    render(<TutorialPrompt concepts={["supply", "demand"]} />);

    expect(
      screen.getByLabelText("Tutorial concepts: Supply, Demand"),
    ).toBeInTheDocument();
  });
});
