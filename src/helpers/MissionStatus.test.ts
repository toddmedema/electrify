import { createNextState as produce } from "@reduxjs/toolkit";
import { createGame } from "../testing/Simulator";
import { SCENARIOS, TUTORIALS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { GameType, MonthlyHistoryType, MeaningfulDecisionType } from "../Types";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "./DateTime";
import {
  cashRunwayMonths,
  getMissionStatus,
  projectedShortfall,
  selectMissionRisk,
} from "./MissionStatus";
import * as GameModule from "../reducers/Game";
import { selectProjection } from "./Projection";
import { selectUpcomingStoryEvents } from "../components/views/StoryEventSelectors";
import { store } from "../Store";

const createNextState = (
  game: GameType,
  recipe: (game: GameType) => void,
): GameType => produce(game, (draft) => recipe(draft as GameType));

const wildfire = SCENARIOS.find((s) => s.id === 111)!;
function fixture(month = 0): GameType {
  const game = createGame({ scenarioId: 111 });
  return createNextState(game, (draft) => {
    draft.date = getDateFromMinute(
      month * MINUTES_PER_MONTH,
      draft.startingYear,
    );
    draft.monthlyHistory = [];
    draft.timeline = [
      Object.assign({}, draft.timeline[0], {
        minute: draft.date.minute,
        supplyW: 100,
        demandW: 100,
        reserveW: 0,
        cash: 100,
      }),
    ];
  });
}
const monthRow = (
  year: number,
  month: number,
  supplyWh = 100,
  demandWh = 100,
): MonthlyHistoryType => ({
  ...EMPTY_HISTORY,
  year,
  month,
  supplyWh,
  demandWh,
  customers: 16000,
});
const requirement = (game: GameType, id: string) =>
  getMissionStatus(game).requirements.find((row) => row.id === id)!;

test("wildfire window is pending, partial, complete or failed using completed months", () => {
  expect(getMissionStatus(fixture(11)).headline?.id).toBe("reliability");
  expect(requirement(fixture(11), "reliability").status).toBe("pending");
  expect(requirement(fixture(12), "reliability").status).toBe("in-progress");
  const partial = createNextState(fixture(13), (g) => {
    g.monthlyHistory = [monthRow(2025, 2, 0), monthRow(2025, 1)];
  });
  expect(requirement(partial, "reliability").status).toBe("in-progress");
  expect(requirement(partial, "reliability").current).toContain(
    "1 of 2 months counted",
  );
  const completed = createNextState(fixture(14), (g) => {
    g.monthlyHistory = [monthRow(2025, 2), monthRow(2025, 1)];
  });
  expect(requirement(completed, "reliability").status).toBe("completed");
  const failed = createNextState(completed, (g) => {
    g.monthlyHistory[0].supplyWh = 99;
  });
  expect(requirement(failed, "reliability").status).toBe("failed");
  expect(getMissionStatus(failed).prominent?.id).toBe("reliability");
  expect(getMissionStatus(failed).headline?.compact).toContain("(99%)");
  expect(
    GameModule.scenarioObjectiveFailure(wildfire, failed.monthlyHistory),
  ).toContain("99.00%");
});

test("empty and partial required history stay unknown even at term end without changing canonical outcome", () => {
  for (const months of [14, 36]) {
    for (const rows of [[], [monthRow(2025, 1)]]) {
      const game = createNextState(fixture(months), (g) => {
        g.monthlyHistory = rows;
      });
      expect(requirement(game, "reliability").status).toBe("unknown");
      expect(requirement(game, "reliability").current).toContain(
        "not verifiable",
      );
      expect(getMissionStatus(game).headline?.compact).toContain(
        "incomplete history",
      );
      expect(
        GameModule.scenarioObjectiveFailure(wildfire, rows),
      ).toBeUndefined();
    }
  }
  expect(getMissionStatus(fixture(36)).finalNote).toContain(
    "recorded final outcome",
  );
  expect(getMissionStatus(fixture(36)).monthsRemaining).toBe(0);
});

test("zero demand shares evaluator measurement and cannot invent blackout failure", () => {
  const game = createNextState(fixture(14), (g) => {
    g.monthlyHistory = [
      monthRow(2025, 2, 0, 0),
      monthRow(2025, 1, 0, 0),
      monthRow(2024, 12, 0, 0),
    ];
  });
  expect(requirement(game, "reliability").status).toBe("completed");
  expect(requirement(game, "survival").status).toBe("in-progress");
  expect(
    GameModule.scenarioObjectiveFailure(wildfire, game.monthlyHistory),
  ).toBeUndefined();
});

test("survival is chronological completed evidence and ignores current partial history", () => {
  const game = createNextState(fixture(5), (g) => {
    g.monthlyHistory = [
      monthRow(2024, 3, 80),
      monthRow(2024, 6),
      monthRow(2024, 5, 80),
      monthRow(2024, 4, 80),
    ];
  });
  expect(requirement(game, "survival").status).toBe("failed");
  expect(requirement(game, "survival").compact).toBe(
    "Avoid 3 consecutive months < 90% served (80%, 80%, 80%)",
  );
  expect(requirement(game, "cash").timing).toContain(
    "negative cash now is a warning",
  );
  expect(requirement(fixture(), "survival").status).toBe("unknown");
  expect(
    requirement(
      createNextState(game, (g) => {
        g.monthlyHistory.splice(2, 1);
      }),
      "survival",
    ).status,
  ).toBe("unknown");
});

test("retention shows current customers against final target and remains recoverable", () => {
  const scenario = SCENARIOS.find(
    (s) => s.minimumCustomerRetention !== undefined,
  )!;
  const game = createGame({ scenarioId: scenario.id });
  const low = createNextState(game, (g) => {
    g.timeline[0].customers = 1;
  });
  expect(requirement(low, "retention").status).toBe("in-progress");
  expect(getMissionStatus(low).headline?.id).toBe("retention");
  expect(getMissionStatus(low).headline?.compact).toMatch(
    /^Customers ≥ .* \(1\)$/,
  );
  expect(requirement(low, "retention").target).toContain("customers");
  expect(requirement(low, "retention").timing).toContain(
    "Required at term end",
  );
});

test("decision gates use retained categories, waiver and tutorial/custom rules", () => {
  const game = createNextState(fixture(), (g) => {
    g.difficulty = "CEO";
    g.meaningfulDecisions = [
      {
        key: "asset:1",
        lever: "asset:1",
        label: "Plant",
        kind: "asset",
        before: "0",
        after: "1",
        month: 0,
      } as MeaningfulDecisionType,
    ];
  });
  expect(requirement(game, "decisions").current).toContain(
    "1 decisions across 1 categories",
  );
  expect(requirement(game, "decisions").compact).toBe(
    "Decisions ≥ 10 (1) · Categories ≥ 4 (1)",
  );
  expect(requirement(game, "decisions").target).toContain(
    "10 decisions across 4 categories",
  );
  expect(
    requirement(
      createNextState(game, (g) => {
        g.meaningfulDecisionGateWaived = true;
      }),
      "decisions",
    ).status,
  ).toBe("waived");
  const tutorial = createGame({ scenarioId: TUTORIALS[0].id });
  expect(
    getMissionStatus(tutorial).requirements.some((r) => r.id === "decisions"),
  ).toBe(false);
  expect(getMissionStatus(tutorial).requirements.map((r) => r.id)).toEqual(
    expect.arrayContaining(["cash", "survival"]),
  );
  const custom = createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: { ...wildfire, id: CUSTOM_SCENARIO_ID, name: "My grid" },
  });
  expect(getMissionStatus(custom).label).toBe("My grid");
  expect(getMissionStatus(custom).scoreNote).toContain("separate");
});

test("risk precedence distinguishes actual shortage, cash, required failure, sample and public event", () => {
  const event = {
    key: "b",
    startsMinute: 60,
    label: "Event",
    message: "Public",
    actionTarget: { card: "EVENTS" as const },
  };
  const future = createNextState(fixture(), (g) => {
    g.timeline.push(
      Object.assign({}, g.timeline[0], { minute: 15, supplyW: 99 }),
    );
  });
  expect(selectMissionRisk(future, [event])?.id).toContain("projection:");
  const cash = createNextState(future, (g) => {
    g.timeline[0].cash = -1;
  });
  expect(selectMissionRisk(cash, [event])?.id).toBe("cash");
  const shortage = createNextState(cash, (g) => {
    g.timeline[0].supplyW = 99;
  });
  expect(selectMissionRisk(shortage, [event])?.id).toBe("shortage");
  const failed = createNextState(fixture(14), (g) => {
    g.monthlyHistory = [monthRow(2025, 2, 99), monthRow(2025, 1)];
    g.timeline.push(
      Object.assign({}, g.timeline[0], {
        minute: g.date.minute + 15,
        supplyW: 0,
      }),
    );
  });
  expect(selectMissionRisk(failed)?.id).toBe("reliability");
  expect(
    selectMissionRisk(fixture(), [event, { ...event, key: "a" }])?.id,
  ).toBe("event:a");
  expect(selectMissionRisk(fixture())).toBeUndefined(); // zero reserve is not shortage
});

// The runway reads the forward projection, not the average of recent months. Scenario 111's
// LADWP-scale utility surpluses at its scenario rate and deficits at zero, with the difference
// between the two measured by the projection the same way a player's slider would move it.
const runwayGame = (
  rate: number,
  cash: number,
  history: MonthlyHistoryType[] = [],
) =>
  createNextState(createGame({ scenarioId: 111, seed: 7 }), (g) => {
    g.dollarsPerkWh = rate;
    g.monthlyHistory = history;
    // A flat current tick: a zero reserve is not a shortage, so no other risk outranks the
    // runway in the assertions below
    g.timeline[0] = Object.assign({}, g.timeline[0], {
      cash,
      supplyW: 100,
      demandW: 100,
      reserveW: 0,
    });
  });

test("a one-time cash hit does not warn while the operating cash flow stays positive", () => {
  // A $30M down payment this month dropped the balance from $50M to $20M -- a steep burn on the
  // old average-of-months test -- but the operating flow at the scenario's rate surpluses, so
  // the projection never approaches zero.
  const hit = runwayGame(0.17, 20_000_000, [
    { ...monthRow(2024, 1), cash: 50_000_000 },
    { ...monthRow(2024, 2), cash: 20_000_000 },
  ]);
  expect(cashRunwayMonths(hit)).toBeUndefined();
  expect(selectMissionRisk(hit)?.id).not.toBe("cash-runway");
});

test("a rate below break-even warns immediately and clears when restored", () => {
  const burning = runwayGame(0, 1_000_000);
  const runway = cashRunwayMonths(burning);
  expect(runway).not.toBeUndefined();
  // Inside the warning horizon, and ahead of the term end, so the risk surfaces
  expect(runway!).toBeGreaterThanOrEqual(1);
  expect(runway!).toBeLessThanOrEqual(12);
  expect(selectMissionRisk(burning)).toMatchObject({
    id: "cash-runway",
    target: "finances",
  });
  expect(selectMissionRisk(burning)?.label).toMatch(/Projected cash runs out/);
  // The projection reflects the rate in the call that sets it; restoring it restores the runway
  const restored = createNextState(burning, (g) => {
    g.dollarsPerkWh = 0.17;
  });
  expect(cashRunwayMonths(restored)).toBeUndefined();
  expect(selectMissionRisk(restored)?.id).not.toBe("cash-runway");
});

test("a deficit whose crossing sits beyond the warning horizon stays quiet", () => {
  const deepPocket = runwayGame(0, 50_000_000);
  const runway = cashRunwayMonths(deepPocket);
  // It burns, just not fast enough to matter within a year; or so slowly that the horizon
  // ends first, which reads as the same quiet warning
  expect(runway === undefined || runway > 12).toBe(true);
  expect(selectMissionRisk(deepPocket)?.id).not.toBe("cash-runway");
});

test("negative cash now outranks the runway warning", () => {
  const insolvent = runwayGame(0.17, -1);
  expect(cashRunwayMonths(insolvent)).toBeUndefined();
  expect(selectMissionRisk(insolvent)?.id).toBe("cash");
});

test("scan excludes current/past ticks and next month, invalidates after plans and rollover", () => {
  const game = createNextState(fixture(), (g) => {
    g.timeline = [-15, 0, 15, 1440].map((minute) =>
      Object.assign({}, g.timeline[0], {
        minute,
        supplyW: 0,
      }),
    );
  });
  expect(projectedShortfall(game.timeline, 0)?.minute).toBe(15);
  expect(projectedShortfall(game.timeline, 0)).toBe(
    projectedShortfall(game.timeline, 0),
  );
  expect(projectedShortfall(game.timeline, 15)).toBeUndefined();
  const changed = createNextState(game, (g) => {
    g.timeline[2].supplyW = 100;
  });
  expect(projectedShortfall(changed.timeline, 0)).toBeUndefined();
  expect(projectedShortfall(game.timeline, 1440)).toBeUndefined();
  expect(projectedShortfall([], 0)).toBeUndefined();
  expect(
    selectMissionRisk(
      createNextState(game, (g) => {
        g.date = getDateFromMinute(1500, g.startingYear);
      }),
    ),
  ).toBeUndefined();
});

test("public event selector remains the disclosure boundary", () => {
  const game = createGame({ scenarioId: 110 });
  const publicEvents = selectUpcomingStoryEvents({ ...store.getState(), game });
  const risk = selectMissionRisk(game, publicEvents);
  expect(
    !risk?.id.startsWith("event:") ||
      publicEvents.some((e) => risk.id === `event:${e.key}`),
  ).toBe(true);
  expect(publicEvents.some((e) => e.key.endsWith(":trip"))).toBe(false);
});

test("real immutable tick profiling samples cache invalidation without simulation mutations", () => {
  let game = createGame({ scenarioId: 103 });
  // Warm the shared projection cache first: the test measures the per-tick read, and the
  // once-per-month rebuild is budgeted separately below
  selectProjection(game, game.timeline[0]);
  const rebuilds = jest.spyOn(GameModule, "generateNewTimeline");
  let changed = 0;
  let steadyMs = 0;
  let steadyTicks = 0;
  let rebuildCount = 0;
  for (let i = 0; i < 120; i++) {
    const previous = game.timeline;
    game = createNextState(game, (draft) => {
      GameModule.tickState(draft);
    });
    if (previous !== game.timeline) changed++;
    const before = JSON.stringify(game);
    const callsBefore = rebuilds.mock.calls.length;
    const started = performance.now();
    getMissionStatus(game);
    selectMissionRisk(game);
    projectedShortfall(game.timeline, game.date.minute);
    const elapsed = performance.now() - started;
    // A month rollover re-simulates the long-range forecast; that spike is real but once-a-month,
    // so it is counted, not averaged in with the steady-state reads
    if (rebuilds.mock.calls.length > callsBefore) {
      rebuildCount++;
    } else {
      steadyMs += elapsed;
      steadyTicks++;
    }
    expect(JSON.stringify(game)).toBe(before);
  }
  rebuilds.mockRestore();
  expect(changed).toBeGreaterThan(0);
  // Broad smoke bound, not a device performance guarantee; report actual measurements separately.
  expect(steadyTicks).toBeGreaterThan(0);
  expect(steadyMs / steadyTicks).toBeLessThan(10);
  // At most a rollover or two in a day of ticks
  expect(rebuildCount).toBeLessThanOrEqual(2);
});
