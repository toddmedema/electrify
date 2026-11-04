import cloneDeep from "lodash.clonedeep";
import { CHERNOBYL_SCENARIO } from "../data/ChernobylScenario";
import { createGame, runSimulation } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { parseSave, serializeSave } from "../SaveGame";
import { EMPTY_HISTORY, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { getMissionStatus } from "../helpers/MissionStatus";
import { projectMission } from "../helpers/MissionProjection";
import { selectProjection } from "../helpers/Projection";
import { runFailure } from "../helpers/ObjectiveRules";
import { legacyCompletedMonths } from "../helpers/LegacyCampaign";
import { currentTick } from "../helpers/GameSelectors";
import { tickState } from "./Game";

const scenarioId = CHERNOBYL_SCENARIO.id;

it("opens in March without inventing pre-term history or rolling over on its first tick", () => {
  const game = cloneDeep(createGame({ scenarioId }));
  expect(game.date).toMatchObject({
    year: 1986,
    monthNumber: 3,
    monthsElapsed: 2,
  });
  expect(game.date.minute).toBe(2 * MINUTES_PER_MONTH);
  expect(legacyCompletedMonths(game)).toBe(0);
  expect(game.monthlyHistory).toEqual([]);
  expect(game.objectiveProgress?.completedMonths ?? 0).toBe(0);
  expect(getMissionStatus(game).monthsRemaining).toBe(60);
  tickState(game);
  expect(game.date.monthNumber).toBe(3);
  expect(game.monthlyHistory).toEqual([]);
  runMonths(game, 1);
  expect(game.monthlyHistory).toHaveLength(1);
  expect(game.monthlyHistory[0]).toMatchObject({ year: 1986, month: 3 });
  expect(game.date.monthNumber).toBe(4);
  expect(getMissionStatus(game).monthsRemaining).toBe(59);
});

it("counts requested simulator months from the opening month", () => {
  const result = runSimulation({ scenarioId, months: 1 });
  expect(result.options.months).toBe(1);
  expect(result.months).toHaveLength(1);
  expect(result.months[0]).toMatchObject({ year: 1986, month: 3 });
});

it("waives blackout dismissal at every difficulty while keeping bankruptcy", () => {
  const game = createGame({ scenarioId });
  const history = [5, 4, 3].map((month) => ({
    ...EMPTY_HISTORY,
    year: 1986,
    month,
    supplyWh: 0,
    demandWh: 1e12,
  }));
  for (const difficulty of [
    "Intern",
    "Employee",
    "Manager",
    "VP",
    "CEO",
  ] as const) {
    const company = { ...game, difficulty };
    const cash = { cash: 0, minute: game.date.minute };
    expect(
      runFailure(company, CHERNOBYL_SCENARIO, history, cash, false),
    ).toBeUndefined();
    expect(
      runFailure(
        company,
        { ...CHERNOBYL_SCENARIO, reliabilityFailureDisabled: false },
        history,
        cash,
        false,
      )?.outcome,
    ).toBe("fired");
    expect(
      runFailure(
        company,
        CHERNOBYL_SCENARIO,
        history,
        { ...cash, cash: -1 },
        false,
      )?.outcome,
    ).toBe("bankrupt");
  }
});

it("presents reliability as score recovery rather than a loss requirement", () => {
  const game = createGame({ scenarioId });
  expect(
    getMissionStatus(game).requirements.map((requirement) => requirement.id),
  ).toEqual(["cash"]);
  const projected = projectMission(
    game,
    selectProjection(game, currentTick(game)!),
  );
  expect(projected.requirements.map((requirement) => requirement.id)).toEqual([
    "cash",
  ]);
});

it("preserves the opening month and deterministic April recovery state through saves", () => {
  const direct = cloneDeep(createGame({ scenarioId }));
  const opening = parseSave(JSON.parse(JSON.stringify(serializeSave(direct))));
  expect(opening).not.toBeNull();
  expect(opening!.game.startingMonth).toBe(3);
  runMonths(direct, 2);
  const rawSaved = JSON.parse(JSON.stringify(serializeSave(direct)));
  const saved = parseSave(rawSaved);
  expect(saved).not.toBeNull();
  const resumed = cloneDeep(saved!.game);
  runMonths(direct, 1);
  runMonths(resumed, 1);
  expect(resumed.monthlyHistory).toEqual(direct.monthlyHistory);
  expect(resumed.worldEvents).toEqual(direct.worldEvents);
  expect(resumed.facilities).toEqual(direct.facilities);
  for (const startingMonth of [undefined, 1, 2, 4, 0, 13, 2.5, "3"]) {
    const raw = JSON.parse(JSON.stringify(serializeSave(resumed)));
    raw.game.startingMonth = startingMonth;
    expect(parseSave(raw)).toBeNull();
  }
});
