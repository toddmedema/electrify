import { createGame, runSimulation } from "./Simulator";
import { getScenario } from "../data/Scenarios";
import { currentTick } from "../helpers/GameSelectors";
import { landPurchaseQuote } from "../helpers/Territories";
import gameReducer from "../reducers/Game";
import { acquireLand } from "../reducers/GameActions";
import type { InitialBuildType } from "./Simulator";

const oil: InitialBuildType = { name: "Oil", peakW: 50e6, financed: true };

test("reserve purchases go behind the inherited fleet through dispatch actions", () => {
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

test("a rejected later land order cannot pass because an earlier parcel was purchased", () => {
  const options = {
    scenarioId: 116,
    scenario: { ...getScenario(116)!, cash: 3e6 },
    months: 1,
  };
  const before = createGame(options);
  const first = landPurchaseQuote(before, "green-uplands")!;
  const paid = gameReducer(
    before,
    acquireLand({ territoryId: first.territoryId, quoteKey: first.quoteKey }),
  );
  expect(paid.territoryNetwork!.tilePurchases).toEqual([
    { tileId: first.tileId, minute: before.date.minute, price: first.price },
  ]);
  expect(currentTick(paid)!.cash).toBe(options.scenario.cash - first.price);
  const second = landPurchaseQuote(paid, "green-uplands")!;
  expect(second).toBeDefined();
  expect(second.tileId).not.toBe(first.tileId);
  expect(currentTick(paid)!.cash).toBeLessThan(second.price);
  expect(
    gameReducer(
      paid,
      acquireLand({
        territoryId: second.territoryId,
        quoteKey: second.quoteKey,
      }),
    ),
  ).toEqual(paid);

  const order = {
    month: 0,
    type: "land",
    territoryId: "green-uplands",
  } as const;
  expect(() =>
    runSimulation({ ...options, scheduledActions: [order] }),
  ).not.toThrow();
  expect(() =>
    runSimulation({ ...options, scheduledActions: [order, order] }),
  ).toThrow("Land purchase rejected");
});
