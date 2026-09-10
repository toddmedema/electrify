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
  getMissionStatus,
  projectedShortfall,
  selectMissionRisk,
} from "./MissionStatus";
import { scenarioObjectiveFailure, tickState } from "../reducers/Game";
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
  expect(requirement(fixture(11), "reliability").status).toBe("pending");
  expect(requirement(fixture(12), "reliability").status).toBe("in-progress");
  const partial = createNextState(fixture(13), (g) => {
    g.monthlyHistory = [monthRow(2025, 2, 0), monthRow(2025, 1)];
  });
  expect(requirement(partial, "reliability").status).toBe("in-progress");
  expect(requirement(partial, "reliability").current).toContain(
    "1/2 completed months",
  );
  expect(requirement(partial, "reliability").current).toContain("partial");
  const completed = createNextState(fixture(14), (g) => {
    g.monthlyHistory = [monthRow(2025, 2), monthRow(2025, 1)];
  });
  expect(requirement(completed, "reliability").status).toBe("completed");
  const failed = createNextState(completed, (g) => {
    g.monthlyHistory[0].supplyWh = 99;
  });
  expect(requirement(failed, "reliability").status).toBe("failed");
  expect(getMissionStatus(failed).prominent?.id).toBe("reliability");
  expect(scenarioObjectiveFailure(wildfire, failed.monthlyHistory)).toContain(
    "99.00%",
  );
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
      expect(scenarioObjectiveFailure(wildfire, rows)).toBeUndefined();
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
    scenarioObjectiveFailure(wildfire, game.monthlyHistory),
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
    "1 retained decisions across 1 categories",
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
  let changed = 0;
  let scanMs = 0;
  for (let i = 0; i < 120; i++) {
    const previous = game.timeline;
    game = createNextState(game, (draft) => {
      tickState(draft);
    });
    if (previous !== game.timeline) changed++;
    const before = JSON.stringify(game);
    const started = performance.now();
    getMissionStatus(game);
    selectMissionRisk(game);
    projectedShortfall(game.timeline, game.date.minute);
    scanMs += performance.now() - started;
    expect(JSON.stringify(game)).toBe(before);
  }
  expect(changed).toBeGreaterThan(0);
  // Broad smoke bound, not a device performance guarantee; report actual measurements separately.
  expect(scanMs / 120).toBeLessThan(10);
});
