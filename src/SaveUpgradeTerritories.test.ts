import cloneDeep from "lodash.clonedeep";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { parseSave, serializeSave } from "./SaveGame";
import { upgradeSave } from "./SaveUpgrade";
import { createGame } from "./testing/Simulator";
import { copyOfficialGame } from "./testing/OfficialScenarioExecutionFixtures";
import { acquisitionQuote } from "./helpers/Expansion";
import { currentTick } from "./helpers/GameSelectors";
import {
  facilityTerritoryId,
  territoryBuildAvailability,
} from "./helpers/Territories";
import { GENERATORS } from "./data/Facilities";
import { modScenario } from "./mods/ModScenario";
import { modPackage } from "./testing/ModFixtures";
import reducer, {
  buildFacility,
  buildTransmissionLine,
  tickState,
} from "./reducers/Game";
import { acquireUtility } from "./reducers/GameActions";

function legacyPortfolio() {
  let game = createGame({ scenarioId: 116, seed: 61 });
  delete game.territoryNetwork;
  currentTick(game)!.cash = 3e9;
  const wind = GENERATORS(game, 200e6, [20], [500]).find(
    (facility) => facility.fuel === "Wind",
  )!;
  game = copyOfficialGame(
    reducer(game, buildFacility({ facility: wind, financed: true })),
  );
  const gas = GENERATORS(game, 100e6, [20], [500]).find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  for (let project = 0; project < 4; project++)
    game = copyOfficialGame(
      reducer(game, buildFacility({ facility: gas, financed: true })),
    );
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "vt-champlain-valley",
        financed: true,
      }),
    ),
  );
  game.transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-valley",
  )!.yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "valley-electric")!;
  expect(quote).toBeDefined();
  game = copyOfficialGame(
    reducer(
      game,
      acquireUtility({
        targetId: "valley-electric",
        financed: true,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 12;
  delete raw.game.territoryNetwork;
  raw.game.facilities.forEach(
    (facility: { territoryId?: unknown }) => delete facility.territoryId,
  );
  raw.game.timeline.forEach(
    (tick: { territories?: unknown }) => delete tick.territories,
  );
  return raw;
}

it("migrates scenario116 by provenance while retaining player projects, contracts, cash, history, debt and progress", () => {
  const raw = legacyPortfolio();
  const original = cloneDeep(raw);
  const upgraded = upgradeSave(raw)!;
  expect(upgraded).not.toBeNull();
  expect(raw).toEqual(original);
  expect(upgraded.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  const migrated = parseSave(raw);
  expect(migrated).not.toBeNull();
  const game = migrated!.game;
  expect(game.territoryNetwork).toEqual({ version: 1 });
  expect(
    game.facilities
      .filter((facility) => facility.startingAssetId?.includes("-valley-"))
      .map(facilityTerritoryId),
  ).toEqual(["valley-electric", "valley-electric", "valley-electric"]);
  expect(
    game.facilities
      .filter((facility) => !facility.startingAssetId)
      .map(facilityTerritoryId),
  ).toEqual(Array(5).fill("champlain"));
  expect(
    game.facilities.find((facility) => !facility.startingAssetId)?.peakW,
  ).toBe(200e6);
  const gas = GENERATORS(game, 100e6, [20], [500]).find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  expect(territoryBuildAvailability(game, gas, "champlain")).toMatchObject({
    buildable: false,
    remaining: 0,
  });
  for (const key of [
    "timeline",
    "monthlyHistory",
    "date",
    "transmission",
    "utilityExpansion",
    "meaningfulDecisions",
  ] as const)
    expect(game[key]).toEqual(raw.game[key]);
  expect(parseSave(serializeSave(game))?.game).toEqual(game);
});

it("accepts a paused acquired connection and nonzero internal readings without losing ownership", () => {
  const game = parseSave(legacyPortfolio())!.game;
  const line = game.transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-valley",
  )!;
  line.paused = true;
  line.currentFlowW = 0;
  expect(parseSave(serializeSave(game))).not.toBeNull();
  line.paused = false;
  line.currentFlowW = -20e6;
  expect(parseSave(serializeSave(game))).not.toBeNull();
});

it("keeps current-format roundtrips and resumed seeded operations deterministic", () => {
  const game = parseSave(legacyPortfolio())!.game;
  const resumed = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  for (let tick = 0; tick < 5; tick++) {
    tickState(game);
    tickState(resumed);
  }
  expect(game).toEqual(resumed);
  expect(parseSave(serializeSave(game))).not.toBeNull();
});

it("does not enable territory rules in another scenario", () => {
  const game = createGame({ scenarioId: 100, seed: 61 });
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 12;
  expect(parseSave(raw)).toEqual(
    parseSave({ ...raw, schemaVersion: SAVE_SCHEMA_VERSION }),
  );
  raw.game.territoryNetwork = { version: 1 };
  expect(parseSave(raw)).toBeNull();
});

it.each(["bad-id", null, 6, {}, "ridge-electric", "green-uplands"])(
  "rejects a current save that moves a home asset to %p",
  (territoryId) => {
    const raw = JSON.parse(
      JSON.stringify(serializeSave(parseSave(legacyPortfolio())!.game)),
    );
    raw.game.facilities[0].territoryId = territoryId;
    expect(parseSave(raw)).toBeNull();
  },
);

it.each([
  undefined,
  null,
  { version: 2 },
  { version: 1, ownership: ["ridge-electric"] },
])("rejects malformed or missing current network marker %p", (marker) => {
  const raw = JSON.parse(
    JSON.stringify(serializeSave(parseSave(legacyPortfolio())!.game)),
  );
  raw.game.territoryNetwork = marker;
  expect(parseSave(raw)).toBeNull();
});

it("validates derived balances while retaining legacy history without a summary", () => {
  const raw = JSON.parse(
    JSON.stringify(serializeSave(parseSave(legacyPortfolio())!.game)),
  );
  const tick = raw.game.timeline[0];
  const balance = {
    demandW: tick.demandW,
    supplyW: tick.supplyW,
    generationW: tick.supplyW,
    storageChargeW: 0,
    storageDischargeW: 0,
    importedW: tick.importedW ?? 0,
    exportedW: tick.exportedW ?? 0,
    unservedW: Math.max(0, tick.demandW - tick.supplyW),
    curtailedW: 0,
  };
  tick.territories = { champlain: balance };
  expect(parseSave(raw)).not.toBeNull();
  balance.unservedW = -1;
  expect(parseSave(raw)).toBeNull();
  balance.unservedW = Math.max(0, tick.demandW - tick.supplyW);
  tick.territories = { "made-up": balance };
  expect(parseSave(raw)).toBeNull();
});

it("rejects malformed legacy facilities instead of repairing a hybrid network", () => {
  const raw = legacyPortfolio();
  raw.game.facilities[0].territoryId = "ridge-electric";
  expect(parseSave(raw)).toBeNull();
  delete raw.game.facilities[0].territoryId;
  raw.game.facilities[0] = null;
  expect(() => parseSave(raw)).not.toThrow();
  expect(parseSave(raw)).toBeNull();
});

it("enables the same network when a supported save uses a mod based on scenario116", () => {
  const scenario = modScenario(
    modPackage({ id: "valley-migration", baseScenarioId: 116, seed: 61 }),
  );
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 61,
    difficulty: "Employee",
  });
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 12;
  delete raw.game.territoryNetwork;
  raw.game.facilities.forEach(
    (facility: { territoryId?: unknown }) => delete facility.territoryId,
  );
  raw.game.timeline.forEach(
    (tick: { territories?: unknown }) => delete tick.territories,
  );
  const migrated = parseSave(raw);
  expect(migrated).not.toBeNull();
  expect(migrated!.game.territoryNetwork).toEqual({ version: 1 });
  expect(migrated!.game.customScenario).toEqual(raw.game.customScenario);
});

it.each(["supplyW", "importedW", "exportedW"] as const)(
  "rejects a save whose territory %s total disagrees with its tick",
  (field) => {
    const game = createGame({ scenarioId: 116, seed: 61 });
    tickState(game);
    const raw = JSON.parse(JSON.stringify(serializeSave(game)));
    const tick = raw.game.timeline.find(
      (entry: { minute: number }) => entry.minute === game.date.minute,
    );
    expect(parseSave(raw)).not.toBeNull();
    tick[field] += 1e6;
    expect(parseSave(raw)).toBeNull();
    delete tick.territories;
    expect(parseSave(raw)).not.toBeNull();
  },
);
