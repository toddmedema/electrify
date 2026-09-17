import * as React from "react";
import { render, screen } from "@testing-library/react";
import TutorialPrompt from "./TutorialPrompt";

describe("TutorialPrompt", () => {
  it("teaches the step with its sentence", () => {
    render(<TutorialPrompt text="Keep supply above demand." />);

    expect(screen.getByText("Keep supply above demand.")).toBeInTheDocument();
  });
});
