import { TextEncoder } from "util";
import { modScenario } from "./Packages";
import manifest from "../data/RunCompatibility.json";
Object.assign(global, { TextEncoder });
const pack = {
  schemaVersion: 1 as const,
  id: "event-grid",
  title: "Event grid",
  creator: "Creator",
  version: "1",
  rules: manifest.compatibilityId,
  seed: 42,
  baseScenarioId: 999,
};
test("mod event selection carries its future demand into the chosen era without replacing author prices or duration", () => {
  const scenario = modScenario({
    ...pack,
    scenario: {
      startingYear: 2040,
      eventScenarioIds: [106],
      dollarsPerkWh: 0.3,
      durationMonths: 72,
    },
  });
  expect(scenario.loadAdditions).toEqual([
    expect.objectContaining({ label: "Data Centers", startsYear: 2046 }),
  ]);
  expect(scenario.dollarsPerkWh).toBe(0.3);
  expect(scenario.durationMonths).toBe(72);
});
test("base scenario existing industrial loads remain present when the era changes", () => {
  const scenario = modScenario({
    ...pack,
    baseScenarioId: 114,
    scenario: { startingYear: 2040 },
  });
  expect(scenario.reliabilityObjective).toEqual(
    expect.objectContaining({ year: 2044, month: 1 }),
  );
  expect(scenario.loadAdditions).toEqual([
    expect.objectContaining({
      label: "Copperbelt mines",
      startsYear: 2040,
      peakW: 65000000,
    }),
  ]);
});
