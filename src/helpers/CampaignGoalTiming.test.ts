import { LEGACY_SCENARIOS } from "../data/LegacyCampaign";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
} from "../data/ScenarioObjectives";
import { ruleDigest } from "./RuleIdentity";
import { EMPTY_HISTORY } from "./DateTime";
import { scenarioRules } from "./ScenarioRules";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  evaluateScenarioObjectives,
  validObjectiveProgress,
  validObjectiveResult,
  objectiveTarget,
} from "./ScenarioObjectives";
import { objectiveGoalText } from "./ObjectivePresentation";

test.each(LEGACY_SCENARIOS)(
  "$name judges goals only at their December checkpoint",
  (scenario) => {
    const context: ObjectiveContext = {
      rulesDigest: ruleDigest("checkpoint-test"),
      startingYear: scenario.startingYear,
      durationMonths: 240,
      seed: 611,
      moneyBasis: "nominal",
      completedMonths: 0,
      ownership: "Investor",
    };
    const failedCheckpoints: string[] = [];
    for (const goal of scenarioRules(scenario)!.objectives) {
      const deadline =
        "deadlineMonth" in goal ? goal.deadlineMonth : goal.throughMonth;
      const facts = (month: number, good: boolean): ObjectiveMonthFacts => ({
        month,
        history: {
          ...EMPTY_HISTORY,
          year: scenario.startingYear + Math.floor(month / 12),
          month: (month % 12) + 1,
          customers: good ? Math.max(100, objectiveTarget(goal) * 2) : 0,
          cash: good ? 1e12 : 0,
          revenue: good ? 100 : goal.metric === "monthlyBilledRate" ? 1e12 : 0,
          expensesOM: 10,
          supplyWh: 1e12,
          demandWh: 1e12,
          kgco2e:
            !good && goal.metric === "emissionsPerDeliveredMWh" ? 1e12 : 0,
          minimumSupplyMarginW: good ? 1e12 : 0,
          efficiencySavedWh: good ? 100 : 0,
          efficiencyEligibleWh: 1000,
          eveningDemandWh: 1000,
          eveningUnservedWh: good ? 0 : 1000,
        },
        debtPrincipal: good ? 0 : 1e12,
        ownedVintageFuels: [
          { fuel: "Oil", commissionedBeforeYear: 2001, count: good ? 0 : 1 },
        ],
      });
      let progress = createObjectiveProgress([goal], context, 100);
      for (let month = 0; month < 240; month++) {
        progress = recordObjectiveMonth(
          progress,
          [goal],
          facts(month, month === deadline),
          context,
        );
        const now = { ...context, completedMonths: month + 1 };
        const result = evaluateScenarioObjectives([goal], progress, now)[0];
        expect(validObjectiveResult(result)).toBe(true);
        expect(result.status).toMatch(
          month < deadline ? /^(pending|inProgress)$/ : /^completed$/,
        );
      }
      const restored = JSON.parse(JSON.stringify(progress));
      expect(
        validObjectiveProgress(restored, [goal], {
          ...context,
          completedMonths: 240,
        }),
      ).toBe(true);
      if (goal.metric !== "emissionsBudget") {
        let missed = createObjectiveProgress([goal], context, 100);
        for (let month = 0; month < 240; month++)
          missed = recordObjectiveMonth(
            missed,
            [goal],
            facts(month, month > deadline),
            context,
          );
        failedCheckpoints.push(
          evaluateScenarioObjectives([goal], missed, {
            ...context,
            completedMonths: 240,
          })[0].status,
        );
      }
      const text = objectiveGoalText(goal, scenario.startingYear, 240);
      expect(text).not.toMatch(/·|each month|every month|Jan|Dec|this term/);
      expect(
        text.includes(
          `by ${scenario.startingYear + Math.floor(deadline / 12)}`,
        ),
      ).toBe(deadline !== 239);
    }
    expect(failedCheckpoints).toEqual(
      Array(
        scenarioRules(scenario)!.objectives.filter(
          (goal) => goal.metric !== "emissionsBudget",
        ).length,
      ).fill("failed"),
    );
  },
);

test("a carbon budget is judged at term end, while counting every month's emissions", () => {
  const goal = scenarioRules(LEGACY_SCENARIOS[8])!.objectives[0];
  const context: ObjectiveContext = {
    rulesDigest: ruleDigest("budget-test"),
    startingYear: 2042,
    durationMonths: 240,
    seed: 611,
    completedMonths: 0,
    ownership: "Investor",
  };
  let progress = createObjectiveProgress([goal], context, 100);
  for (let month = 0; month < 240; month++) {
    progress = recordObjectiveMonth(
      progress,
      [goal],
      {
        month,
        history: {
          ...EMPTY_HISTORY,
          year: 2042 + Math.floor(month / 12),
          month: (month % 12) + 1,
          kgco2e: month === 0 ? objectiveTarget(goal) * 2 : 0,
        },
      },
      context,
    );
    expect(
      evaluateScenarioObjectives([goal], progress, {
        ...context,
        completedMonths: month + 1,
      })[0].status,
    ).toBe(month === 239 ? "failed" : "inProgress");
  }
});
