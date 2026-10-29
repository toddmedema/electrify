import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { runMonths } from "./SimulationTestHelpers";
import { createGame, runSimulation } from "./Simulator";
import { expectNoViolations } from "./SimulationTestHelpers";
import { scenarioObjectiveFailure } from "../reducers/Game";
jest.setTimeout(120000);

it.each(["Intern", "CEO"] as const)(
  "wildfire requires preparation and permits distinct local supply plans on %s",
  (difficulty) => {
    for (const seed of [12345, 1, 7]) {
      const play = (name?: string, peakW?: number) =>
        runSimulation({
          scenarioId: 111,
          difficulty,
          seed,
          ...(name
            ? { initialBuild: { name, peakW: peakW!, financed: true } }
            : {}),
        });
      const neglected = play();
      expectNoViolations(neglected);
      expect(neglected.outcome).toBe("fired");
      expect(
        scenarioObjectiveFailure(
          neglected.scenario,
          [...neglected.months].reverse(),
        ),
      ).toMatch(/intertie outage/);
      for (const [name, peakW] of [
        ["Natural Gas Peaker", 20e6],
        ["Natural Gas CC", 30e6],
      ] as const) {
        const prepared = play(name, peakW);
        expectNoViolations(prepared);
        expect(prepared.outcome).toBe("completed");
        expect(
          scenarioObjectiveFailure(
            prepared.scenario,
            [...prepared.months].reverse(),
          ),
        ).toBeUndefined();
      }
      const upgrades = runSimulation({
        scenarioId: 111,
        difficulty,
        seed,
        scheduledActions: [0, 12, 24].map((month) => ({
          month,
          type: "intertie-upgrade",
          corridorId: "california-north",
          financed: true,
        })),
      });
      expectNoViolations(upgrades);
      expect(
        scenarioObjectiveFailure(
          upgrades.scenario,
          [...upgrades.months].reverse(),
        ),
      ).toBeDefined();
    }
  },
);

it("preserves the outage and its restoration across save continuation", () => {
  const game = createGame({
    scenarioId: 111,
    difficulty: "CEO",
    seed: 7,
    initialBuild: { name: "Natural Gas CC", peakW: 30e6, financed: true },
  });
  runMonths(game, 37);
  const resumed = cloneDeep(parseSave(serializeSave(game))!.game);
  runMonths(game, 2);
  runMonths(resumed, 2);
  expect(resumed.monthlyHistory).toEqual(game.monthlyHistory);
  expect(resumed.worldEvents).toEqual(game.worldEvents);
});
