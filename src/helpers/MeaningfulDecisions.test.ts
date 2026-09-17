import { SCENARIOS } from "../data/Scenarios";
import { scenarioObjectiveFailure } from "../reducers/Game";
import { GameType, MeaningfulDecisionKindType } from "../Types";
import {
  isMaterialCapacityDecision,
  meaningfulDecisionCategoryCount,
  recordMeaningfulDecision,
  validMeaningfulDecisions,
} from "./MeaningfulDecisions";

function game(month = 0, peakDemandW = 100_000_000): GameType {
  return {
    date: { monthsElapsed: month },
    meaningfulDecisions: [],
    timeline: [{ demandW: peakDemandW }],
  } as unknown as GameType;
}

function choices(
  count: number,
  kinds: MeaningfulDecisionKindType[] = ["asset"],
) {
  return Array.from({ length: count }, (_, index) => ({
    key: `choice:${index}`,
    lever: `choice:${index}`,
    label: `Choice ${index + 1}`,
    month: index,
    kind: kinds[index % kinds.length],
    before: "before",
    after: "after",
  }));
}

describe("meaningful decisions", () => {
  it("keeps one lifetime record and removes a cross-month return to baseline", () => {
    const state = game();
    recordMeaningfulDecision(state, {
      lever: "rate",
      label: "Set customer rate",
      kind: "rate",
      before: "0.1",
      after: "0.11",
    });
    state.date.monthsElapsed = 3;
    recordMeaningfulDecision(state, {
      lever: "rate",
      label: "Set customer rate",
      kind: "rate",
      before: "0.11",
      after: "0.12",
    });

    expect(state.meaningfulDecisions).toEqual([
      expect.objectContaining({
        key: "rate",
        before: "0.1",
        after: "0.12",
        month: 3,
      }),
    ]);

    state.date.monthsElapsed = 7;
    recordMeaningfulDecision(state, {
      lever: "rate",
      label: "Set customer rate",
      kind: "rate",
      before: "0.12",
      after: "0.1",
    });
    expect(state.meaningfulDecisions).toEqual([]);
  });

  it("ignores same-value writes but keeps separate asset commitments", () => {
    const state = game();
    recordMeaningfulDecision(state, {
      lever: "rate",
      label: "Set customer rate",
      kind: "rate",
      before: "0.1",
      after: "0.1",
    });
    recordMeaningfulDecision(state, {
      lever: "asset-build:3",
      label: "Build gas plant",
      kind: "asset",
      before: "absent",
      after: "gas:cash",
    });
    recordMeaningfulDecision(state, {
      lever: "asset-build:4",
      label: "Build wind farm",
      kind: "asset",
      before: "absent",
      after: "wind:cash",
    });

    expect(state.meaningfulDecisions.map(({ key }) => key)).toEqual([
      "asset-build:3",
      "asset-build:4",
    ]);
  });

  it("requires a build to be at least one percent of peak demand", () => {
    const state = game(0, 2_000_000_000);
    expect(isMaterialCapacityDecision(state, 19_999_999)).toBe(false);
    expect(isMaterialCapacityDecision(state, 20_000_000)).toBe(true);
    expect(isMaterialCapacityDecision(game(0, 50_000_000), 999_999)).toBe(
      false,
    );
    expect(isMaterialCapacityDecision(game(0, 50_000_000), 1_000_000)).toBe(
      true,
    );
  });

  it("validates unique labeled lifetime keys", () => {
    const valid = choices(2, ["asset", "rate"]);
    expect(validMeaningfulDecisions(valid, 5)).toBe(true);
    expect(
      validMeaningfulDecisions(
        [...valid, { ...valid[1], label: "Duplicate" }],
        5,
      ),
    ).toBe(false);
    expect(validMeaningfulDecisions([{ hepo: "bad" }], 5)).toBe(false);
  });

  it("makes the Intern and diverse CEO objectives explicit, with a legacy waiver", () => {
    const scenario = SCENARIOS.find(({ id }) => id === 100)!;
    const one = choices(1);
    const nine = choices(9, ["asset", "rate", "policy", "dispatch"]);
    const tenOneKind = choices(10);
    const tenDiverse = choices(10, ["asset", "rate", "policy", "dispatch"]);

    expect(scenarioObjectiveFailure(scenario, [], "Intern", [])).toContain(
      "at least one",
    );
    expect(scenarioObjectiveFailure(scenario, [], "Intern", one)).toBeFalsy();
    expect(scenarioObjectiveFailure(scenario, [], "CEO", nine)).toContain(
      "9 of 10",
    );
    expect(scenarioObjectiveFailure(scenario, [], "CEO", tenOneKind)).toContain(
      "1 of 4",
    );
    expect(meaningfulDecisionCategoryCount(tenDiverse)).toBeGreaterThanOrEqual(
      4,
    );
    expect(
      scenarioObjectiveFailure(scenario, [], "CEO", tenDiverse),
    ).toBeFalsy();
    expect(scenarioObjectiveFailure(scenario, [], "CEO", [], true)).toBeFalsy();
  });
});
