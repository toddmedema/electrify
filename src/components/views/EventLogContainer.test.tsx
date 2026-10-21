import { makeMapStateToProps, selectOngoing } from "./EventLogContainer";
import { createNextState as produce } from "@reduxjs/toolkit";
import { initialUI } from "../../reducers/UI";
import { TICK_MINUTES } from "../../Constants";
import { createGame } from "../../testing/Simulator";
import { AppStateType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { selectUpcomingStoryEvents } from "./StoryEventSelectors";

test("FAST presents a bounded rail snapshot while evidence and incidents update immediately", () => {
  const game = createGame({ scenarioId: 106 });
  game.speed = "FAST";
  const state = { game, ui: initialUI } as AppStateType;
  const select = makeMapStateToProps();
  const first = select(state);
  const next = produce(state, (draft) => {
    draft.game.date.minute += TICK_MINUTES;
  });
  const held = select(next);
  expect(held.game).toBe(first.game);
  expect(held.events).toBe(first.events);
  const inspect = produce(next, (draft) => {
    draft.ui.evidenceRequest = { id: 1, runId: 0, target: "finances" };
  });
  expect(select(inspect).game).toBe(inspect.game);
  const incident = produce(inspect, (draft) => {
    draft.game.eventLog.unshift({
      id: 400,
      kind: "BLACKOUT",
      label: "Now",
      message: "Supply is short.",
    });
  });
  expect(select(incident).events).toHaveLength(first.events.length + 1);
});

describe("ongoing story events", () => {
  it("keeps persisted presentation and formats the inclusive end month", () => {
    const game = createGame({ scenarioId: 111 });
    game.date = getDateFromMinute(12 * MINUTES_PER_MONTH, game.startingYear);
    game.worldEvents.active = [
      {
        key: "story:111:california-wildfire-2025:firestorm",
        definitionId: "california-wildfire-2025:firestorm",
        startsMinute: 12 * MINUTES_PER_MONTH,
        endsMinute: 14 * MINUTES_PER_MONTH,
        attributes: {},
        effects: { demandMultiplier: 0.94 },
        title: "Wildfire emergency",
        message: "Safety shutoffs are active.",
        concept: "danger",
        importance: "CRITICAL",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
      },
    ];

    expect(selectOngoing({ game } as AppStateType)).toEqual([
      expect.objectContaining({
        key: "story:111:california-wildfire-2025:firestorm",
        title: "Wildfire emergency",
        label: "Through Feb 2023",
      }),
    ]);
  });
});

describe("upcoming story events", () => {
  it("preserves graph timing while excluding unpreviewed announcements", () => {
    const game = createGame({ scenarioId: 100 });
    const upcoming = selectUpcomingStoryEvents({ game } as AppStateType);

    expect(upcoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "story:100:carbon-fee-ratchet:ratchet-onset",
          startsMinute: 48 * MINUTES_PER_MONTH,
          label: `Expected Jan ${game.startingYear + 4}`,
        }),
      ]),
    );
    expect(
      upcoming.some((event) => event.key.endsWith(":published-ratchet")),
    ).toBe(false);
    expect(upcoming.map((event) => event.startsMinute)).toEqual(
      [...upcoming]
        .map((event) => event.startsMinute)
        .sort((a, b) => (a || 0) - (b || 0)),
    );
  });
});

test("scheduled data-center connections appear and update when the schedule changes", () => {
  const game = createGame({ scenarioId: 106 });
  const initial = selectUpcomingStoryEvents({ game } as AppStateType);
  expect(initial).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "load:manassas-data-centers",
        startsMinute: 72 * MINUTES_PER_MONTH,
        title: "Data Centers coming online",
        message: "Demand rising as new load connects.",
      }),
    ]),
  );
  game.loadAdditions = [
    { ...game.loadAdditions[0], id: "phase-one", peakW: 50000000 },
    {
      ...game.loadAdditions[0],
      id: "phase-two",
      peakW: 50000000,
      startsYear: 2028,
    },
  ];
  const phased = selectUpcomingStoryEvents({ game } as AppStateType).filter(
    (event) => event.key.startsWith("load:"),
  );
  expect(phased.map((event) => event.startsMinute)).toEqual(
    [72, 96].map((month) => month * MINUTES_PER_MONTH),
  );
  expect(
    phased.every(
      (event) => event.message === "Demand rising as new load connects.",
    ),
  ).toBe(true);
  game.date = getDateFromMinute(72 * MINUTES_PER_MONTH, game.startingYear);
  expect(
    selectUpcomingStoryEvents({ game } as AppStateType)
      .filter((event) => event.key.startsWith("load:"))
      .map((event) => event.key),
  ).toEqual(["load:phase-two"]);
});
