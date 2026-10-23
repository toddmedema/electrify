import "../Store";
import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { validateMod } from "../mods/ModSchema";
import { getScenarioLocation } from "../helpers/Locations";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import type { Command, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "./World";

const command = (world: World, seat: string, action: Command) =>
  applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: action,
  });
const consent = (world: World) =>
  world.seats.forEach((seat) =>
    expect(command(world, seat.id, { kind: "ready" })).toBeUndefined(),
  );
function advance(world: World, months: number) {
  for (
    let tick = 0;
    world.grids[0].date.monthsElapsed < months &&
    tick < (months + 1) * TICKS_PER_MONTH;
    tick++
  )
    stepWorld(world);
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual([
    months,
    months,
  ]);
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
test("the checked-in funded/phased example runs two independent company decisions and survives library removal", () => {
  const pack = validateMod(
    JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../docs/mods/examples/funded-or-phased-connection.json",
        ),
        "utf8",
      ),
    ),
  );
  const location = getScenarioLocation(modResolvedSetup(pack));
  if (!location) throw new Error("Missing example location");
  loadSimData(location);
  const selected = modScenario(pack, undefined, "Employee");
  const world = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: selected },
    coopSeats(2),
    "example-connection",
    "original",
  );
  for (const seat of world.seats) {
    const game = world.grids[Number(seat.id)];
    const quote = GENERATORS(
      game,
      50e6,
      game.timeline.map((t) => t.windKph),
      game.timeline.map((t) => t.solarIrradianceWM2),
    ).find((f) => f.name === "Natural Gas Peaker")!;
    expect(
      command(world, seat.id, {
        kind: "action",
        name: "buildFacility",
        payload: { facility: quote, financed: true },
      }),
    ).toBeUndefined();
    expect(
      command(world, seat.id, { kind: "rate", value: 0.12 }),
    ).toBeUndefined();
  }
  consent(world);
  advance(world, 48);
  expect(world.grids.every((game) => pendingScenarioChoice(game))).toBe(true);
  const pending = JSON.parse(JSON.stringify(checkpointWorld(world)));
  const library = new Map([[pack.id, cloneDeep(pack)]]);
  const updated = cloneDeep(pack);
  updated.version = "2";
  updated.description =
    "An updated package that must not enter this saved match.";
  library.set(pack.id, updated);
  expect(
    modScenario(updated, undefined, "Employee").mod!.runtimeDigest,
  ).not.toBe(selected.mod!.runtimeDigest);
  library.delete(pack.id);
  expect(library.size).toBe(0);
  const resumed = restoreWorld(pending, "after-removal");
  for (const target of [world, resumed]) {
    const before = target.grids.map((game) => currentTick(game)!.cash);
    target.seats.forEach((seat, index) => {
      const decision = pendingScenarioChoice(target.grids[index])!;
      expect(
        command(target, seat.id, {
          kind: "action",
          name: "chooseScenarioResponse",
          payload: {
            decisionId: decision.id,
            optionId: index === 0 ? "fast-track" : "phased",
          },
        }),
      ).toBeUndefined();
    });
    expect(currentTick(target.grids[0])!.cash - before[0]).toBe(15000000);
    expect(currentTick(target.grids[1])!.cash - before[1]).toBe(0);
    const answered = target.grids[0].worldEvents.occurrences.find(
      (event) => event.attributes.scenarioChoice,
    )!;
    const cash = currentTick(target.grids[0])!.cash;
    expect(
      command(target, "0", {
        kind: "action",
        name: "chooseScenarioResponse",
        payload: { decisionId: answered.key, optionId: "fast-track" },
      }),
    ).toBeUndefined();
    expect(currentTick(target.grids[0])!.cash).toBe(cash);
    consent(target);
    advance(target, 108);
    expect(
      Object.values(target.outcomes).map((result) => result.outcome),
    ).toEqual(["completed", "completed"]);
    target.grids.forEach((game) => {
      expect(
        gameObjectiveResults(game).every((goal) => goal.status === "completed"),
      ).toBe(true);
      expect(game.customScenario!.mod!.source.version).toBe("1");
      expect(game.runIdentity).toBeUndefined();
    });
  }
  resumed.grids.forEach((game, index) => {
    expect(game.monthlyHistory).toEqual(world.grids[index].monthlyHistory);
    expect(game.worldEvents).toEqual(world.grids[index].worldEvents);
    expect(game.objectiveProgress).toEqual(
      world.grids[index].objectiveProgress,
    );
  });
  expect(world.grids[0].loadAdditions).toHaveLength(1);
  expect(world.grids[1].loadAdditions).toHaveLength(2);
});
