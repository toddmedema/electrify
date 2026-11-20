import { acquisitionQuote } from "../helpers/Expansion";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { LAND_TERRITORIES } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { ruleDigest } from "../helpers/RuleIdentity";
import { currentTick } from "../helpers/GameSelectors";
import {
  landPurchaseQuote,
  ownedTerritories,
  landPrice,
  tilePurchaseQuotes,
} from "../helpers/Territories";
import {
  getTerritoryTiles,
  getTerritoryTile,
  territoryHexDistance,
} from "../helpers/TerritoryTiles";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { retiredValleyOpeningProgress } from "../testing/SaveTestHelpers";
import publishedEvidence from "../testing/fixtures/valley-schema22-objective-progress.json";
import cloneDeep from "lodash.clonedeep";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";
import type { ObjectiveProgress } from "../data/ScenarioObjectives";
import type { LandTerritoryId } from "../Types";
function ready(matchId = "frontier") {
  loadSimData(UTILITY_AREAS.champlain.location);
  return createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    matchId,
    "epoch",
  );
}
function buy(world: World, seat: string, id: LandTerritoryId) {
  const index = world.seats.findIndex((s) => s.id === seat);
  const target = getTerritoryTiles().find((tile) => tile.territoryId === id)!;
  for (
    let step = 0;
    !landPurchaseQuote(world.grids[index], id) && step < 40;
    step++
  ) {
    const view = roomView(world, seat).game!;
    const nearest = [...tilePurchaseQuotes(view).values()]
      .filter((quote) => {
        const tile = getTerritoryTile(quote.tileId, view)!;
        return quote.territoryId !== id && !tile.city;
      })
      .sort(
        (a, b) =>
          territoryHexDistance(getTerritoryTile(a.tileId)!, target) -
          territoryHexDistance(getTerritoryTile(b.tileId)!, target),
      )[0];
    expect(nearest).toBeDefined();
    expect(
      applyCommand(world, seat, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat] ?? 0) + 1,
        command: {
          kind: "action",
          name: "acquireTile",
          payload: { tileId: nearest.tileId, quoteKey: nearest.quoteKey },
        },
      }),
    ).toBeUndefined();
  }
  const quote = landPurchaseQuote(world.grids[index], id)!;
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: {
      kind: "action",
      name: "acquireLand",
      payload: { territoryId: id, quoteKey: quote.quoteKey },
    },
  });
}
function acquireVergennes(world: World, seat: string, quoteKey: string) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: {
      kind: "action",
      name: "acquireUtility",
      payload: { targetId: "parcel-1", financed: false, quoteKey },
    },
  });
}
it.each([
  [
    19,
    "coop-2-fdb701fc666648e148ecc4d6a02e4b2001090bc79052092a4e567ea9184714ef",
  ],
  [
    20,
    "coop-2-cf979e3b45deb328dd12a266f291e16398174095d47beca6df0d4f9da1dbd577",
  ],
  [
    21,
    "coop-2-fcb444f119733dd48aef5c28f13cb78fc856be210f448c495109eb5987d70476",
  ],
  [
    21,
    "coop-2-15c753596aead2c7b8214074ea6ee123deffa20b96db9d73b4abd0e420548a55",
  ],
  [
    21,
    "coop-2-8423406cc7fc00c2bcf0e3cd7b647ad746beabc840cbeb1fc847e15d0389d64c",
  ],
  [
    22,
    "coop-2-bddc08bd9f13d3fb912bccfa5401e85283039c61e31340ec6a252cd503884fef",
  ],
] as const)(
  "retains independent parcel claims and cash from published schema%i",
  (schema, rules) => {
    const world = ready();
    expect(buy(world, "0", "parcel-0")).toBeUndefined();
    expect(buy(world, "1", "parcel-0")).toMatch(/owned/i);
    const losingCash = currentTick(world.grids[1])!.cash;
    expect(buy(world, "1", "parcel-0")).toMatch(/owned/i);
    expect(currentTick(world.grids[1])!.cash).toBe(losingCash);
    expect(buy(world, "1", "parcel-2")).toBeUndefined();
    const quote = acquisitionQuote(roomView(world, "0").game!, "parcel-1")!;
    expect(acquireVergennes(world, "0", quote.quoteKey)).toBeUndefined();
    expect(roomView(world, "1").game!.multiplayer!.tileOwners).toMatchObject({
      "parcel-0:site-0": { seat: "0" },
      "parcel-1:city": { seat: "0" },
      "parcel-2:site-0": { seat: "1" },
    });
    const saved = JSON.parse(JSON.stringify(checkpointWorld(world)));
    saved.gameSchema = schema;
    saved.rules = rules;
    for (const [index, grid] of world.grids.entries())
      saved.grids[index].objectiveProgress = retiredValleyOpeningProgress(grid);
    if (schema === 22)
      saved.grids[0].territoryWeather = { dryness: 0.81, fires: [] };
    const before = JSON.stringify(saved);
    const restored = restoreWorld(saved, "restored");
    expect(JSON.stringify(saved)).toBe(before);
    expect(() =>
      restoreWorld({ ...saved, rules: "unrecognized" }, "rejected"),
    ).toThrow();
    expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
    expect(restored.grids[0].territoryWeather).toEqual(
      saved.grids[0].territoryWeather,
    );
    expect(
      restored.grids[0].objectiveProgress?.entries.map(({ id }) => id),
    ).toEqual(["acquire-neighbor", "retain-customers"]);
    expect(currentTick(restored.grids[0])!.cash).toBe(
      currentTick(world.grids[0])!.cash,
    );
    expect(ownedTerritories(restored.grids[0])).toEqual(
      expect.arrayContaining(["parcel-0", "parcel-1"]),
    );
    expect(ownedTerritories(restored.grids[1])).toContain("parcel-2");
    expect(acquireVergennes(restored, "1", quote.quoteKey)).toMatch(
      /quote has changed/,
    );
  },
);
describe("published schema 22 Valley checkpoints", () => {
  type Lineage = keyof typeof publishedEvidence;
  let played: World;

  function send(world: World, seat: string, command: Command) {
    expect(
      applyCommand(world, seat, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat] ?? 0) + 1,
        command,
      }),
    ).toBeUndefined();
  }

  function resume(world: World) {
    for (const { id } of world.seats) {
      send(world, id, { kind: "ready" });
      send(world, id, { kind: "speed", speed: "NORMAL" });
    }
  }

  beforeAll(() => {
    // Play the same shared seed and transfer as the published objective captures.
    const world = ready("published-schema22");
    resume(world);
    stepWorld(world);
    currentTick(world.grids[0])!.cash = 3e9;
    const quote = acquisitionQuote(world.grids[0], "valley-electric")!;
    send(world, "0", {
      kind: "action",
      name: "acquireUtility",
      payload: {
        targetId: quote.targetId,
        financed: false,
        quoteKey: quote.quoteKey,
      },
    });
    for (
      let tick = 0;
      world.grids[0].date.monthsElapsed < 1 && tick < 1000;
      tick++
    )
      stepWorld(world);
    expect(world.grids[0].date.monthsElapsed).toBe(1);
    expect(world.grids[0].utilityExpansion?.acquisitions[0].targetId).toBe(
      "valley-electric",
    );
    played = JSON.parse(JSON.stringify(checkpointWorld(world)));
  });

  function checkpoint(lineage: Lineage): World {
    const { rules, objectiveProgress } = publishedEvidence[lineage];
    const saved = cloneDeep(played);
    saved.gameSchema = 22;
    saved.rules = rules;
    for (const [index, grid] of saved.grids.entries()) {
      grid.objectiveProgress = cloneDeep(
        objectiveProgress[index],
      ) as ObjectiveProgress;
      if (lineage === "preview") delete grid.territoryWeather;
    }
    return saved;
  }

  it.each(["master", "preview"] as const)(
    "retains paid assets, history and weather on %s restore and deterministic resume",
    (lineage) => {
      const saved = checkpoint(lineage);
      const before = cloneDeep(saved);
      const restored = restoreWorld(saved, "restored");
      expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
      expect(saved).toEqual(before);
      for (const [index, grid] of restored.grids.entries()) {
        const original = saved.grids[index];
        expect(grid.utilityExpansion).toEqual(original.utilityExpansion);
        expect(grid.territoryNetwork).toEqual(original.territoryNetwork);
        expect(grid.monthlyHistory).toEqual(original.monthlyHistory);
        expect(grid.territoryWeather).toEqual(original.territoryWeather);
        expect(currentTick(grid)!.cash).toBe(currentTick(original)!.cash);
        expect(grid.objectiveProgress).toEqual(
          played.grids[index].objectiveProgress,
        );
      }
      const roundTrip = restoreWorld(
        JSON.parse(JSON.stringify(checkpointWorld(restored))),
        "round-trip",
      );
      for (const world of [restored, roundTrip]) {
        resume(world);
        for (let tick = 0; tick < 10; tick++) stepWorld(world);
      }
      expect(restored.grids[0].date.minute).toBeGreaterThan(
        saved.grids[0].date.minute,
      );
      expect(roundTrip.grids).toEqual(restored.grids);
    },
  );

  function recomputeChecksum(progress: ObjectiveProgress) {
    const {
      version,
      rulesDigest,
      retentionBaseline,
      completedMonths,
      entries,
    } = progress;
    progress.checksum = ruleDigest({
      version,
      rulesDigest,
      retentionBaseline,
      completedMonths,
      entries: entries.map(({ id, digest, duplicateMonths }) => ({
        id,
        digest,
        duplicateMonths,
      })),
    });
  }

  const unknownDigest = `sha256-${"0".repeat(64)}`;

  it("rejects preview evidence with a changed rules digest even if its checksum matches", () => {
    const saved = checkpoint("preview");
    const progress = saved.grids[0].objectiveProgress!;
    progress.rulesDigest = unknownDigest;
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/unsupported format/);
    recomputeChecksum(progress);
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/unsupported format/);

    progress.rulesDigest =
      publishedEvidence.master.objectiveProgress[0].rulesDigest;
    recomputeChecksum(progress);
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/unsupported format/);
  });

  it("rejects a corrupt preview checksum with the original rules digest", () => {
    const saved = checkpoint("preview");
    saved.grids[0].objectiveProgress!.checksum = unknownDigest;
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/invalid grids/);
  });

  it("rejects a corrupt retired checksum or evidence chain before rebuilding", () => {
    const saved = checkpoint("master");
    const progress = saved.grids[0].objectiveProgress!;
    progress.checksum = unknownDigest;
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/unsupported format/);

    progress.entries[0].digest = unknownDigest;
    recomputeChecksum(progress);
    expect(() => restoreWorld(saved, "corrupt")).toThrow(/unsupported format/);
  });

  it.each([
    ["master", "preview"],
    ["preview", "master"],
  ] as const)(
    "rejects complete %s evidence under %s rules",
    (evidence, rules) => {
      const saved = checkpoint(rules);
      saved.grids[0].objectiveProgress =
        checkpoint(evidence).grids[0].objectiveProgress;
      expect(() => restoreWorld(saved, "corrupt")).toThrow(
        /unsupported format/,
      );
    },
  );
});
it("migrates only recognized published schema14 co-op rules and keeps paid claims and cash", () => {
  const world = ready();
  world.grids[0].territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: landPrice(world.grids[0], 0),
  });
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  raw.gameSchema = 14;
  raw.rules =
    "coop-2-b4c8f4641c919057a7b569242464c24e26bcec444ef68954be2796b7734bbbb8";
  for (const grid of raw.grids) {
    grid.territoryNetwork.version = 2;
    delete grid.territoryNetwork.tilePurchases;
    delete grid.territoryNetwork.legacyTiles;
  }
  const restored = restoreWorld(raw, "migrated");
  expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
  expect(currentTick(restored.grids[0])!.cash).toBe(
    currentTick(world.grids[0])!.cash,
  );
  expect(ownedTerritories(restored.grids[0])).toContain("green-uplands");
  expect(restored.grids[0].runIdentity).toEqual(raw.grids[0].runIdentity);
  const wrong = JSON.parse(JSON.stringify(raw));
  wrong.rules = "unrecognized";
  expect(() => restoreWorld(wrong, "rejected")).toThrow();
  expect(LAND_TERRITORIES).toHaveLength(19);
});
