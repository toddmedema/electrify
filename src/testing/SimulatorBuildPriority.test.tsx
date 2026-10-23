import { createGame, runSimulation } from "./Simulator";
import type { InitialBuildType } from "./Simulator";

const oil: InitialBuildType = { name: "Oil", peakW: 50e6, financed: true };

test("reserve purchases go behind the inherited fleet through recorded dispatch actions", () => {
  const normal = createGame({ scenarioId: 106, initialBuild: oil });
  const explicitDefault = createGame({
    scenarioId: 106,
    initialBuild: { ...oil, priority: "default" },
  });
  const reserve = createGame({
    scenarioId: 106,
    initialBuild: { ...oil, priority: "reserve" },
  });
  expect(normal.facilities.map(({ id }) => id)).toEqual([3, 1, 2]);
  expect(explicitDefault).toEqual(normal);
  expect(reserve.facilities.map(({ id }) => id)).toEqual([1, 2, 3]);
  expect(
    reserve.replayLog?.filter(({ type }) => type === "reprioritizeFacility"),
  ).toEqual([
    expect.objectContaining({ payload: { spotInList: 0, delta: 1 } }),
    expect.objectContaining({ payload: { spotInList: 1, delta: 1 } }),
  ]);
  expect(reserve.facilities.find(({ id }) => id === 3)).toMatchObject({
    loanAmountLeft: expect.any(Number),
    yearsToBuildLeft: expect.any(Number),
  });
  expect(
    reserve.facilities.find(({ id }) => id === 3)!.loanAmountLeft,
  ).toBeGreaterThan(0);
  expect(
    reserve.facilities.find(({ id }) => id === 3)!.yearsToBuildLeft,
  ).toBeGreaterThan(0);
});

test("a rejected reserve cash purchase never reorders an existing asset", () => {
  const before = createGame({ scenarioId: 106 });
  const rejected = createGame({
    scenarioId: 106,
    initialBuild: {
      name: "Oil",
      peakW: 100000e6,
      financed: false,
      priority: "reserve",
    },
  });
  expect(rejected.facilities).toEqual(before.facilities);
  expect(rejected.replayLog).toEqual(before.replayLog);
});

test("the public simulation API rejects an unknown build priority", () => {
  expect(() =>
    createGame({
      scenarioId: 106,
      initialBuild: {
        ...oil,
        priority: "cheat" as InitialBuildType["priority"],
      },
    }),
  ).toThrow("Build priority must be default or reserve");
});

test("scheduled reserve orders use the same placement contract", () => {
  const result = runSimulation({
    scenarioId: 106,
    months: 1,
    scheduledActions: [
      { month: 0, type: "build", build: { ...oil, priority: "reserve" } },
    ],
  });
  expect(result.violations).toEqual([]);
  expect(result.builds).toHaveLength(1);
  expect(result.finalFacilities.map(({ id }) => id)).toEqual([1, 2, 3]);
});
