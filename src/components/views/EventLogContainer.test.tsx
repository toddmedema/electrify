import { navigationForStoryTarget } from "./EventLogContainer";

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
