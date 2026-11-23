import cloneDeep from "lodash.clonedeep";
import { UnknownAction } from "@reduxjs/toolkit";
import reducer, { delta, initGame, resume } from "./Game";
import { launchRun } from "./GameActions";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { SCENARIOS } from "../data/Scenarios";
import { GameType, ChallengeInvitation } from "../Types";
import {
  projectAuthoredRunReference,
  sameRunIdentity,
} from "../helpers/RunIdentity";
import * as math from "../helpers/Math";
import { parseSave, serializeSave } from "../SaveGame";
import { mapDispatchToProps } from "../components/views/LoadingContainer";
import * as weather from "../data/Weather";
import * as fuel from "../data/FuelPrices";
import * as economy from "../data/Economy";

jest.setTimeout(120000);
it.each([
  101,
  SCENARIOS.find((s) => !s.tutorialSteps && s.seed !== undefined)!.id,
])(
  "real loading launcher uses normal seed selection and restores progress in mission %p",
  async (scenarioId) => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
    const freshSeed = 7654321;
    const original = createGame({
      scenarioId,
      seed: scenario.seed ?? 1234567,
      difficulty: "Employee",
    });
    const expected = createGame({
      scenarioId,
      seed: scenario.seed ?? freshSeed,
      difficulty: "Employee",
    });
    const challenge: ChallengeInvitation = {
      scenarioId,
      difficulty: "Employee",
      target: 0,
    };
    let accepted = reducer(
      {
        ...original,
        difficulty: "CEO",
      },
      launchRun(challenge),
    );
    expect(accepted.monthlyHistory).toEqual([]);
    expect(accepted.difficulty).toBe("Employee");
    // Real loaded data came from createGame; only network callbacks are replaced, not initGame.
    const mocks = [
      jest.spyOn(math, "newSeed").mockReturnValue(freshSeed),
      jest
        .spyOn(weather, "initWeather")
        .mockImplementation((_location, done) => done?.()),
      jest.spyOn(fuel, "initFuelPrices").mockImplementation((done) => done?.()),
      jest.spyOn(economy, "initEconomy").mockImplementation((done) => done?.()),
    ];
    const actions: UnknownAction[] = [];
    const dispatch = ((action: UnknownAction) => {
      actions.push(action);
      if (action.type !== "game/loaded") accepted = reducer(accepted, action);
      return action;
    }) as never;
    let left = cloneDeep(expected);
    const checkpoints: GameType[] = [];
    for (let i = 0; i < 2; i++) {
      left = cloneDeep(
        reducer(left, delta({ dollarsPerkWh: 0.08 + i * 0.01 })),
      );
      runMonths(left, 1);
      checkpoints.push(cloneDeep(left));
    }
    const errors = jest.fn();
    await mapDispatchToProps(dispatch).load(accepted, errors);
    mocks.forEach((mock) => mock.mockRestore());
    expect(errors).not.toHaveBeenCalled();
    expect(actions.some((a) => a.type === initGame.type)).toBe(true);
    expect(accepted.seed).toBe(scenario.seed ?? freshSeed);
    expect(sameRunIdentity(expected.runIdentity, accepted.runIdentity)).toBe(
      true,
    );
    expect(JSON.stringify(accepted.timeline)).toEqual(
      JSON.stringify(expected.timeline),
    );
    expect(accepted.facilities).toEqual(expected.facilities);
    let right = cloneDeep(accepted);
    for (let i = 0; i < 2; i++) {
      right = cloneDeep(
        reducer(right, delta({ dollarsPerkWh: 0.08 + i * 0.01 })),
      );
      runMonths(right, 1);
      expect(right.monthlyHistory).toEqual(checkpoints[i].monthlyHistory);
      expect(right.eventLog).toEqual(checkpoints[i].eventLog);
      expect(right.facilities).toEqual(checkpoints[i].facilities);
    }
    const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(right))));
    expect(saved).not.toBeNull();
    expect(saved!.game.challenge).toEqual(challenge);
    const restored = reducer(undefined, resume(saved!.game));
    expect(restored.challenge).toEqual(challenge);
    expect(restored.runIdentity).toEqual(right.runIdentity);
    const legacy = parseSave({
      ...saved,
      schemaVersion: 24,
      game: {
        ...saved!.game,
        challenge: {
          run: projectAuthoredRunReference(right.runIdentity),
          target: challenge.target,
        },
      },
    });
    expect(legacy).not.toBeNull();
    const continued = reducer(undefined, resume(legacy!.game));
    expect(continued.challenge).toEqual(challenge);
    const next = cloneDeep(restored);
    const migratedNext = cloneDeep(continued);
    runMonths(next, 1);
    runMonths(migratedNext, 1);
    expect(migratedNext.monthlyHistory).toEqual(next.monthlyHistory);
  },
);
it("preserves unranked saves without manufacturing identity and rejects contradictory metadata", () => {
  const game = createGame({ scenarioId: 101, seed: 42 });
  const unranked = { ...game, runIdentity: undefined };
  expect(parseSave(serializeSave(unranked))!.game.runIdentity).toBeUndefined();
  expect(
    parseSave(
      serializeSave({
        ...game,
        challenge: {
          scenarioId: game.scenarioId,
          difficulty: game.difficulty,
          target: 0.5,
        },
      }),
    ),
  ).toBeNull();
  expect(parseSave(serializeSave({ ...game, seed: 43 }))).toBeNull();
  for (const change of [
    { location: { ...game.location, lat: 0 } },
    { meaningfulDecisionGateWaived: true },
    { storyEffectsDisabled: true },
    { customScenario: SCENARIOS.find((s) => s.id === 101) },
  ])
    expect(parseSave(serializeSave({ ...game, ...change }))).toBeNull();
  const input = game.runIdentity!.inputs;
  expect(
    reducer(
      { ...game, storyEffectsDisabled: true },
      initGame({
        facilities: input.facilities,
        cash: input.cash,
        customers: input.customers,
        location: input.location,
        seed: 42,
      }),
    ).runIdentity,
  ).toBeUndefined();
  expect(
    reducer(game, delta({ storyEffectsDisabled: true })).runIdentity,
  ).toBeUndefined();
  expect(
    reducer(game, delta({ meaningfulDecisionGateWaived: true })).runIdentity,
  ).toBeUndefined();
  expect(reducer(game, delta({ dollarsPerkWh: 0.1 })).runIdentity).toEqual(
    game.runIdentity,
  );
});
