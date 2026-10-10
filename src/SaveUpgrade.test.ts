import legacyFile from "./testing/fixtures/saves/legacy-rules-save.json";
import {
  isFutureSave,
  LEGACY_RULES_ID,
  SAVE_SCHEMA_VERSION,
  upgradeSave,
} from "./SaveUpgrade";
import manifest from "./data/RunCompatibility.json";
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
    expect(file.save.rulesId).toBe(manifest.compatibilityId);
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

  it("recognizes only well-formed newer schemas as future saves", () => {
    expect(
      isFutureSave({
        ...legacyFile.save,
        schemaVersion: SAVE_SCHEMA_VERSION + 1,
      }),
    ).toBe(true);
    expect(isFutureSave({ ...legacyFile.save, schemaVersion: 1.5 })).toBe(
      false,
    );
    expect(isFutureSave(legacyFile.save)).toBe(false);
    expect(isFutureSave(serializeSave(createGame({ scenarioId: 101 })))).toBe(
      false,
    );
  });

  it("does not repair corrupt progress or an unreadable rules fingerprint", () => {
    for (const patch of [
      { customerRate: NaN },
      { facilities: [{}] },
      { replayPlayback: {} },
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

  it("drops the old competitive identity without letting it gate progress", () => {
    for (const patch of [
      { seed: legacyFile.save.game.seed + 1 },
      { meaningfulDecisionGateWaived: true },
      { challenge: { run: {}, target: 10 } },
    ]) {
      const game = parseSave({
        ...legacyFile.save,
        game: { ...legacyFile.save.game, ...patch },
      })!.game;
      expect(game.upgradedFromRules).toBe(
        legacyFile.save.game.runIdentity.compatibilityId,
      );
      expect(game.runIdentity).toBeUndefined();
      expect(game.challenge).toBeUndefined();
    }
  });

  it("marks progress without any recorded rules, so it cannot rank under current rules", () => {
    const { runIdentity: _identity, ...game } = legacyFile.save.game;
    expect(
      parseSave({ ...legacyFile.save, game })!.game.upgradedFromRules,
    ).toBe(LEGACY_RULES_ID);
    // A current-schema run without a shareable identity still records its rules.
    const unshared = serializeSave({
      ...createGame({ scenarioId: 101 }),
      runIdentity: undefined,
    });
    expect(parseSave(unshared)!.game.upgradedFromRules).toBeUndefined();
    const oldId = legacyFile.save.game.runIdentity.compatibilityId;
    expect(
      parseSave({ ...unshared, rulesId: oldId })!.game.upgradedFromRules,
    ).toBe(oldId);
    expect(parseSave({ ...unshared, rulesId: "old" })).toBeNull();
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
    old.rulesId = oldId;
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
    raw.save.rulesId = legacyFile.save.game.runIdentity.compatibilityId;
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
