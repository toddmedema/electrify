import legacyFile from "./testing/fixtures/saves/legacy-rules-save.json";
import { isFutureSave, SAVE_SCHEMA_VERSION, upgradeSave } from "./SaveUpgrade";
import manifest from "./data/RunCompatibility.json";
import { parseSave, serializeSave } from "./SaveGame";
import { encodeSaveFile } from "./SaveFile";
import { validateSaveFileEnvelope } from "./SaveModel";
import { createGame } from "./testing/Simulator";
import { runMonths } from "./testing/SimulationTestHelpers";
import { projectAuthoredRunReference } from "./helpers/RunIdentity";
import { challengeComparison } from "./helpers/Challenge";
import type { GameType, VictoryType } from "./Types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const OLD_RULES = legacyFile.save.game.runIdentity.compatibilityId;

/** A current run with a friend's challenge, saved as if by an earlier deploy. */
function challengedSave() {
  const game = createGame({ scenarioId: 101, seed: 31337 });
  game.challenge = {
    run: projectAuthoredRunReference(game.runIdentity)!,
    target: 400,
  };
  const save = clone(serializeSave(game));
  save.game.runIdentity!.compatibilityId = OLD_RULES;
  save.game.challenge!.run.compatibilityId = OLD_RULES;
  return { game, save };
}

describe("save upgrades", () => {
  it("upgrades the unversioned fixture and carries its run forward without touching its source", () => {
    const raw = clone(legacyFile);
    const original = JSON.stringify(raw);
    const file = validateSaveFileEnvelope(raw, parseSave);
    expect(file.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(file.name).toBe(raw.name);
    expect(file.save.savedAt).toBe(raw.save.savedAt);
    expect(file.save.game).toMatchObject({
      seed: raw.save.game.seed,
      date: raw.save.game.date,
      facilities: raw.save.game.facilities,
      customerRate: 0.081,
    });
    expect(projectAuthoredRunReference(file.save.game.runIdentity)).toEqual({
      scenarioId: raw.save.game.scenarioId,
      seed: raw.save.game.seed,
      difficulty: raw.save.game.difficulty,
      compatibilityId: manifest.compatibilityId,
    });
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

  it("does not repair corrupt progress", () => {
    for (const patch of [{ customerRate: NaN }, { facilities: [{}] }])
      expect(
        parseSave({
          ...legacyFile.save,
          game: { ...legacyFile.save.game, ...patch },
        }),
      ).toBeNull();
  });

  it("carries a friend's challenge forward so the comparison still works", () => {
    const { game, save } = challengedSave();
    expect(parseSave(serializeSave(game))!.game.challenge).toEqual(
      game.challenge,
    );
    const carried = parseSave(save)!.game;
    expect(carried.runIdentity).toEqual(game.runIdentity);
    expect(carried.challenge).toEqual(game.challenge);
    expect(
      challengeComparison({
        runIdentity: carried.runIdentity,
        challenge: carried.challenge,
        score: 450,
      } as VictoryType),
    ).toBe("You beat the shared score by 50 points.");
  });

  it("keeps progress but quietly drops a shareable run its scenario no longer describes", () => {
    const { save } = challengedSave();
    save.game.runIdentity!.seed = -1;
    const game = parseSave(save)!.game;
    expect(game.runIdentity).toBeUndefined();
    expect(game.challenge).toBeUndefined();
    expect(game.seed).toBe(31337);
  });

  it("still rejects a challenge that never matched its own run", () => {
    const { save } = challengedSave();
    save.game.challenge!.run.seed = 7;
    expect(parseSave(save)).toBeNull();
  });

  it("resumes a running game from an earlier deploy and keeps recording its replay", () => {
    const game = createGame({ scenarioId: 107 });
    runMonths(game, 1);
    const raw = clone(
      encodeSaveFile({
        name: "Deep Freeze",
        status: "inProgress",
        save: serializeSave(game),
      }),
    );
    const original = clone(parseSave(raw.save)!.game);
    raw.save.game.runIdentity!.compatibilityId = OLD_RULES;
    const resumed = validateSaveFileEnvelope(raw, parseSave).save.game;
    expect(resumed.timeline).toEqual(original.timeline);
    expect(resumed.monthlyHistory).toEqual(original.monthlyHistory);
    expect(resumed.facilities).toEqual(original.facilities);
    expect(resumed.runIdentity).toEqual(original.runIdentity);
    expect(resumed.replayLog).toEqual(original.replayLog);
    expect(resumed.replayLog).toBeDefined();
    const minute = resumed.date.minute;
    runMonths(resumed, 1);
    expect(resumed.date.minute).toBeGreaterThan(minute);
    expect(parseSave(serializeSave(resumed))!.game.replayLog).toEqual(
      resumed.replayLog,
    );
  });

  it("leaves already current saves idempotent", () => {
    const first = upgradeSave(legacyFile.save);
    expect(upgradeSave(first)).toEqual(first);
    const save = serializeSave({
      ...parseSave(legacyFile.save)!.game,
    } as GameType);
    expect(upgradeSave(save)).toEqual(save);
    expect(parseSave(parseSave(save))).toEqual(parseSave(save));
  });
});
