import { getScenario } from "../data/Scenarios";
import type { ObjectiveProgress } from "../data/ScenarioObjectives";
import { modScenario } from "../mods/ModScenario";
import { parseSave, serializeSave } from "../SaveGame";
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
  playOfficialExecution,
} from "./OfficialScenarioExecutionFixtures";
import { modPackage } from "./ModFixtures";
import {
  EXPANSION_BALANCE_CASES,
  expansionBalanceActions,
} from "./UtilityExpansionBalanceFixtures";

jest.setTimeout(120000);

it("keeps a completed mod retention deadline through purchase, save/resume and the expanded 2024 goal", () => {
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
  const { game, violations } = playOfficialExecution(
    116,
    {
      monthClose(state) {
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
    ({ objective }) =>
      objective.metric === "customerRetention" &&
      objective.deadlineMonth === 239,
  )!;
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
});
