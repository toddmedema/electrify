import legacyFile from "./testing/fixtures/saves/legacy-rules-save.json";
import { SAVE_SCHEMA_VERSION, upgradeSave } from "./SaveUpgrade";
import { parseSave, serializeSave } from "./SaveGame";
import { encodeSaveFile } from "./SaveFile";
import { validateSaveFileEnvelope } from "./SaveModel";
import { createGame } from "./testing/Simulator";
import { runMonths } from "./testing/SimulationTestHelpers";
import { projectAuthoredRunReference } from "./helpers/RunIdentity";
import { validInvitation } from "./helpers/Challenge";
import type { GameType } from "./Types";
import gameReducer, { start } from "./reducers/Game";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("save upgrades", () => {
  it("upgrades the unversioned fixture and preserves progress without touching its source", () => {
    const raw = clone(legacyFile);
    const original = JSON.stringify(raw);
    const file = validateSaveFileEnvelope(raw, parseSave);
    expect(file.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(file.name).toBe(raw.name);
    expect(file.save.savedAt).toBe(raw.save.savedAt);
    expect(file.save.game).toMatchObject({
      upgradedFromRules: raw.save.game.runIdentity.compatibilityId,
      seed: raw.save.game.seed,
      date: raw.save.game.date,
      facilities: raw.save.game.facilities,
      customerRate: 0.081,
    });
    expect(file.save.game.runIdentity).toBeUndefined();
    expect(file.save.game.challenge).toBeUndefined();
    expect(file.save.game.replayLog).toBeUndefined();
    expect(JSON.stringify(raw)).toBe(original);
    expect(parseSave(encodeSaveFile(file).save)).toEqual(file.save);
  });

  it.each([-1, 1.5, 999, "1", null])(
    "rejects unknown or malformed schema %p",
    (schemaVersion) => {
      expect(parseSave({ ...legacyFile.save, schemaVersion })).toBeNull();
    },
  );

  it("does not repair corrupt progress or contradictory historical identity", () => {
    for (const patch of [
      { seed: legacyFile.save.game.seed + 1 },
      { customerRate: NaN },
      { facilities: [{}] },
      { meaningfulDecisionGateWaived: true },
      { replayPlayback: {} },
      { challenge: { run: {}, target: 10 } },
    ])
      expect(
        parseSave({
          ...legacyFile.save,
          game: { ...legacyFile.save.game, ...patch },
        }),
      ).toBeNull();
    expect(
      parseSave({
        ...legacyFile.save,
        game: {
          ...legacyFile.save.game,
          runIdentity: { compatibilityId: "old" },
        },
      }),
    ).toBeNull();
  });

  it("keeps current challenges intact but upgrades old challenged progress without score equivalence", () => {
    const game = createGame({ scenarioId: 101, seed: 31337 });
    game.challenge = {
      run: projectAuthoredRunReference(game.runIdentity)!,
      target: 400,
    };
    expect(parseSave(serializeSave(game))!.game.challenge).toEqual(
      game.challenge,
    );
    const old = clone(serializeSave(game));
    const oldId = legacyFile.save.game.runIdentity.compatibilityId;
    old.game.runIdentity!.compatibilityId = oldId;
    old.game.challenge!.run.compatibilityId = oldId;
    expect(validInvitation(old.game.challenge)).toBe(false);
    const upgraded = parseSave(old)!.game;
    expect(upgraded.challenge).toBeUndefined();
    expect(upgraded.upgradedFromRules).toBe(oldId);
    expect(projectAuthoredRunReference(upgraded.runIdentity)).toBeUndefined();
    // A forged upgrade marker cannot coexist with a current competitive identity.
    expect(
      parseSave(serializeSave({ ...game, upgradedFromRules: oldId })),
    ).toBeNull();
  });

  it("resumes an upgraded running game and round trips its next checkpoint", () => {
    const game = createGame({ scenarioId: 107 });
    runMonths(game, 1);
    const raw = clone(
      encodeSaveFile({
        name: "Deep Freeze",
        status: "inProgress",
        save: serializeSave(game),
      }),
    );
    const original = parseSave(raw.save)!.game;
    raw.save.game.runIdentity!.compatibilityId =
      legacyFile.save.game.runIdentity.compatibilityId;
    const upgraded = validateSaveFileEnvelope(raw, parseSave).save.game;
    expect(upgraded.timeline).toEqual(original.timeline);
    expect(upgraded.monthlyHistory).toEqual(original.monthlyHistory);
    expect(upgraded.facilities).toEqual(original.facilities);
    const minute = upgraded.date.minute;
    runMonths(upgraded, 1);
    expect(upgraded.date.minute).toBeGreaterThan(minute);
    expect(upgraded.replayLog).toBeUndefined();
    expect(parseSave(serializeSave(upgraded))!.game.upgradedFromRules).toBe(
      legacyFile.save.game.runIdentity.compatibilityId,
    );
  });

  it("leaves already current migrations idempotent", () => {
    const first = upgradeSave(legacyFile.save);
    expect(upgradeSave(first)).toEqual(first);
    const save = serializeSave({
      ...parseSave(legacyFile.save)!.game,
    } as GameType);
    expect(upgradeSave(save)).toEqual(save);
    expect(
      gameReducer(save.game, start(101)).upgradedFromRules,
    ).toBeUndefined();
  });
});
