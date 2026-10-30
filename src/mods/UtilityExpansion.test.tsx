import type { GameType } from "../Types";
import { validUtilityExpansion } from "../helpers/ExpansionValidation";
import cloneDeep from "lodash.clonedeep";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import { acquisitionQuote } from "../helpers/Expansion";
import { isUtilityExpansionGame } from "../helpers/ExpansionContext";
import { serializeSave, parseSave } from "../SaveGame";
import reducer, {
  buildTransmissionLine,
  generateForecastTimeline,
  tickState,
} from "../reducers/Game";
import { acquireUtility } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
} from "../multiplayer/World";
import type { Command } from "../multiplayer/Types";
import { modScenario, modValidationDiagnostics } from "./ModScenario";
import type { ModPackage } from "./ModSchema";

const pack = (): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "community-valley",
  title: "Community Valley",
  creator: "Planner",
  version: "1",
  description: "Keep the regional utility supplied.",
  baseScenarioId: 116,
  seed: 12345,
  scenario: { cash: 1e9, dollarsPerkWh: 0.105 },
  facilities: { Solar: { buildCost: 0.5 } },
  programs: { efficiency: 0.5 },
  events: [
    {
      id: "local-notice",
      title: "Local plan",
      message: "Prepare the expanded utility.",
      startMonth: 2,
    },
  ],
});

beforeEach(() => loadSimData(UTILITY_AREAS.champlain.location));

it("mod base 116 preserves source rights, operating areas, obligations and exact save/forecast behavior", () => {
  const scenario = modScenario(pack());
  let game = createGame({
    scenarioId: 999,
    scenario,
    seed: 12345,
    difficulty: "Employee",
  });
  expect(isUtilityExpansionGame(game)).toBe(true);
  expect(game.utilityExpansion!.areas.map((area) => area.id)).toEqual([
    "champlain",
  ]);
  expect(game.objectiveProgress!.retentionBaseline).toBe(90000);
  expect(game.objectiveProgress!.entries).toHaveLength(4);
  expect(currentTick(game)!.entitlementImportCapacityW).toBeGreaterThan(0);
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "vt-champlain-ridge",
        financed: true,
      }),
    ),
  );
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "ridge-electric")!;
  expect(quote).toBeDefined();
  game = copyOfficialGame(
    reducer(
      game,
      acquireUtility({
        targetId: quote.targetId,
        financed: true,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  expect(game.utilityExpansion!.areas.map((area) => area.id)).toEqual([
    "champlain",
    "ridge-electric",
  ]);
  const before = JSON.parse(JSON.stringify(serializeSave(game)));
  const now = currentTick(game)!;
  const forecast = generateForecastTimeline(game, now.cash, now.customers, 8);
  expect(forecast.every((tick) => !!tick.areaTicks?.["ridge-electric"])).toBe(
    true,
  );
  expect(JSON.stringify(serializeSave(game).game)).toBe(
    JSON.stringify(before.game),
  );
  expect(serializeSave(game).commitmentForecast).toEqual(
    before.commitmentForecast,
  );
  const saved = parseSave(before);
  expect(saved).not.toBeNull();
  const resumed = saved!.game;
  for (let tick = 0; tick < 8; tick++) {
    tickState(game);
    tickState(resumed);
  }
  expect(JSON.stringify(serializeSave(resumed).game)).toBe(
    JSON.stringify(serializeSave(game).game),
  );
});

it.each([
  ["startingYear", { startingYear: 2006 }],
  ["durationMonths", { durationMonths: 120 }],
  ["startingCustomers", { startingCustomers: 100000 }],
  ["startingDemandScale", { startingDemandScale: 2 }],
  ["location", { location: UTILITY_AREAS["ridge-electric"].location }],
  [
    "startingFleet",
    { startingFleet: [{ name: "Natural Gas CC", peakMW: 100 }] },
  ],
])(
  "rejects incompatible expansion opening override %s with its exact field",
  (field, change) => {
    expect(modValidationDiagnostics({ ...pack(), scenario: change })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `scenario.${field}`,
          code: "expansion-opening",
          severity: "error",
        }),
      ]),
    );
  },
);

it("the host owns acquisitions and restores native target lines for a mod base 116 world", () => {
  const scenario = modScenario(pack());
  const world = createWorld(
    { scenarioId: 999, customScenario: scenario, difficulty: "Employee" },
    coopSeats(2),
    "mod-expansion",
    "epoch",
  );
  const command = (action: Command) =>
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences["0"] || 0) + 1,
      command: action,
    });
  expect(
    command({
      kind: "action",
      name: "buildTransmissionLine",
      payload: { corridorId: "vt-champlain-ridge", financed: true },
    }),
  ).toBeUndefined();
  world.grids[0].transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-ridge",
  )!.yearsToBuildLeft = 0;
  const peer = cloneDeep(world.grids[1].utilityExpansion);
  const quote = acquisitionQuote(world.grids[0], "ridge-electric")!;
  expect(
    command({
      kind: "action",
      name: "acquireUtility",
      payload: {
        targetId: quote.targetId,
        financed: true,
        quoteKey: quote.quoteKey,
      },
    }),
  ).toBeUndefined();
  expect(world.grids[1].utilityExpansion).toEqual(peer);
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "resumed",
  );
  expect(restored.grids[0].utilityExpansion).toEqual(
    world.grids[0].utilityExpansion,
  );
  expect(
    restored.grids[0].transmission!.lines.map((line) => line.corridorId),
  ).toContain("vt-champlain-ridge");
});

it.each([116, 999])(
  "pins immutable expansion headers for native/mod scenario %s without pinning mutable cohorts",
  (scenarioId) => {
    const scenario = scenarioId === 999 ? modScenario(pack()) : undefined;
    const game = createGame({
      scenarioId,
      ...(scenario ? { scenario } : {}),
      seed: 12345,
      difficulty: "Employee",
    });
    const original = JSON.parse(JSON.stringify(serializeSave(game)));
    expect(validUtilityExpansion(original.game)).toBe(true);
    expect(parseSave(original)).not.toBeNull();
    const mutations: ((game: GameType) => void)[] = [
      (game) => {
        game.startingYear = 2006;
      },
      (game) => {
        game.startingDemandScale *= 2;
      },
      (game) => {
        game.demandShapeExponent = 1;
      },
      (game) => {
        game.location = { ...game.location, lat: game.location.lat + 0.1 };
      },
    ];
    for (const mutate of mutations) {
      const forged = cloneDeep(original);
      mutate(forged.game);
      expect(validUtilityExpansion(forged.game)).toBe(false);
      expect(parseSave(forged)).toBeNull();
    }
  },
);
