import { getGameEffects } from "./StoreRegistry";
import { logEvent } from "./Globals";
import { recordScenarioPlayed } from "./LocalStorage";
import { submitHighscore } from "./reducers/User";
import { store } from "./Store";
import type { HighscoreSubmissionType } from "./reducers/User";

jest.mock("./Globals", () => ({
  ...jest.requireActual("./Globals"),
  logEvent: jest.fn(),
}));
jest.mock("./LocalStorage", () => ({
  ...jest.requireActual("./LocalStorage"),
  recordScenarioPlayed: jest.fn(),
}));
jest.mock("./reducers/User", () => ({
  ...jest.requireActual("./reducers/User"),
  submitHighscore: jest.fn(() => ({ type: "test/highscore" })),
}));

it("registers the live game's telemetry, history and score effects", () => {
  (submitHighscore as unknown as jest.Mock).mockReturnValue({
    type: "test/highscore",
  });
  const dispatch = jest.spyOn(store, "dispatch");
  const effects = getGameEffects();
  const submission: HighscoreSubmissionType = {
    outcome: "completed",
    score: 123,
    scoreBreakdown: { financial: 123, environmental: 0, service: 0 },
    scenarioId: 101,
    difficulty: "Intern",
  };

  effects.logEvent("scenario_end", { scenario_id: 101 });
  effects.recordScenarioPlayed(101);
  effects.submitHighscore(submission);

  expect(logEvent).toHaveBeenCalledWith("scenario_end", { scenario_id: 101 });
  expect(recordScenarioPlayed).toHaveBeenCalledWith(101);
  expect(submitHighscore).toHaveBeenCalledWith(submission);
  expect(dispatch).toHaveBeenCalledWith({ type: "test/highscore" });
  dispatch.mockRestore();
});
