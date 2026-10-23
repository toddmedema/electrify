import manifest from "./data/RunCompatibility.json";
import cloneDeep from "lodash.clonedeep";
import { LOCATIONS } from "./Constants";
import { decodeReplay, encodeReplay, serializeReplay } from "./Replay";
import type { GameType, ReplayType } from "./Types";
import { getScenarioLocation } from "./helpers/Locations";
import { modScenario } from "./mods/ModScenario";
import reducer, { delta, initGame, start, tickState } from "./reducers/Game";
import { createGame, createGameFromReplay } from "./testing/Simulator";
import { loadSimData } from "./testing/SimData";

const scenario = (
  transactions: Array<{
    kind: "charge" | "grant";
    amountDollars: number;
  }> = [{ kind: "grant", amountDollars: 10000 }],
) =>
  modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "replay-snapshot",
    title: "Replay snapshot",
    creator: "Fixture author",
    version: "1",
    description: "A frozen grid and a recorded company grant.",
    seed: 2468,
    baseScenarioId: 999,
    officialArcs: [],
    objectives: [],
    scenario: {
      startingYear: 2025,
      durationMonths: 6,
      cash: 1e9,
      startingCustomers: 10000,
      dollarsPerkWh: 0.2,
    },
    events: [
      {
        id: "funding",
        title: "Funding arrives",
        message: "The company receives funding.",
        preview: "The company will receive funding.",
        startMonth: 2,
        durationMonths: "untilEnd",
        effects: {
          demandMultiplier: 1.05,
          transactions,
        },
      },
    ],
  });

function newGame() {
  const frozen = scenario();
  return createGame({
    scenarioId: 999,
    scenario: frozen,
    seed: frozen.seed,
    difficulty: "Employee",
  });
}

function replay(): ReplayType {
  const captured = serializeReplay(newGame());
  expect(captured).toBeDefined();
  return captured!;
}

beforeAll(() => loadSimData(LOCATIONS.SF));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("internal replay carries the detached mod and reproduces recorded months without its package", () => {
  let original = newGame();
  original = cloneDeep(
    reducer(original, delta({ dollarsPerkWh: original.dollarsPerkWh + 0.01 })),
  );
  while (original.date.monthsElapsed < 2) tickState(original);
  const captured = serializeReplay(original)!;
  const document = JSON.parse(JSON.stringify(encodeReplay(captured)));
  const decoded = decodeReplay(document);
  expect(decoded).not.toBeNull();
  expect(decoded!.customScenario).toEqual(original.customScenario);
  expect(decoded!.customScenario).not.toBe(original.customScenario);

  const playback = createGameFromReplay(decoded!);
  while (playback.date.monthsElapsed < original.date.monthsElapsed)
    tickState(playback);
  expect(playback.monthlyHistory).toEqual(original.monthlyHistory);
  expect(playback.worldEvents.occurrences).toEqual(
    original.worldEvents.occurrences,
  );
  expect(playback.customScenario!.mod!.runtimeDigest).toBe(
    original.customScenario!.mod!.runtimeDigest,
  );
  expect(playback.replayLog).toBeUndefined();

  document.customScenario.mod.source.description = "An unrelated later edit.";
  expect(decoded!.customScenario!.mod!.source.description).toBe(
    "A frozen grid and a recorded company grant.",
  );
});

test.each([
  [
    "location",
    (value: ReplayType) => {
      value.location = LOCATIONS.PIT;
    },
  ],
  [
    "seed",
    (value: ReplayType) => {
      value.seed++;
    },
  ],
  [
    "difficulty",
    (value: ReplayType) => {
      value.difficulty = "CEO";
    },
  ],
  [
    "official identity",
    (value: ReplayType) => {
      value.scenarioId = 106;
    },
  ],
  [
    "setup",
    (value: ReplayType) => {
      value.customScenario!.cash++;
    },
  ],
  [
    "missing snapshot",
    (value: ReplayType) => {
      delete value.customScenario;
    },
  ],
] as const)(
  "untrusted mod replay rejects a changed %s and accepts its valid neighbor",
  (_label, change) => {
    const valid = replay();
    const forged = cloneDeep(valid);
    change(forged);
    expect(decodeReplay(encodeReplay(forged))).toBeNull();
    expect(decodeReplay(encodeReplay(valid))).toEqual(valid);
  },
);

test("official replay location selection remains available without mod provenance", () => {
  const official: ReplayType = {
    appVersion: "fixture",
    compatibilityId: manifest.compatibilityId,
    monthlyCash: [],
    scenarioId: 100,
    seed: 2468,
    difficulty: "Employee",
    location: cloneDeep(LOCATIONS.PIT),
    actions: [],
  };
  expect(decodeReplay(encodeReplay(official))).toEqual(official);
});

test("direct internal playback rejects a missing custom snapshot before choosing a different scenario", () => {
  const incomplete = replay();
  delete incomplete.customScenario;
  expect(() => createGameFromReplay(incomplete)).toThrow(/snapshot/i);
});

test("accepted unordered transaction data keeps identical receipts under the same runtime digest", () => {
  const frozen = scenario(
    [1e12, 0.1].map((amountDollars) => ({
      kind: "grant" as const,
      amountDollars,
    })),
  );
  const original = createGame({
    scenarioId: 999,
    scenario: frozen,
    difficulty: "Employee",
    seed: frozen.seed,
  });
  while (original.date.monthsElapsed < 1) tickState(original);
  const captured = serializeReplay(original)!;
  const reordered = cloneDeep(captured);
  reordered.customScenario!.mod!.rules.events[0].transactions.reverse();
  const decoded = decodeReplay(encodeReplay(reordered));
  expect(decoded).not.toBeNull();
  expect(decoded!.customScenario!.mod!.runtimeDigest).toBe(
    frozen.mod!.runtimeDigest,
  );
  const playback = createGameFromReplay(decoded!);
  while (playback.date.monthsElapsed < 1) tickState(playback);
  expect(playback.worldEvents.occurrences).toEqual(
    original.worldEvents.occurrences,
  );
  expect(playback.timeline.map((tick) => tick.revenueGrants)).toEqual(
    original.timeline.map((tick) => tick.revenueGrants),
  );
});

test.each([
  "cash",
  "customers",
  "facilities",
  "location",
  "seed",
  "difficulty",
] as const)(
  "initialization rejects a %s override atomically while accepting the frozen setup",
  (field) => {
    const frozen = scenario();
    let before = reducer(undefined, start(999));
    before = reducer(
      before,
      delta({ customScenario: frozen, difficulty: "Employee" }),
    );
    const payload = {
      facilities: cloneDeep(frozen.facilities),
      cash: frozen.cash,
      customers: frozen.startingCustomers!,
      location: cloneDeep(getScenarioLocation(frozen)!),
      seed: frozen.seed!,
    };
    const invalid = cloneDeep(payload);
    let invalidState = before;
    switch (field) {
      case "cash":
        invalid.cash++;
        break;
      case "customers":
        invalid.customers++;
        break;
      case "facilities":
        invalid.facilities = [];
        break;
      case "location":
        invalid.location = cloneDeep(LOCATIONS.PIT);
        break;
      case "seed":
        invalid.seed++;
        break;
      case "difficulty":
        invalidState = reducer(before, delta({ difficulty: "CEO" }));
        break;
    }
    const unchanged = cloneDeep(invalidState);
    expect(() => reducer(invalidState, initGame(invalid))).toThrow(
      /runtime snapshot is invalid/,
    );
    expect(invalidState).toEqual(unchanged);
    const initialized: GameType = reducer(before, initGame(payload));
    expect(initialized.customScenario).toEqual(frozen);
    expect(initialized.location).toEqual(payload.location);
    expect(initialized.seed).toBe(frozen.seed);
    expect(initialized.difficulty).toBe("Employee");
  },
);
