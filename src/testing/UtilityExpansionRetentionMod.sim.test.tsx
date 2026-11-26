import { getScenario } from "../data/Scenarios";
import type { ObjectiveProgress } from "../data/ScenarioObjectives";
import { modScenario } from "../mods/ModScenario";
import { parseSave, serializeSave } from "../SaveGame";
import type { GameType } from "../Types";
import {
  acquisitionQuote,
  expansionRetentionBaseline,
} from "../helpers/Expansion";
import { acquireUtility } from "../reducers/GameActions";
import {
  absoluteMonth,
  gameObjectiveResults,
  objectiveContextForGame,
  scenarioObjectiveDefinitions,
} from "../helpers/ObjectiveRules";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  validObjectiveProgress,
} from "../helpers/ScenarioObjectives";
import {
  copyOfficialGame,
  officialCommand,
  playOfficialExecution,
} from "./OfficialScenarioExecutionFixtures";
import { modPackage } from "./ModFixtures";
import { runMonths } from "./SimulationTestHelpers";
import {
  EXPANSION_BALANCE_CASES,
  expansionBalanceActions,
} from "./UtilityExpansionBalanceFixtures";

jest.setTimeout(120000);

it("preserves completed mod retention goals through acquisitions and save/resume, and rebases a goal before its deadline", () => {
  const scenario = modScenario(
    modPackage({
      id: "earlier-retention",
      baseScenarioId: 116,
      seed: 12345,
      objectives: [
        {
          id: "early-customers",
          label: "Retain customers through the first five years",
          metric: "customerRetention",
          minRetainedShare: 0.9,
          deadlineMonth: 60,
        },
        {
          id: "final-customers",
          label: "Retain the expanded company through 2024",
          metric: "customerRetention",
          minRetainedShare: 0.9,
          deadlineMonth: 240,
        },
      ],
    }),
  );
  const fixture = EXPANSION_BALANCE_CASES.find(
    ({ id }) => id === "valley-electric-firm-loan",
  )!;
  const scheduledActions = expansionBalanceActions(fixture, 12345);
  let completed: ReturnType<typeof gameObjectiveResults>[number] | undefined;
  let beforeObservations:
    ObjectiveProgress["entries"][number]["observations"] | undefined;
  let restoredPurchase = false;
  let beforeDeadline: GameType | undefined;
  const { game, violations } = playOfficialExecution(
    116,
    {
      monthClose(state) {
        if (state.date.monthsElapsed === 239)
          beforeDeadline = copyOfficialGame(state);
        if (state.date.monthsElapsed !== 60) return;
        completed = gameObjectiveResults(state).find(
          ({ id }) => id === "early-customers",
        )!;
        expect(completed.status).toBe("completed");
        beforeObservations = JSON.parse(
          JSON.stringify(
            state.objectiveProgress!.entries.find(
              ({ id }) => id === "early-customers",
            )!.observations,
          ),
        );
      },
      beforeTick(state) {
        if (state.date.monthsElapsed !== 96 || state.date.minuteOfDay !== 0)
          return;
        expect(state.utilityExpansion!.acquisitions).toHaveLength(1);
        expect(
          gameObjectiveResults(state).find(
            ({ id }) => id === "early-customers",
          ),
        ).toEqual(completed);
        expect(
          state.objectiveProgress!.entries.find(
            ({ id }) => id === "early-customers",
          )!.observations,
        ).toEqual(beforeObservations);
        expect(state.objectiveProgress!.retentionBaseline).toBe(
          90000 + state.utilityExpansion!.acquisitions[0].transferredCustomers,
        );

        const definition = getScenario(state.scenarioId, state.customScenario)!;
        const goals = scenarioObjectiveDefinitions(definition, state);
        const context = objectiveContextForGame(state, definition);
        expect(context.retentionBaselines?.[59]).toBe(90000);
        const forgedContext = {
          ...context,
          retentionBaselines: {
            ...context.retentionBaselines,
            59: state.objectiveProgress!.retentionBaseline,
          },
        };
        let forged = createObjectiveProgress(
          goals,
          forgedContext,
          state.objectiveProgress!.retentionBaseline,
        );
        for (const history of [...state.monthlyHistory].reverse()) {
          const month =
            absoluteMonth(history.year, history.month) -
            absoluteMonth(state.startingYear, 1);
          forged = recordObjectiveMonth(
            forged,
            goals,
            { month, history },
            forgedContext,
          );
        }
        expect(validObjectiveProgress(forged, goals, forgedContext)).toBe(true);
        expect(validObjectiveProgress(forged, goals, context)).toBe(false);
        const hostile = JSON.parse(JSON.stringify(serializeSave(state)));
        hostile.game.objectiveProgress = forged;
        expect(parseSave(hostile)).toBeNull();

        const restored = parseSave(
          JSON.parse(JSON.stringify(serializeSave(state))),
        );
        expect(restored).not.toBeNull();
        Object.assign(state, copyOfficialGame(restored!.game));
        restoredPurchase = true;
      },
    },
    {
      difficulty: "Employee",
      seed: 12345,
      plan: { scenario, scheduledActions },
    },
  );
  expect(violations).toEqual([]);
  expect(restoredPurchase).toBe(true);
  expect(game.date.monthsElapsed).toBe(240);
  expect(
    gameObjectiveResults(game).find(({ id }) => id === "early-customers"),
  ).toEqual(completed);
  const finalGoal = gameObjectiveResults(game).find(
    ({ id }) => id === "final-customers",
  )!;
  expect(finalGoal.objective).toMatchObject({
    metric: "customerRetention",
    deadlineMonth: 239,
  });
  expect(finalGoal.status).toBe("completed");
  expect(finalGoal.observed).toBe(
    game.monthlyHistory[0].customers /
      game.objectiveProgress!.retentionBaseline,
  );
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
  expect(restored).not.toBeNull();
  expect(gameObjectiveResults(restored!.game)).toEqual(
    gameObjectiveResults(game),
  );

  expect(beforeDeadline).toBeDefined();
  const scoredProgress = JSON.parse(JSON.stringify(game.objectiveProgress));
  const earlierQuote = acquisitionQuote(beforeDeadline!, "ridge-electric")!;
  expect(earlierQuote).toBeDefined();
  const oldBaseline = beforeDeadline!.objectiveProgress!.retentionBaseline;
  const earlier = officialCommand(
    beforeDeadline!,
    acquireUtility({
      targetId: "ridge-electric",
      financed: true,
      quoteKey: earlierQuote.quoteKey,
    }),
  );
  expect(earlier.utilityExpansion!.acquisitions).toHaveLength(2);
  expect(earlier.objectiveProgress!.retentionBaseline).toBe(
    oldBaseline + earlierQuote.customers,
  );
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(earlier)))),
  ).not.toBeNull();
  runMonths(earlier, 1);
  expect(earlier.date.monthsElapsed).toBe(240);
  expect(
    gameObjectiveResults(earlier).find(({ id }) => id === "final-customers")!
      .status,
  ).toBe("completed");
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(earlier)))),
  ).not.toBeNull();

  const laterQuote = acquisitionQuote(game, "ridge-electric")!;
  expect(laterQuote).toBeDefined();
  const later = officialCommand(
    game,
    acquireUtility({
      targetId: "ridge-electric",
      financed: true,
      quoteKey: laterQuote.quoteKey,
    }),
  );
  expect(later.utilityExpansion!.acquisitions).toHaveLength(2);
  expect(expansionRetentionBaseline(later)).toBe(
    scoredProgress.retentionBaseline + laterQuote.customers,
  );
  expect(later.objectiveProgress).toEqual(scoredProgress);
  expect(
    gameObjectiveResults(later).find(({ id }) => id === "final-customers"),
  ).toEqual(finalGoal);
  expect(later.monthlyHistory).toEqual(game.monthlyHistory);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(later)))),
  ).not.toBeNull();
});
