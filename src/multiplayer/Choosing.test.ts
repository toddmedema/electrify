import type { AppStateType } from "../Types";
import { hostSelection } from "./Choosing";

it("mirrors the host's difficulty without holding it back for single-player unlocks", () => {
  const state = {
    card: { name: "NEW_GAME_DETAILS" },
    game: { difficulty: "CEO" },
    ui: { scenarioPreview: 101 },
  } as AppStateType;
  expect(hostSelection(state)).toMatchObject({
    scenarioId: 101,
    difficulty: "CEO",
  });
  expect(
    hostSelection({
      ...state,
      ui: { ...state.ui, previewDifficulty: "Intern" },
    }),
  ).toMatchObject({ difficulty: "Intern" });
});
