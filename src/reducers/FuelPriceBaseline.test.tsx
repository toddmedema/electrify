import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { loadSimData } from "../testing/SimData";
import { runMonths } from "../testing/SimulationTestHelpers";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld, stepWorld } from "../multiplayer/World";
import gameReducer, { resume } from "./Game";
import type { GameType } from "../Types";

const fuelEvents = (game: GameType) =>
  game.eventLog.filter((event) => event.kind === "FUEL_PRICE");

beforeAll(() => loadSimData("SF"));

test("save, load and the next rollover retain the same fuel spike as uninterrupted play", () => {
  const game = createGame({ scenarioId: 100, seed: 2468 });
  for (let month = 0; month < 36; month++) {
    const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!;
    expect(saved).not.toBeNull();
    const before = fuelEvents(game).length;
    runMonths(game, 1);
    if (fuelEvents(game).length <= before) continue;

    const restored = cloneDeep(gameReducer(undefined, resume(saved.game)));
    runMonths(restored, 1);
    expect(fuelEvents(restored)).toEqual(fuelEvents(game));
    return;
  }
  throw new Error("The fixed fixture must encounter a fuel spike");
});

test("every co-op grid compares fuel prices with its own prior month", () => {
  const world = createWorld(COOP_TEST_SPEC, coopSeats(4), "fuel-test", "epoch");
  world.seats.forEach((seat) => {
    expect(
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: 1,
        command: { kind: "speed", speed: "NORMAL" },
      }),
    ).toBeUndefined();
  });
  while (world.grids[0].date.monthsElapsed < 36) {
    const before = world.grids[0].date.minute;
    stepWorld(world);
    expect(world.grids[0].date.minute).toBeGreaterThan(before);
    if (!fuelEvents(world.grids[0]).length) continue;
    for (const grid of world.grids) {
      expect(fuelEvents(grid)).toEqual(fuelEvents(world.grids[0]));
    }
    return;
  }
  throw new Error("The fixed co-op fixture must encounter a fuel spike");
});
