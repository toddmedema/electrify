import type { AppStateType } from "../Types";
import { hostSelection } from "./Choosing";

it("mirrors the unlocked host difficulty used for launch while preserving an allowed choice", () => {
  const state = {
    card: { name: "NEW_GAME_DETAILS" },
    game: { difficulty: "CEO" },
    ui: { scenarioPreview: 101 },
  } as AppStateType;
  expect(hostSelection(state, "Intern")).toMatchObject({
    scenarioId: 101,
    difficulty: "Intern",
  });
  expect(hostSelection(state, "Employee")).toMatchObject({
    difficulty: "Employee",
  });
  expect(
    hostSelection(
      { ...state, ui: { ...state.ui, previewDifficulty: "Intern" } },
      "Employee",
    ),
  ).toMatchObject({ difficulty: "Intern" });
});
