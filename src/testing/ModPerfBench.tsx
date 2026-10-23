/** Explicitly selected by perf:bench --mods; absolute timings are reported, never gated. */
import fs from "fs";
import { MessageChannel } from "worker_threads";
import { createNextState, freeze } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import {
  packProjection,
  projectionDecoder,
} from "../components/base/ProjectionTransport";
import { currentTick } from "../helpers/GameSelectors";
import { hasChronicBlackouts } from "../helpers/ObjectiveRules";
import { getScenarioLocation } from "../helpers/Locations";
import { selectProjection } from "../helpers/Projection";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { RULE_LIMITS } from "../helpers/ScenarioRulesSchema";
import { modResolvedSetup, modScenario } from "../mods/ModScenario";
import { MAX_MOD_BYTES, validateMod } from "../mods/ModSchema";
import type { Command, World } from "../multiplayer/Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "../multiplayer/World";
import { ViewPublication } from "../multiplayer/ViewPublication";
import { tickState } from "../reducers/Game";
import { parseSave, serializeSave } from "../SaveGame";
import type { GameType } from "../Types";
import { checkMonth, InvariantCollector } from "./Invariants";
import { maximumRulePackage, MOD_PERF_MONTHS } from "./ModPerfFixtures";
import { coopSeats } from "./MultiplayerFixtures";
import { loadSimData } from "./SimData";

const codec = require("../../electron/steam-multiplayer.cjs");
jest.setTimeout(900000);
beforeEach(() => jest.useFakeTimers("legacy"));
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
function measure<T>(run: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = run();
  return { ms: performance.now() - start, value };
}
function samples(run: () => unknown, count: number) {
  return Array.from({ length: count }, () => measure(run).ms);
}

/** Use native structured cloning through a MessagePort, including the real transferable buffers.
 * This isolates serialization/dispatch in Node; it does not claim Chromium worker compute time. */
function transfer<T>(value: T, buffers: ArrayBuffer[] = []) {
  return new Promise<{ ms: number; value: T }>((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    const start = performance.now();
    const close = () => {
      port1.close();
      port2.close();
    };
    port1.once("message", (value: T) => {
      const ms = performance.now() - start;
      close();
      resolve({ ms, value });
    });
    port1.once("messageerror", (error) => {
      close();
      reject(error);
    });
    try {
      port2.postMessage(value, buffers);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

function command(world: World, seat: string, command: Command) {
  const error = applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command,
  });
  if (error) throw new Error(error);
}

/** Actual 100-year play, with ordinary cash purchases every20 years to replace the aging fleet.
 * Large legal opening cash and small demand isolate rule/history costs from economic balance. */
function playWorld(scenario: ReturnType<typeof modScenario>) {
  const world = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: scenario },
    coopSeats(4),
    "maximum-rules-benchmark",
    "benchmark-epoch",
  );
  let decisions = 0;
  for (let index = 0; index < world.seats.length; index++) {
    const seat = world.seats[index];
    let choice;
    while ((choice = pendingScenarioChoice(world.grids[index]))) {
      command(world, seat.id, {
        kind: "action",
        name: "chooseScenarioResponse",
        payload: { decisionId: choice.id, optionId: choice.options[0].id },
      });
      decisions++;
    }
    command(world, seat.id, { kind: "ready" });
  }
  expect(decisions).toBe(RULE_LIMITS.choices * 4);
  const opening = cloneDeep(world.grids[0]);
  let late: GameType | undefined;
  let months = 0;
  let minCash = Infinity;
  const started = performance.now();
  for (let tick = 0; tick < MOD_PERF_MONTHS * TICKS_PER_MONTH; tick++) {
    stepWorld(world);
    const next = world.grids[0].date.monthsElapsed;
    if (next === months) continue;
    months = next;
    if (months % 120 === 0)
      process.stderr.write(
        `Maximum-rule world: ${months}/${MOD_PERF_MONTHS} months\n`,
      );
    for (const game of world.grids) {
      const cash = currentTick(game)!.cash;
      minCash = Math.min(minCash, cash);
      if (cash < 0 || hasChronicBlackouts(game.monthlyHistory, game.difficulty))
        throw new Error(
          `Stress workload ended economically at month ${months}`,
        );
    }
    if (months === MOD_PERF_MONTHS - 1) late = cloneDeep(world.grids[0]);
    if (months % 240 === 0 && months < MOD_PERF_MONTHS) {
      world.seats.forEach((seat, index) => {
        const game = world.grids[index];
        const facility = GENERATORS(
          game,
          500e6,
          game.timeline.map((tick) => tick.windKph),
          game.timeline.map((tick) => tick.solarIrradianceWM2),
        ).find(
          (facility) =>
            facility.name === "Natural Gas Peaker" && facility.available,
        );
        if (!facility) throw new Error("Replacement peaker is unavailable");
        command(world, seat.id, {
          kind: "action",
          name: "buildFacility",
          payload: { facility, financed: false },
        });
      });
    }
  }
  const ms = performance.now() - started;
  expect(world.grids.map((game) => game.monthlyHistory.length)).toEqual([
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
  ]);
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual([
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
    MOD_PERF_MONTHS,
  ]);
  const invariants = new InvariantCollector();
  for (const game of world.grids)
    game.monthlyHistory.forEach((month) =>
      checkMonth(invariants, month, `${month.year}-${month.month}`),
    );
  expect(invariants.getViolations()).toEqual([]);
  expect(late).toBeDefined();
  return { world, opening, late: late!, ms, minCash, decisions };
}

function tickCosts(game: GameType, runs: number) {
  const result = [];
  let reference: unknown;
  for (const immer of [false, true]) {
    const ordinary: number[] = [];
    const rollovers: number[] = [];
    // Discard the first run on each path to warm its code and cache.
    for (let run = -1; run < runs; run++) {
      // The browser's Immer path is solo; co-op runs tickStatePhases on plain worker state.
      // Use the same complete solo projection as World's strict grid validator.
      let state = cloneDeep({
        ...game,
        multiplayer: undefined,
        transmission: game.transmission
          ? { tradingPolicy: game.transmission.tradingPolicy, lines: [] }
          : undefined,
      });
      if (immer) state = freeze(state, true);
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) {
        const before = state.monthlyHistory.length;
        const start = performance.now();
        if (immer)
          state = createNextState(state, (draft: GameType) => tickState(draft));
        else tickState(state);
        const ms = performance.now() - start;
        if (run >= 0)
          (state.monthlyHistory.length > before ? rollovers : ordinary).push(
            ms,
          );
      }
      expect(state.monthlyHistory).toHaveLength(game.monthlyHistory.length + 1);
      const month = JSON.parse(JSON.stringify(state.monthlyHistory[0]));
      if (reference === undefined) reference = month;
      else expect(month).toEqual(reference);
    }
    result.push({
      path: immer ? "Immer" : "plain",
      monthsBefore: game.monthlyHistory.length,
      monthsAfter: game.monthlyHistory.length + 1,
      ordinaryMedianMs: median(ordinary),
      rolloverMedianMs: median(rollovers),
      rolloverMaxMs: Math.max(...rollovers),
    });
  }
  return result;
}

it("benchmarks maximum rules and real1200-month histories", async () => {
  const started = performance.now();
  const runs = Math.max(1, Number(process.env.PERF_RUNS) || 3);
  const pack = maximumRulePackage();
  const packageJson = JSON.stringify(pack);
  expect(Buffer.byteLength(packageJson)).toBeLessThanOrEqual(MAX_MOD_BYTES);
  const validationMs = samples(() => validateMod(pack), runs);
  loadSimData(getScenarioLocation(modResolvedSetup(pack))!);
  const cold = measure(() => modScenario(pack, undefined, "Employee"));
  expect(cold.ms).toBeGreaterThan(0);
  const compilationMs = samples(
    () => modScenario(pack, undefined, "Employee"),
    runs,
  );
  const scenario = cold.value;
  const rules = scenario.mod!.rules;
  expect(rules.events).toHaveLength(RULE_LIMITS.events);
  expect(rules.choices).toHaveLength(RULE_LIMITS.choices);
  expect(
    rules.choices.every(
      (choice) => choice.options.length === RULE_LIMITS.options,
    ),
  ).toBe(true);
  expect(rules.loads).toHaveLength(
    RULE_LIMITS.events * RULE_LIMITS.loadsPerEvent,
  );
  expect(rules.objectives).toHaveLength(RULE_LIMITS.objectives);
  const compiledBytes = Buffer.byteLength(JSON.stringify(scenario));
  expect(compiledBytes).toBeLessThanOrEqual(RULE_LIMITS.compiledBytes);

  const played = playWorld(scenario);
  if (process.env.PERF_MOD_CHECKPOINT_FILE)
    fs.writeFileSync(
      process.env.PERF_MOD_CHECKPOINT_FILE,
      codec.stringify(checkpointWorld(played.world)),
    );
  const ticks = {
    opening: tickCosts(played.opening, runs),
    finalMonth: tickCosts(played.late, runs),
  };
  // Completion dialogs/save scheduling are UI side effects, not worker serialization. Legacy
  // fake timers leave performance.now real; discard those callbacks before yielding to the port.
  jest.clearAllTimers();
  jest.useRealTimers();
  const game = played.world.grids[0];
  const snapshotTiming = measure(() => forecastWorkerSnapshot(game));
  const request = {
    requestId: 1,
    game: snapshotTiming.value,
    now: currentTick(game)!,
  };
  const requestTransfers: number[] = [];
  for (let index = 0; index < runs; index++) {
    const transported = await transfer(request);
    requestTransfers.push(transported.ms);
    expect(transported.value.game.monthlyHistory).toHaveLength(MOD_PERF_MONTHS);
    expect(transported.value.game.customScenario?.mod?.runtimeDigest).toBe(
      scenario.mod!.runtimeDigest,
    );
  }
  const projectionTiming = measure(() =>
    selectProjection(request.game, request.now),
  );
  const projection = projectionTiming.value;
  const packing: number[] = [];
  const responseTransfers: number[] = [];
  const decoding: number[] = [];
  let transferBytes = 0;
  for (let index = 0; index < runs; index++) {
    const packed = measure(() => packProjection(projection));
    packing.push(packed.ms);
    transferBytes = packed.value.transfers.reduce(
      (bytes, buffer) => bytes + buffer.byteLength,
      0,
    );
    const response = await transfer(
      packed.value.transport,
      packed.value.transfers,
    );
    responseTransfers.push(response.ms);
    const decoded = measure(() =>
      projectionDecoder(response.value, request.game, request.now)(Infinity),
    );
    decoding.push(decoded.ms);
    expect(decoded.value?.forecast).toHaveLength(projection.forecast.length);
    expect(decoded.value?.forecast.at(-1)).toEqual(projection.forecast.at(-1));
    expect(decoded.value?.financePast).toHaveLength(MOD_PERF_MONTHS);
  }

  // World's own strict grid validator projects each company through this solo-save boundary.
  const solo = {
    ...game,
    multiplayer: undefined,
    transmission: game.transmission
      ? { tradingPolicy: game.transmission.tradingPolicy, lines: [] }
      : undefined,
  };
  const soloEncoding = measure(() => JSON.stringify(serializeSave(solo)));
  const soloParsing = measure(() => parseSave(JSON.parse(soloEncoding.value)));
  expect(soloParsing.value?.game.monthlyHistory).toHaveLength(MOD_PERF_MONTHS);
  const worldEncoding = measure(
    () => codec.stringify(checkpointWorld(played.world)) as string,
  );
  const worldParsing = measure(() =>
    restoreWorld(codec.parse(worldEncoding.value), "restored-benchmark"),
  );
  expect(
    worldParsing.value.grids.map((game) => game.monthlyHistory.length),
  ).toEqual([1200, 1200, 1200, 1200]);
  const worldBytes = Buffer.byteLength(worldEncoding.value);
  // The production native encoder enforces its existing16MiB uncompressed transfer budget.
  const encoded = measure(() =>
    codec.encode({ kind: "checkpoint", world: checkpointWorld(played.world) }),
  );
  expect(worldBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  const publication = new ViewPublication();
  const views = measure(() =>
    publication.take(played.world, performance.now()),
  );
  const viewTransfer = await transfer({ kind: "views", views: views.value });
  expect(Object.keys(viewTransfer.value.views)).toHaveLength(4);

  const result = {
    workload: {
      kind: "maximum-mod-rules",
      events: rules.events.length,
      choices: rules.choices.length,
      optionsPerChoice: RULE_LIMITS.options,
      loads: rules.loads.length,
      objectives: rules.objectives.length,
      historyMonths: MOD_PERF_MONTHS,
      companies: 4,
      seed: pack.seed,
      difficulty: "Employee",
      balancedChallenge: false,
    },
    runs,
    compilation: {
      structuralMedianMs: median(validationMs),
      coldAllDifficultiesMs: cold.ms,
      repeatedAllDifficultiesMedianMs: median(compilationMs),
      packageBytes: Buffer.byteLength(packageJson),
      compiledBytes,
    },
    play: {
      ms: played.ms,
      ticks: MOD_PERF_MONTHS * TICKS_PER_MONTH,
      decisions: played.decisions,
      minCash: played.minCash,
    },
    ticks,
    worker: {
      transport:
        "Node MessagePort native structured clone; production snapshot/pack/decoder",
      snapshotMs: snapshotTiming.ms,
      requestJsonBytes: Buffer.byteLength(JSON.stringify(request)),
      requestMedianMs: median(requestTransfers),
      projectionMs: projectionTiming.ms,
      forecastTicks: projection.forecast.length,
      packedBufferBytes: transferBytes,
      packMedianMs: median(packing),
      responseMedianMs: median(responseTransfers),
      decodeMedianMs: median(decoding),
      fourViewBuildMs: views.ms,
      fourViewTransferMs: viewTransfer.ms,
    },
    saves: {
      soloBytes: Buffer.byteLength(soloEncoding.value),
      soloEncodeMs: soloEncoding.ms,
      soloParseMs: soloParsing.ms,
      fourCompanyBytes: worldBytes,
      worldEncodeMs: worldEncoding.ms,
      worldRestoreMs: worldParsing.ms,
      checkpointCompressedBytes: encoded.value.bytes.length,
      checkpointEncodeMs: encoded.ms,
    },
    benchMs: performance.now() - started,
  };
  if (process.env.PERF_RESULT_FILE)
    fs.writeFileSync(process.env.PERF_RESULT_FILE, JSON.stringify(result));
  if (process.env.PERF_QUIET !== "1")
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
});
