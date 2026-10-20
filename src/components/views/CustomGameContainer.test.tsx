import { DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import { getCustomScenario, recordCustomScenario } from "../../LocalStorage";
import { launchCustomScenario } from "../../reducers/Game";
import type { AppStateType, ScenarioType } from "../../Types";
import { mapDispatchToProps, mapStateToProps } from "./CustomGameContainer";

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
const modded: ScenarioType = {
  ...DEFAULT_CUSTOM_SCENARIO,
  name: "Community Grid",
  mod: {
    source: { id: "grid", title: "Community Grid", creator: "A", version: "1" },
    facilities: { Solar: { buildCost: 0.5 } },
  },
};
const state = (customScenario?: ScenarioType) =>
  ({
    ui: {},
    game: { difficulty: "Manager", customScenario },
  }) as unknown as AppStateType;

beforeEach(() => localStorage.clear());

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
  expect(difficulty).toBe("Manager");
  expect(getCustomScenario(DEFAULT_CUSTOM_SCENARIO).mod).toBeUndefined();
  // Even a stored mod from an older build is stripped on read.
  localStorage.setItem("customGame", JSON.stringify(modded));
  expect(getCustomScenario(DEFAULT_CUSTOM_SCENARIO).mod).toBeUndefined();
});
