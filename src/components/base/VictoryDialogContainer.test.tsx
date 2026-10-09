import { DIFFICULTY_IDS } from "../../Constants";
import { store } from "../../Store";
import { delta, quit } from "../../reducers/Game";
import { delta as uiDelta, victoryOpen } from "../../reducers/UI";
import { VictoryType } from "../../Types";
import { mapDispatchToProps } from "./VictoryDialogContainer";

jest.mock("../../SaveSession", () => ({
  saveSessionMiddleware:
    () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  runSaveTransition: (proceed: () => void) => {
    proceed();
    return Promise.resolve(true);
  },
}));

afterEach(() => {
  store.dispatch(quit());
  store.dispatch(uiDelta({ previewDifficulty: undefined }));
});

describe.each(["bankrupt", "fired", "completed"] as const)(
  "retrying a %s scenario",
  (outcome) => {
    it.each(DIFFICULTY_IDS)("preserves %s difficulty", (difficulty) => {
      const victory: VictoryType = {
        scenarioId: 101,
        scenarioName: "Rise of Renewables",
        difficulty,
        score: 100,
        breakdown: { supply: 100 },
        ranked: true,
        outcome,
      };
      store.dispatch(
        delta({
          scenarioId: victory.scenarioId,
          difficulty,
          inGame: true,
          date: { ...store.getState().game.date, monthsElapsed: 144 },
        }),
      );
      // A difficulty preview from browsing another scenario must not affect this retry.
      store.dispatch(uiDelta({ previewDifficulty: "Employee" }));
      store.dispatch(victoryOpen(victory));

      mapDispatchToProps(store.dispatch).onRetry(victory);

      const { game, card, ui } = store.getState();
      expect(game.scenarioId).toBe(victory.scenarioId);
      expect(game.difficulty).toBe(difficulty);
      expect(game.inGame).toBe(false);
      expect(game.date.monthsElapsed).toBe(0);
      expect(game.timeline).toEqual([]);
      expect(card.name).toBe("LOADING");
      expect(ui.victory).toBeNull();
    });
  },
);
