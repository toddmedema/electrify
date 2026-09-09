import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { scenarioObjectiveFailure } from "../reducers/Game";
import { DifficultyType } from "../Types";
import {
  INTERN_ONE_BUILD_PLAYS,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import { runSimulation, SimResultType } from "./Simulator";

jest.setTimeout(120000);

// The economic/reliability failure must stand even if the decision-count gate is waived.
const physicalObjectiveFailure = (result: SimResultType) =>
  scenarioObjectiveFailure(
    result.scenario,
    [...result.months].reverse(),
    undefined,
    [],
    true,
  );

describe("major scenario choice balance", () => {
  [106, 107, 111].forEach((scenarioId) => {
    (["Intern", "CEO"] as DifficultyType[]).forEach((difficulty) => {
      // Explicit IDs ensure accidentally removing a new choice cannot shrink this matrix.
      const optionIds =
        scenarioId === 106
          ? ["fast-track", "phased"]
          : scenarioId === 107
            ? ["winterize", "standard"]
            : ["prepare", "standard"];
      optionIds.forEach((optionId) => {
        it(`${scenarioId} ${difficulty} ${optionId} permits victory and genuine defeat`, () => {
          const decision = SCENARIO_CHOICES.find(
            (choice) => choice.scenarioId === scenarioId,
          )!;
          expect(decision).toBeDefined();
          const scenarioResponses = { [decision.id]: optionId };
          const winning = runSimulation({
            scenarioId,
            difficulty,
            scenarioResponses,
            ...(difficulty === "Intern"
              ? INTERN_ONE_BUILD_PLAYS[scenarioId]
              : STANDARD_BALANCE_PLAYS[scenarioId]),
          });
          const losing = runSimulation({
            scenarioId,
            difficulty,
            scenarioResponses,
            // Assume preparedness makes fossil backup unnecessary: mothball one plant,
            // after responding, and leave it off through the emergency. Data Center simply
            // neglects expansion. No cash injection, forced state, or artificial price is used.
            scheduledActions:
              scenarioId === 111
                ? [{ month: 12, type: "toggle", facilityId: 1 }]
                : scenarioId === 107
                  ? [{ month: 37, type: "toggle", facilityId: 2 }]
                  : [],
          });
          [winning, losing].forEach((result) => {
            expect(
              result.storyOccurrences.find((event) => event.key === decision.id)
                ?.attributes?.choice,
            ).toBe(optionId);
            expect(result.violations).toEqual([]);
          });
          expect(winning.outcome).toBe("completed");
          expect(winning.months.length).toBeGreaterThanOrEqual(
            winning.scenario.durationMonths,
          );
          expect(physicalObjectiveFailure(winning)).toBeUndefined();
          expect(losing.outcome).not.toBe("completed");
          expect(
            losing.bankruptAtMonth !== null ||
              (losing.firedAtMonth !== null &&
                losing.firedAtMonth < losing.scenario.durationMonths) ||
              physicalObjectiveFailure(losing) !== undefined,
          ).toBe(true);
          if (process.env.SCENARIO_CHOICE_REPORT) {
            console.warn(
              JSON.stringify({
                scenarioId,
                difficulty,
                optionId,
                winningCash: winning.finalCash,
                choiceMonthCash: winning.months[decision.atMonth].cash,
                losingMonth: losing.bankruptAtMonth ?? losing.firedAtMonth,
                losingObjective:
                  physicalObjectiveFailure(losing) || "chronic blackouts",
              }),
            );
          }
        });
      });
    });
  });

  it.each(["Intern", "CEO"] as const)(
    "winterization supports a smaller fleet on %s",
    (difficulty) => {
      const decision = SCENARIO_CHOICES.find(
        (choice) => choice.scenarioId === 107,
      )!;
      const play = difficulty === "CEO" ? STANDARD_BALANCE_PLAYS[107] : {};
      const simulate = (peakW: number, optionId: string) =>
        runSimulation({
          scenarioId: 107,
          difficulty,
          ...play,
          initialBuild: { name: "Natural Gas", peakW, financed: true },
          scenarioResponses: { [decision.id]: optionId },
        });
      const smallW = difficulty === "CEO" ? 300_000_000 : 100_000_000;
      const protectedSmall = simulate(smallW, "winterize");
      const exposedSmall = simulate(smallW, "standard");
      const expanded = simulate(900_000_000, "standard");
      const expandedProtected = simulate(900_000_000, "winterize");
      [protectedSmall, exposedSmall, expanded, expandedProtected].forEach(
        (result) => expect(result.violations).toEqual([]),
      );
      expect(protectedSmall.outcome).toBe("completed");
      expect(exposedSmall.outcome).toBe("fired");
      expect(physicalObjectiveFailure(exposedSmall)).toMatch(
        /February 2021 freeze/,
      );
      expect(expanded.outcome).toBe("completed");
      expect(expandedProtected.outcome).toBe("completed");
      // Paying for winterization is not free insurance when the player has already built enough.
      expect(expanded.finalCash).toBeGreaterThan(expandedProtected.finalCash);
    },
  );

  it.each(["Intern", "CEO"] as const)(
    "phased connections rescue a late expansion on %s",
    (difficulty) => {
      const decision = SCENARIO_CHOICES.find(
        (choice) => choice.scenarioId === 106,
      )!;
      const play = difficulty === "CEO" ? STANDARD_BALANCE_PLAYS[106] : {};
      const simulate = (optionId: string) =>
        runSimulation({
          scenarioId: 106,
          difficulty,
          ...play,
          initialBuild: undefined,
          scenarioResponses: { [decision.id]: optionId },
          scheduledActions: [
            ...(play.scheduledActions || []),
            {
              month: difficulty === "CEO" ? 60 : 72,
              type: "build",
              build: { name: "Natural Gas", peakW: 50_000_000, financed: true },
            },
          ],
        });
      const phased = simulate("phased");
      const fast = simulate("fast-track");
      [phased, fast].forEach((result) => expect(result.violations).toEqual([]));
      expect(phased.outcome).toBe("completed");
      expect(fast.outcome).toBe("fired");
      expect(phased.months[phased.months.length - 1].customers).toBeGreaterThan(
        fast.months[fast.months.length - 1].customers,
      );
      if (process.env.SCENARIO_CHOICE_REPORT) {
        console.warn(
          JSON.stringify({
            comparison: "late expansion",
            difficulty,
            phasedCash: phased.finalCash,
            phasedCustomers: phased.months[phased.months.length - 1].customers,
            fastCustomers: fast.months[fast.months.length - 1].customers,
          }),
        );
      }
    },
  );
});
