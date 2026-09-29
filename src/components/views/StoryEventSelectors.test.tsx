import { createGame } from "../../testing/Simulator";
import { ActiveWorldEventType, AppStateType } from "../../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { selectActiveEventGroups } from "./StoryEventSelectors";

function event(
  key: string,
  overrides: Partial<ActiveWorldEventType> = {},
): ActiveWorldEventType {
  return {
    key,
    definitionId: key,
    startsMinute: 12 * MINUTES_PER_MONTH,
    endsMinute: 14 * MINUTES_PER_MONTH,
    attributes: {},
    effects: {},
    title: key,
    message: `${key} is happening.`,
    importance: "NOTABLE",
    ...overrides,
  };
}

function stateAt(minute: number, active: ActiveWorldEventType[]) {
  const game = createGame({ scenarioId: 111 });
  game.date = getDateFromMinute(minute, game.startingYear);
  game.worldEvents.active = active;
  return { game } as AppStateType;
}

describe("active event groups", () => {
  it("includes only critical and notable events in effect now", () => {
    const now = 13 * MINUTES_PER_MONTH;
    const groups = selectActiveEventGroups(
      stateAt(now, [
        event("now"),
        event("later", { startsMinute: now + 1 }),
        event("over", { endsMinute: now }),
        event("silent", { message: undefined }),
        event("routine", { importance: "ROUTINE" }),
        event("unranked", { importance: undefined }),
      ]),
    );
    expect(groups.map((group) => group.title)).toEqual(["now"]);
    expect(groups[0].throughLabel).toBe("through Feb 2023");
  });

  it("groups repeated occurrences and leads with the most severe", () => {
    const now = 13 * MINUTES_PER_MONTH;
    const groups = selectActiveEventGroups(
      stateAt(now, [
        event("hail:1", { title: "Hail damage", importance: "CRITICAL" }),
        event("hail:2", { title: "Hail damage", importance: "CRITICAL" }),
        event("Extreme cold"),
      ]),
    );
    expect(
      groups.map(({ title, count, importance }) => [title, count, importance]),
    ).toEqual([
      ["Hail damage", 2, "CRITICAL"],
      ["Extreme cold", 1, "NOTABLE"],
    ]);
  });

  it("returns the same array across ticks until an event starts or ends", () => {
    const active = [event("fire")];
    const first = selectActiveEventGroups(
      stateAt(13 * MINUTES_PER_MONTH, active),
    );
    const next = selectActiveEventGroups(
      stateAt(13 * MINUTES_PER_MONTH + 60, [...active]),
    );
    expect(next).toBe(first);
    expect(
      selectActiveEventGroups(stateAt(14 * MINUTES_PER_MONTH, active)),
    ).toEqual([]);
  });
});
