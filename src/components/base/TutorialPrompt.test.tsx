import * as React from "react";
import { render, screen } from "@testing-library/react";
import TutorialPrompt from "./TutorialPrompt";

describe("TutorialPrompt", () => {
  it("teaches with words alone, without the concept symbols", () => {
    render(
      <TutorialPrompt
        concepts={["supply", "demand"]}
        text="Keep supply above demand."
      />,
    );

    expect(screen.getByText("Keep supply above demand.")).toBeInTheDocument();
    // Every concept symbol is an image; a words-only prompt carries none of them.
    expect(screen.queryByRole("img")).toBeNull();
  });
});
