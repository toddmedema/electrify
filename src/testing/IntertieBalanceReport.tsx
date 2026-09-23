/** Explicit CLI-style matrix, excluded from the ordinary Jest suite. See docs/intertie-balance.md. */
import { writeFileSync } from "fs";
import { corridorsForLocation } from "../data/AdjacentMarkets";
import { SCENARIOS } from "../data/Scenarios";
import { getScenarioLocation } from "../helpers/Locations";
import { scenarioObjectiveFailure } from "../reducers/Game";
import { DifficultyType, ScenarioType } from "../Types";
import {
  INTERN_ONE_BUILD_PLAYS,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import {
  runSimulation,
  ScheduledSimActionType,
  SimOptionsType,
} from "./Simulator";

jest.setTimeout(1200000);

const requestedIds = process.env.INTERTIE_REPORT_IDS?.split(",").map(Number);
const seeds = (process.env.INTERTIE_REPORT_SEEDS || "12345")
  .split(",")
  .map(Number);
const difficulties = (
  process.env.INTERTIE_REPORT_DIFFICULTIES || "Intern,CEO"
).split(",") as DifficultyType[];
const requestedPlans = process.env.INTERTIE_REPORT_PLANS?.split(",");
const matchedTariff = process.env.INTERTIE_REPORT_MATCHED_TARIFF === "1";
const buildOverride = process.env.INTERTIE_REPORT_BUILD?.split(":");
const responseOverrides = process.env.INTERTIE_REPORT_RESPONSES
  ? (JSON.parse(process.env.INTERTIE_REPORT_RESPONSES) as Record<
      string,
      string
    >)
  : undefined;
const output =
  process.env.INTERTIE_REPORT_OUTPUT ||
  "/private/tmp/intertie-balance-results.json";

function retryLines(
  scenario: ScenarioType,
  corridorIds: string[],
): ScheduledSimActionType[] {
  // Retry each month until affordable. Already-built lines are harmless rejected duplicate
  // orders, not additional meaningful decisions. Only accepted actions appear in replay.
  return Array.from({ length: scenario.durationMonths }, (_, month) =>
    corridorIds.map((corridorId): ScheduledSimActionType => ({
      month,
      type: "intertie",
      corridorId,
      financed: true,
    })),
  ).flat();
}

interface Plan {
  name: string;
  options: Partial<SimOptionsType>;
}

function plansFor(scenario: ScenarioType, difficulty: DifficultyType): Plan[] {
  const location = getScenarioLocation(scenario)!;
  const corridors = corridorsForLocation(location);
  const domestic =
    (difficulty === "Intern" ? INTERN_ONE_BUILD_PLAYS : STANDARD_BALANCE_PLAYS)[
      scenario.id
    ]?.initialBuild || INTERN_ONE_BUILD_PLAYS[scenario.id]?.initialBuild;
  const plans: Plan[] = [{ name: "passive", options: {} }];
  corridors.forEach(({ id }, index) =>
    plans.push({
      name: `intertie-${index + 1}`,
      options: { scheduledActions: retryLines(scenario, [id]) },
    }),
  );
  if (corridors.length)
    plans.push({
      name: "both-interties",
      options: {
        scheduledActions: retryLines(
          scenario,
          corridors.map(({ id }) => id),
        ),
      },
    });
  if (corridors.length && process.env.INTERTIE_REPORT_UPGRADES === "1") {
    plans.push({
      name: "upgraded-interties",
      options: {
        scheduledActions: Array.from(
          { length: scenario.durationMonths },
          (_, month) => [
            ...corridors.map(({ id }): ScheduledSimActionType => ({
              month,
              type: "intertie",
              corridorId: id,
              financed: true,
            })),
            ...corridors.map(({ id }): ScheduledSimActionType => ({
              month,
              type: "intertie-upgrade",
              corridorId: id,
              financed: true,
            })),
          ],
        ).flat(),
      },
    });
  }
  if (domestic) {
    plans.push({
      name: "domestic-addition",
      options: { initialBuild: domestic },
    });
    if (corridors.length)
      plans.push({
        name: "mixed",
        options: {
          initialBuild: domestic,
          scheduledActions: retryLines(scenario, [corridors[0].id]),
        },
      });
  }
  plans.push({
    name: "established-plan",
    options:
      difficulty === "Intern"
        ? INTERN_ONE_BUILD_PLAYS[scenario.id]
        : STANDARD_BALANCE_PLAYS[scenario.id],
  });
  return plans.filter(
    ({ name }) => !requestedPlans || requestedPlans.includes(name),
  );
}

it("reports actual import, domestic, and mixed outcomes separately from decision quotas", () => {
  const rows: object[] = [];
  const failures: object[] = [];
  const scenarios = SCENARIOS.filter(
    (scenario) =>
      !scenario.tutorialSteps &&
      (!requestedIds || requestedIds.includes(scenario.id)),
  );
  for (const scenario of scenarios) {
    for (const difficulty of difficulties) {
      for (const requestedSeed of seeds) {
        // Keep the authored Deep Freeze weather seed as the main reproducible cell.
        const seed =
          scenario.id === 107 && requestedSeed === 12345
            ? 268107
            : requestedSeed;
        for (const plan of plansFor(scenario, difficulty)) {
          const referenceRate = STANDARD_BALANCE_PLAYS[
            scenario.id
          ]?.scheduledActions?.find((action) => action.type === "rate");
          const result = runSimulation({
            scenarioId: scenario.id,
            difficulty,
            seed,
            ...(matchedTariff && referenceRate?.type === "rate"
              ? { dollarsPerkWh: referenceRate.dollarsPerkWh }
              : {}),
            ...plan.options,
            ...(responseOverrides
              ? { scenarioResponses: responseOverrides }
              : {}),
            ...(buildOverride
              ? {
                  initialBuild: {
                    name: buildOverride[0],
                    ...(buildOverride[0] === "Battery"
                      ? { peakWh: Number(buildOverride[1]) * 1e6 }
                      : { peakW: Number(buildOverride[1]) * 1e6 }),
                    financed: true,
                  },
                }
              : {}),
          });
          const physicalFailure = scenarioObjectiveFailure(
            scenario,
            [...result.months].reverse(),
            undefined,
            [],
            true,
          );
          const durationReached =
            result.months.length >= scenario.durationMonths;
          const physicalSuccess =
            durationReached &&
            !result.wentBankrupt &&
            !physicalFailure &&
            !(
              result.firedAtMonth !== null &&
              result.firedAtMonth < scenario.durationMonths
            );
          const demandWh = result.months.reduce(
            (sum, month) => sum + month.demandWh,
            0,
          );
          const suppliedWh = result.months.reduce(
            (sum, month) => sum + month.supplyWh,
            0,
          );
          const objective = scenario.reliabilityObjective;
          const objectiveMonths = objective
            ? result.months.filter((month) => {
                const offset =
                  (month.year - objective.year) * 12 +
                  month.month -
                  objective.month;
                return offset >= 0 && offset < (objective.durationMonths || 1);
              })
            : [];
          const objectiveDemandWh = objectiveMonths.reduce(
            (sum, month) => sum + month.demandWh,
            0,
          );
          const objectiveSupplyWh = objectiveMonths.reduce(
            (sum, month) => sum + month.supplyWh,
            0,
          );
          const firstCustomers = result.months[0]?.customers || 0;
          const lastCustomers =
            result.months[result.months.length - 1]?.customers || 0;
          const row = {
            scenarioId: scenario.id,
            scenario: scenario.name,
            difficulty,
            seed,
            plan: plan.name,
            matchedTariff,
            scenarioResponses: result.options.scenarioResponses,
            officialOutcome: result.outcome,
            physicalSuccess,
            physicalFailure: physicalFailure || null,
            months: result.months.length,
            finalCash: result.finalCash,
            finalDebt: result.finalDebt,
            acceptedInterties: result.finalTransmissionLines?.map((line) => ({
              corridorId: line.corridorId,
              capacityMW: line.capacityW / 1e6,
              minuteCreated: line.minuteCreated,
              yearsToBuildLeft: line.yearsToBuildLeft,
            })),
            finalNetWorth: result.finalNetWorth,
            servedFraction: demandWh ? suppliedWh / demandWh : null,
            objectiveServedFraction: objectiveDemandWh
              ? objectiveSupplyWh / objectiveDemandWh
              : null,
            objectiveMonthsObserved: objectiveMonths.length,
            customerRetentionFromFirstMonth: firstCustomers
              ? lastCustomers / firstCustomers
              : null,
            minimumMarginMW:
              Math.min(
                ...result.months.map(
                  (month) => month.minimumSupplyMarginW ?? Infinity,
                ),
              ) / 1e6,
            importExpense: result.months.reduce(
              (sum, month) => sum + (month.expensesImports || 0),
              0,
            ),
            estimatedImportEnergyShare: demandWh
              ? result.months.reduce(
                  (sum, month) =>
                    sum +
                    (month.chartAverage?.demandW
                      ? ((month.chartAverage.importedW || 0) /
                          month.chartAverage.demandW) *
                        month.demandWh
                      : 0),
                  0,
                ) / demandWh
              : null,
            exportRevenue: result.months.reduce(
              (sum, month) => sum + (month.revenueExports || 0),
              0,
            ),
            meaningfulDecisions: result.meaningfulDecisionCount,
            acceptedDecisionLabels: result.meaningfulDecisionLabels,
            acceptedBuilds: result.builds,
            violations: result.violationCount,
          };
          rows.push(row);
          if (result.violationCount)
            failures.push({
              scenario: scenario.id,
              difficulty,
              plan: plan.name,
              violations: result.violations,
            });
          writeFileSync(output, JSON.stringify(rows, null, 2) + "\n");
          process.stdout.write(
            `${scenario.id} ${difficulty} ${seed} ${plan.name}: ${physicalSuccess ? "physical win" : "physical loss"}, ${result.outcome}, ${result.months.length}mo, $${Math.round(result.finalCash / 1e6)}M\n`,
          );
        }
      }
    }
  }
  expect(failures).toEqual([]);
});
