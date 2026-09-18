import cloneDeep from "lodash.clonedeep";
import { UnknownAction } from "@reduxjs/toolkit";
import reducer, { delta, initGame, resume } from "./Game";
import { launchRun } from "./GameActions";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { SCENARIOS } from "../data/Scenarios";
import { GameType, ChallengeInvitationV1 } from "../Types";
import {
  projectAuthoredRunReference,
  expandAuthoredRunReference,
  sameRunIdentity,
} from "../helpers/RunIdentity";
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
  "real loading launcher reproduces initial state and timed actions for mission %p",
  async (scenarioId) => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
    const original = createGame({
      scenarioId,
      seed: scenario.seed ?? 1234567,
      difficulty: "Employee",
    });
    const reference = projectAuthoredRunReference(original.runIdentity)!;
    expect(reference).toBeDefined();
    const identity = expandAuthoredRunReference(reference)!;
    const challenge: ChallengeInvitationV1 = {
      invitationSchemaVersion: 1,
      run: reference,
      target: 0,
    };
    let accepted = reducer(
      {
        ...original,
        difficulty: "CEO",
        replayPlayback: { actions: [], index: 0 },
      },
      launchRun({ identity, challenge }),
    );
    expect(accepted.replayPlayback).toBeUndefined();
    expect(accepted.monthlyHistory).toEqual([]);
    expect(accepted.difficulty).toBe("Employee");
    // Real loaded data came from createGame; only network callbacks are replaced, not initGame.
    const mocks = [
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
    let left = cloneDeep(original);
    const checkpoints: GameType[] = [];
    for (let i = 0; i < 2; i++) {
      left = cloneDeep(
        reducer(left, delta({ dollarsPerkWh: 0.08 + i * 0.01 })),
      );
      runMonths(left, 1);
      checkpoints.push(cloneDeep(left));
    }
    const errors = jest.fn();
    await mapDispatchToProps(dispatch).load(accepted, jest.fn(), errors);
    mocks.forEach((mock) => mock.mockRestore());
    expect(errors).not.toHaveBeenCalled();
    expect(actions.some((a) => a.type === initGame.type)).toBe(true);
    expect(sameRunIdentity(original.runIdentity, accepted.runIdentity)).toBe(
      true,
    );
    expect(JSON.stringify(accepted.timeline)).toEqual(
      JSON.stringify(original.timeline),
    );
    expect(accepted.facilities).toEqual(original.facilities);
    expect(accepted.replayLog).toEqual([]);
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
  },
);
it("preserves legacy saves without manufacturing identity and rejects contradictory new metadata", () => {
  const game = createGame({ scenarioId: 101, seed: 42 });
  const legacy = { ...game, runIdentity: undefined };
  expect(parseSave(serializeSave(legacy))!.game.runIdentity).toBeUndefined();
  expect(
    parseSave(
      serializeSave({
        ...game,
        runIdentity: { ...game.runIdentity!, compatibilityId: "old" },
      }),
    ),
  ).toBeNull();
  expect(
    parseSave(
      serializeSave({
        ...game,
        challenge: {
          invitationSchemaVersion: 1,
          run: projectAuthoredRunReference(game.runIdentity)!,
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
