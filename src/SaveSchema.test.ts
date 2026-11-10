import { parseSave, serializeSave } from "./SaveGame";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { createGame } from "./testing/Simulator";
import { projectAuthoredRunReference } from "./helpers/RunIdentity";

const game = createGame({ scenarioId: 101, seed: 31337 });

it.each([
  undefined,
  ...Array.from({ length: 6 }, (_, version) => version),
  SAVE_SCHEMA_VERSION + 1,
  -1,
  1.5,
  String(SAVE_SCHEMA_VERSION),
  null,
])(
  "rejects an unsupported or malformed schema %p without repairing it",
  (schemaVersion) => {
    const save = { ...serializeSave(game), schemaVersion };
    expect(parseSave(save)).toBeNull();
    expect(save.schemaVersion).toBe(schemaVersion);
    expect(parseSave(serializeSave(game))).not.toBeNull();
  },
);

it("never rewrites a run or challenge from another build to current rules", () => {
  const save = JSON.parse(JSON.stringify(serializeSave(game)));
  save.game.challenge = {
    run: projectAuthoredRunReference(game.runIdentity),
    target: 400,
  };
  expect(parseSave(save)?.game.challenge).toEqual(save.game.challenge);
  save.game.runIdentity.compatibilityId = "different-rules";
  save.game.challenge.run.compatibilityId = "different-rules";
  const original = JSON.stringify(save);
  expect(parseSave(save)).toBeNull();
  expect(JSON.stringify(save)).toBe(original);
});

it.each([6, 7])(
  "upgrades legacy schema %i without changing progress or the stored original",
  (schemaVersion) => {
    const legacy = JSON.parse(JSON.stringify(serializeSave(game)));
    legacy.schemaVersion = schemaVersion;
    if (legacy.game.transmission) {
      legacy.game.transmission.tradingPolicy = "BALANCED";
      delete legacy.game.transmission.buyingRule;
      delete legacy.game.transmission.sellingRule;
    }
    if (schemaVersion === 6) legacy.game.replayLog = [];
    const original = JSON.stringify(legacy);
    const upgraded = parseSave(legacy);
    expect(upgraded).not.toBeNull();
    expect(upgraded!.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(upgraded!.game.date).toEqual(game.date);
    expect(upgraded!.game.timeline[0].cash).toEqual(game.timeline[0].cash);
    expect(upgraded!.game.facilities).toEqual(game.facilities);
    expect(JSON.stringify(legacy)).toBe(original);
  },
);

it("continues an older rules digest without retaining stale challenge identity or mutating its source", () => {
  const save = JSON.parse(JSON.stringify(serializeSave(game)));
  save.schemaVersion = 8;
  save.game.runIdentity.compatibilityId = `rules-1-${"0".repeat(64)}`;
  save.game.challenge = {
    run: {
      ...projectAuthoredRunReference(game.runIdentity),
      compatibilityId: save.game.runIdentity.compatibilityId,
    },
    target: 400,
  };
  const original = JSON.stringify(save);
  const continued = parseSave(save);
  expect(continued).not.toBeNull();
  expect(continued!.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(continued!.game.rulesChanged).toBe(true);
  expect(continued!.game.runIdentity).toBeUndefined();
  expect(continued!.game.challenge).toBeUndefined();
  expect(continued!.game.date).toEqual(game.date);
  expect(continued!.game.timeline[0].cash).toBe(game.timeline[0].cash);
  expect(continued!.game.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  expect(JSON.stringify(save)).toBe(original);
  expect(
    parseSave(JSON.parse(JSON.stringify(continued)))?.game.rulesChanged,
  ).toBe(true);
});

it.each([
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.seed++;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.scenarioId++;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.origin = "custom";
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.inputs.cash++;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.inputs.location.lat++;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.inputs.scenario = "not json";
  },
  (save: ReturnType<typeof historicalSave>) => {
    delete save.game.runIdentity.inputs.facilities;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.runIdentity.unexpected = true;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.challenge.run.seed++;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.challenge.target = "400";
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.rulesChanged = true;
  },
  (save: ReturnType<typeof historicalSave>) => {
    save.game.rulesChanged = "true";
  },
])(
  "does not carry malformed historical identity or challenge into a playable save",
  (corrupt) => {
    const save = historicalSave();
    corrupt(save);
    expect(parseSave(save)).toBeNull();
  },
);

function historicalSave() {
  const save = JSON.parse(JSON.stringify(serializeSave(game)));
  save.game.runIdentity.compatibilityId = `rules-1-${"0".repeat(64)}`;
  save.game.challenge = {
    run: {
      ...projectAuthoredRunReference(game.runIdentity),
      compatibilityId: save.game.runIdentity.compatibilityId,
    },
    target: 400,
  };
  return save;
}
