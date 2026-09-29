/** Explicit capacity experiment, excluded from ordinary Jest discovery. */
import { writeFileSync } from "fs";
import { TICKS_PER_YEAR, TICK_MINUTES } from "../Constants";
import {
  SCENARIO_INTERTIE_ACCESS,
  effectiveMarket,
} from "../data/IntertieAccess";
import { SCENARIOS } from "../data/Scenarios";
import {
  intertieBuildQuote,
  intertieContextForGame,
  intertieOfferLimits,
} from "../helpers/Transmission";
import { DifficultyType } from "../Types";
import { createGame } from "./Simulator";

jest.setTimeout(1200000);

it("reports the useful import and export headroom of every purchased tier", () => {
  const ids = process.env.INTERTIE_REPORT_IDS?.split(",").map(Number);
  const seeds = (process.env.INTERTIE_REPORT_SEEDS || "12345,1,7")
    .split(",")
    .map(Number);
  const difficulties = (
    process.env.INTERTIE_REPORT_DIFFICULTIES || "Intern,CEO"
  ).split(",") as DifficultyType[];
  const output = process.env.INTERTIE_REPORT_OUTPUT;
  if (!output) throw new Error("INTERTIE_REPORT_OUTPUT must name a JSON file");
  const rows: object[] = [];
  const noGain: string[] = [];
  const scenarioIds = [
    ...new Set(SCENARIO_INTERTIE_ACCESS.map((a) => a.scenarioId)),
  ].filter((id) => !ids || ids.includes(id));
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const low = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.05)];
  for (const scenarioId of scenarioIds) {
    const scenario = SCENARIOS.find(({ id }) => id === scenarioId)!;
    for (const difficulty of difficulties) {
      for (const requestedSeed of seeds) {
        const seed =
          scenarioId === 107 && requestedSeed === 12345
            ? 268107
            : requestedSeed;
        const game = createGame({ scenarioId, difficulty, seed });
        const context = intertieContextForGame(game);
        const ticks = game.timeline.filter(
          (tick) =>
            tick.minute >= game.date.minute &&
            tick.minute < game.date.minute + TICKS_PER_YEAR * TICK_MINUTES,
        );
        expect(ticks.length).toBeGreaterThan(0);
        const peakTicks = [...ticks]
          .sort((a, b) => b.demandW - a.demandW)
          .slice(0, Math.max(1, Math.round(ticks.length * 0.05)));
        for (const allocation of SCENARIO_INTERTIE_ACCESS.filter(
          (a) => a.scenarioId === scenarioId,
        )) {
          let previous: { imports: number; exports: number } | undefined;
          for (let tier = 1; tier <= 4; tier++) {
            const quote = intertieBuildQuote(
              allocation.corridorId,
              game.date.year,
              tier,
              context,
            );
            if (!quote) continue;
            const line = { corridorId: quote.id, capacityW: quote.capacityW };
            const limits = ticks.map((tick) =>
              intertieOfferLimits(line, context, tick.minute, tick),
            );
            const imports = limits.map((limit) => limit.importLimitW);
            const exports = limits.map((limit) => limit.exportLimitW);
            const average = { imports: mean(imports), exports: mean(exports) };
            const importGainMW = previous
              ? (average.imports - previous.imports) / 1e6
              : null;
            const exportGainMW = previous
              ? (average.exports - previous.exports) / 1e6
              : null;
            if (
              previous &&
              average.imports <= previous.imports + 1 &&
              average.exports <= previous.exports + 1
            )
              noGain.push(
                `${scenarioId}/${difficulty}/${seed}/${quote.id}/tier${tier}`,
              );
            const access = effectiveMarket(quote.id, context, quote.capacityW)!;
            rows.push({
              scenarioId,
              scenario: scenario.name,
              difficulty,
              seed,
              corridorId: quote.id,
              tier,
              capacityMW: quote.capacityW / 1e6,
              importAccessMW: access.availableSupplyW / 1e6,
              exportAccessMW: access.availableDemandW / 1e6,
              buildCost: quote.buildCost,
              yearsToBuild: quote.yearsToBuild,
              annualOperatingCost: quote.annualOperatingCost,
              samples: ticks.length,
              averageImportCapacityMW: average.imports / 1e6,
              low5PercentImportCapacityMW: low(imports) / 1e6,
              peakDemandImportCapacityMW:
                mean(
                  peakTicks.map(
                    (tick) =>
                      intertieOfferLimits(line, context, tick.minute, tick)
                        .importLimitW,
                  ),
                ) / 1e6,
              averageExportCapacityMW: average.exports / 1e6,
              importGainMW,
              exportGainMW,
            });
            previous = average;
          }
        }
        writeFileSync(output, JSON.stringify(rows, null, 2) + "\n");
        process.stdout.write(
          `${scenarioId} ${difficulty} ${seed}: capacity probes recorded\n`,
        );
      }
    }
  }
  expect(noGain).toEqual([]);
});
