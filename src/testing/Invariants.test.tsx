import cloneDeep from "lodash.clonedeep";
import { getTimeFromTimeline, summarizeTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";
import { GameType, TickPresentFutureType } from "../Types";
import { checkMonth, checkTick, InvariantCollector } from "./Invariants";
import { createGame } from "./Simulator";

let fixture: GameType;
let previous: TickPresentFutureType;

beforeAll(() => {
  fixture = createGame({ scenarioId: 103, seed: 12345 });
  tickState(fixture);
  previous = cloneDeep(
    getTimeFromTimeline(fixture.date.minute, fixture.timeline)!,
  );
  tickState(fixture);
});

function inspect(mutate?: (tick: TickPresentFutureType) => void) {
  const state = cloneDeep(fixture);
  const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
  mutate?.(now);
  const collector = new InvariantCollector();
  checkTick(collector, state, previous, now, "test tick", false);
  return collector;
}

it("accepts an unchanged pair of real consecutive ticks", () => {
  expect(inspect().getViolations()).toEqual([]);
});

it.each([
  ["demandW", NaN, "tick value is finite"],
  ["demandW", 0, "demand is positive"],
  ["expensesFuel", -1, "tick value is non-negative"],
  ["supplyW", 1e15, "generation, storage and trade balance supply"],
  ["cash", 1e15, "cash changes only by recorded revenue and expenses"],
] as const)("rejects corrupted %s (%s)", (field, value, rule) => {
  const collector = inspect((tick) => {
    tick[field] = value;
  });
  expect(collector.getViolations()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule, when: "test tick" }),
    ]),
  );
});

it("checks monthly totals independently of tick checks", () => {
  const month = summarizeTimeline(fixture.timeline, fixture.startingYear);
  const valid = new InvariantCollector();
  checkMonth(valid, month, "test month");
  expect(valid.getViolations()).toEqual([]);
  month.supplyWh = month.demandWh * 2;
  const invalid = new InvariantCollector();
  checkMonth(invalid, month, "test month");
  expect(invalid.getViolations()).toEqual([
    expect.objectContaining({ rule: "monthly supply never exceeds demand" }),
  ]);
});

it("caps reported examples without losing the total violation count", () => {
  const collector = new InvariantCollector();
  for (let index = 0; index < 20; index++) {
    collector.add("broken cash", `tick ${index}`, "cash mismatch");
  }
  collector.add("broken energy", "tick 20", "energy mismatch");
  expect(collector.getTotalCount()).toBe(21);
  expect(collector.getCountByRule()).toEqual({
    "broken cash": 20,
    "broken energy": 1,
  });
  expect(collector.getViolations()).toHaveLength(6);
  expect(collector.getViolations()[5].rule).toBe("broken energy");
});
