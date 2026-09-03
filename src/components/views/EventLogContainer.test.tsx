import { navigationForStoryTarget, selectOngoing } from "./EventLogContainer";
import { createGame } from "../../testing/Simulator";
import { AppStateType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";

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
