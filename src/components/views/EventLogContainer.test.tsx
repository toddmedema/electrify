import { navigationForStoryTarget, selectOngoing } from "./EventLogContainer";
import { createGame } from "../../testing/Simulator";
import { AppStateType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { selectUpcomingStoryEvents } from "./StoryEventSelectors";

describe("story action targets", () => {
  it("routes a generator target to the quote screen and preserves its fuel", () => {
    const target = {
      card: "FACILITIES" as const,
      view: "BUILD_GENERATORS" as const,
      fuel: "Natural Gas" as const,
    };
    expect(navigationForStoryTarget(target)).toEqual({
      name: "BUILD_GENERATORS",
      storyTarget: target,
    });
  });

  it("routes insight and event targets to their panes", () => {
    const insights = {
      card: "INSIGHTS" as const,
      layer: "FUEL_PRICES" as const,
    };
    expect(navigationForStoryTarget(insights)).toEqual({
      name: "INSIGHTS",
      storyTarget: insights,
    });
    expect(navigationForStoryTarget({ card: "EVENTS" })).toEqual({
      name: "EVENTS",
      storyTarget: { card: "EVENTS" },
    });
  });
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
        label: "Through Feb 2025",
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
        title: "New data centers online",
        message: expect.stringContaining("100MW"),
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
  expect(phased.every((event) => event.message.includes("50MW"))).toBe(true);
  game.date = getDateFromMinute(72 * MINUTES_PER_MONTH, game.startingYear);
  expect(
    selectUpcomingStoryEvents({ game } as AppStateType)
      .filter((event) => event.key.startsWith("load:"))
      .map((event) => event.key),
  ).toEqual(["load:phase-two"]);
});
