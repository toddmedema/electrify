import fs from "fs";
import "../Store";
import { loadSimData } from "../testing/SimData";
import { currentTick } from "../helpers/GameSelectors";
import { applyCommand, checkpointWorld, createWorld, stepWorld } from "./World";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";

test("four grids finish five years with conserved trade and bounded complete saves", () => {
  loadSimData("SF");
  const world = createWorld(
    COOP_TEST_SPEC,
    coopSeats(4),
    "five-year-test",
    "epoch",
  );
  world.seats.forEach((s) =>
    applyCommand(world, s.id, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: 1,
      command: { kind: "ready" },
    }),
  );
  const durations: number[] = [];
  let maxCompressedBytes = 0,
    maxJsonBytes = 0;
  const { encode, stringify } = require("../../electron/steam-multiplayer.cjs");
  while (world.grids[0].date.monthsElapsed < 60) {
    const month = world.grids[0].date.monthsElapsed;
    const started = performance.now();
    stepWorld(world);
    durations.push(performance.now() - started);
    const ticks = world.grids.map((g) => currentTick(g)!);
    expect(new Set(world.grids.map((g) => g.date.minute)).size).toBe(1);
    expect(
      ticks.reduce(
        (sum, t) => sum + (t.importedW || 0) - (t.exportedW || 0),
        0,
      ),
    ).toBeCloseTo(0, 1);
    ticks.forEach((t) => {
      expect(Number.isFinite(t.cash)).toBe(true);
      expect(t.expensesFuel).toBeGreaterThanOrEqual(0);
    });
    if (world.grids[0].date.monthsElapsed !== month) {
      const snapshot = checkpointWorld(world);
      maxJsonBytes = Math.max(
        maxJsonBytes,
        Buffer.byteLength(stringify(snapshot)),
      );
      maxCompressedBytes = Math.max(
        maxCompressedBytes,
        encode({ kind: "checkpoint", world: snapshot }).bytes.length,
      );
    }
  }
  stepWorld(world);
  expect(world.paused).toBe(true);
  expect(world.reason).toMatch(/complete/);
  durations.sort((a, b) => a - b);
  const report = {
    players: 4,
    years: 5,
    ticks: durations.length,
    meanTickMs: durations.reduce((a, b) => a + b, 0) / durations.length,
    p95TickMs: durations[Math.floor(durations.length * 0.95)],
    maxTickMs: durations.at(-1),
    maxJsonBytes,
    maxCompressedBytes,
  };
  if (process.env.MP_BENCHMARK_REPORT)
    fs.writeFileSync(
      process.env.MP_BENCHMARK_REPORT,
      JSON.stringify(report, null, 2),
    );
  expect(maxJsonBytes).toBeLessThan(16 * 1024 * 1024);
  expect(maxCompressedBytes).toBeLessThan(4 * 1024 * 1024);
}, 120000);
