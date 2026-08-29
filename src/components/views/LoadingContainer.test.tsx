import { UnknownAction } from "@reduxjs/toolkit";
import { TUTORIALS } from "../../data/Scenarios";
import { restoreTutorialAfterLoading } from "./LoadingContainer";

it("restores a capstone's authored pane after rebuilding its scenario", () => {
  const finances = TUTORIALS.find((tutorial) => tutorial.id === 4)!;
  const capstone = finances.tutorialSteps!.findIndex((step) => step.capstone);
  const dispatched: UnknownAction[] = [];

  restoreTutorialAfterLoading(
    ((action: UnknownAction) => {
      dispatched.push(action);
      return action;
    }) as never,
    finances.tutorialSteps!,
    capstone,
  );

  expect(dispatched).toEqual([
    expect.objectContaining({ type: "card/navigate", payload: "INSIGHTS" }),
    expect.objectContaining({
      type: "game/delta",
      payload: { tutorialStep: capstone },
    }),
  ]);
});
