import { recordIntent } from "../../achievements/Progress";
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { StateProps } from "./CustomGame";
import { achievementJournal } from "../../achievements/Journal";
import { modScenario } from "../../mods/ModScenario";
import { DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import { getCustomScenario, recordCustomScenario } from "../../LocalStorage";
import { launchCustomScenario } from "../../reducers/Game";
import type { AppStateType, ScenarioType } from "../../Types";
import CustomGameContainer, {
  mapDispatchToProps,
  mapStateToProps,
} from "./CustomGameContainer";

jest.mock("./CustomGame", () => ({
  __esModule: true,
  default: ({ game, unlockedThrough }: StateProps) =>
    `${game.difficulty}/${unlockedThrough}`,
}));

jest.mock("./StartGame", () => ({
  startWithSaveGuard: (_dispatch: unknown, start: () => void) => start(),
}));
jest.mock("../../reducers/Game", () => ({ launchCustomScenario: jest.fn() }));
jest.mock("../../Store", () => ({
  store: { getState: () => ({ ui: {}, game: { difficulty: "Manager" } }) },
}));

const setup: ScenarioType = {
  ...DEFAULT_CUSTOM_SCENARIO,
  name: "My setup",
  startingYear: 2030,
};
const modded = modScenario({
  schemaVersion: 1,
  gameApi: 1,
  id: "grid",
  title: "Community Grid",
  creator: "A",
  version: "1",
  description: "A community grid that must not seed custom setup.",
  seed: 42,
  baseScenarioId: 999,

  facilities: { Solar: { buildCost: 0.5 } },
});
const state = (customScenario?: ScenarioType) =>
  ({
    ui: {},
    game: { difficulty: "Manager", customScenario },
  }) as unknown as AppStateType;

beforeEach(() => {
  localStorage.clear();
  achievementJournal.refresh();
});

test("a running mod never seeds or leaks into the custom game setup", () => {
  recordCustomScenario(setup);
  const props = mapStateToProps(state(modded));
  expect(props.scenario.mod).toBeUndefined();
  expect(props.scenario.name).toBe("My setup");
  // An ordinary custom run still reopens where the player left it.
  expect(mapStateToProps(state(setup)).scenario).toBe(setup);
});

test("starting or remembering a custom game strips any mod effects", () => {
  const dispatch = jest.fn();
  mapDispatchToProps(dispatch).onStart(modded);
  const [, started, difficulty] = (launchCustomScenario as jest.Mock).mock
    .calls[0];
  expect(started.mod).toBeUndefined();
  expect(started.name).toBe("Community Grid");
  expect(difficulty).toBe("Intern");
  expect(getCustomScenario(DEFAULT_CUSTOM_SCENARIO).mod).toBeUndefined();
  // Stored mod snapshots are stripped from ordinary custom setup on read.
  localStorage.setItem("customGame", JSON.stringify(modded));
  expect(getCustomScenario(DEFAULT_CUSTOM_SCENARIO).mod).toBeUndefined();
});

it("updates the connected picker immediately when synced wins unlock another level", () => {
  const appStore = configureStore({ reducer: () => state() });
  render(
    <Provider store={appStore}>
      <CustomGameContainer />
    </Provider>,
  );
  expect(screen.getByText("Intern/Intern")).toBeInTheDocument();
  act(() => {
    achievementJournal.merge(
      recordIntent({
        earned: [],
        completion: { scenarioId: 100, difficulty: "Intern" },
      }),
    );
  });
  expect(screen.getByText("Employee/Employee")).toBeInTheDocument();
});
