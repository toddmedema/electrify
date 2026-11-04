/** Opt-in paired catalog calculation benchmark: npm run perf:build-forecast. */
import fs from "fs";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { LEGACY_CAMPAIGN_ID } from "../data/LegacyCampaign";
import { prepareCustomScenario } from "../helpers/CustomScenarioEvents";
import { computeOutlook } from "../components/base/OutlookForecast";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import { fullBuildForecast } from "./BuildForecastComparison";
import { runMonths } from "./SimulationTestHelpers";
import { createGame } from "./Simulator";
import { tickState } from "../reducers/Game";
import type { GameType } from "../Types";

jest.setTimeout(120000);

const fixtures = [
  {
    name: "Shale Boom opening",
    create: () => createGame({ scenarioId: 103, seed: 12345 }),
  },
  {
    name: "Developed Madrid hydro, month 13 + 7 ticks",
    create: () => {
      const game = createGame({
        scenarioId: 108,
        seed: 7,
        difficulty: "Intern",
      });
      runMonths(game, 13);
      for (let index = 0; index < 7; index++) tickState(game);
      return game;
    },
  },
  {
    name: "Custom SF offshore, separate watershed and composed arcs",
    create: () =>
      createGame({
        scenarioId: 999,
        scenario: prepareCustomScenario({
          ...DEFAULT_CUSTOM_SCENARIO,
          startingYear: 2030,
          eventScenarioIds: [108, 107, 111],
        }),
        seed: 29,
      }),
  },
  {
    name: "Across the Valley utility expansion opening",
    create: () => createGame({ scenarioId: 116, seed: 17 }),
  },
  {
    name: "Legacy First Light opening, 1882 SF and separate watershed",
    create: () => {
      const game = createGame({ scenarioId: LEGACY_CAMPAIGN_ID, seed: 611 });
      expect(game.campaign?.generationIndex).toBe(0);
      expect(game.date.year).toBe(1882);
      expect(game.location.watershedId).toBeDefined();
      expect(game.location.watershedId).not.toBe(game.location.id);
      return game;
    },
  },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

it("compares complete uncached catalog calculations in both orders", () => {
  const results = fixtures.map(({ name, create }) => {
    const game = create();
    const expected = fullBuildForecast(game);
    const calculate = (resourceOnly: boolean, snapshot: GameType) =>
      resourceOnly
        ? computeOutlook("build", snapshot)
        : fullBuildForecast(snapshot);
    // Both paths get independent snapshots and the complete three-year workload before timing.
    // Fresh top-level identity is essential: a WeakMap hit would measure no forecast at all.
    for (let warmup = 0; warmup < 3; warmup++) {
      for (const resourceOnly of [false, true])
        expect(
          calculate(resourceOnly, forecastWorkerSnapshot(game)),
        ).toStrictEqual(expected);
    }
    const pairs = Array.from({ length: 7 }, (_, pair) => {
      const samples: { full: number[]; resource: number[] } = {
        full: [],
        resource: [],
      };
      const first = pair % 2 === 1;
      // ABBA / BAAB cancels first-order timing drift within every pair, rather than giving
      // one implementation the earlier slot in a majority of the seven measurements.
      for (const resourceOnly of [first, !first, !first, first]) {
        const snapshot = forecastWorkerSnapshot(game);
        const started = performance.now();
        const result = calculate(resourceOnly, snapshot);
        const ms = performance.now() - started;
        samples[resourceOnly ? "resource" : "full"].push(ms);
        // Exact fields, optional-property presence and every array value are checked outside
        // the timing window for every sample; no rounding or sampled output hash is used.
        expect(result).toStrictEqual(expected);
      }
      const fullMs = (samples.full[0] + samples.full[1]) / 2;
      const resourceMs = (samples.resource[0] + samples.resource[1]) / 2;
      return { fullMs, resourceMs, reduction: 1 - resourceMs / fullMs };
    });
    return {
      name,
      rows: expected!.timeline.length,
      fullMs: median(pairs.map((pair) => pair.fullMs)),
      resourceMs: median(pairs.map((pair) => pair.resourceMs)),
      medianPairedReduction: median(pairs.map((pair) => pair.reduction)),
      pairs,
    };
  });
  const report = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    vmGlobals: ["Math", "Number", "Object", "Array", "JSON", "BigInt"],
    warmupsPerPath: 3,
    pairs: 7,
    calculationsPerPathPerPair: 2,
    results,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (process.env.BUILD_FORECAST_BENCH_RESULT)
    fs.writeFileSync(
      process.env.BUILD_FORECAST_BENCH_RESULT,
      JSON.stringify(report, null, 2) + "\n",
    );
});
