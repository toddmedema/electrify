import { FUELS } from "../Constants";
import { STORAGE } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import { isStorage } from "../Types";
import type { GeneratorOperatingType, StorageOperatingType } from "../Types";
import { pooledPeerExportEmissions } from "./PeerExportEmissions";

const game = createGame({ scenarioId: 116, seed: 61 });
const template = game.facilities.find(
  (facility): facility is GeneratorOperatingType =>
    !isStorage(facility) && facility.fuel === "Natural Gas",
)!;
const gas = { ...template, currentW: 50, btuPerWh: 7, paused: false };
const wind: GeneratorOperatingType = {
  ...template,
  fuel: "Wind",
  currentW: 30,
  btuPerWh: 0,
  paused: false,
};
const gasIntensity = 7 * FUELS["Natural Gas"]!.kgCO2ePerBtu * 1e6;

it("weights actual native output and treats storage discharge as zero-emission supply", () => {
  const storage: StorageOperatingType = {
    ...template,
    ...STORAGE({ ...game, date: { ...game.date, year: 2025 } }, 100).find(
      (facility) => facility.name === "Battery",
    )!,
    currentW: 20,
    currentWh: 10,
  };
  const paused = { ...gas, currentW: 1000, paused: true };
  expect(
    pooledPeerExportEmissions(40, 40, 100, [gas, wind, storage, paused], []),
  ).toBeCloseTo(gasIntensity * 0.5);
});

it("uses only exported incremental headroom in dispatch order", () => {
  expect(
    pooledPeerExportEmissions(
      100,
      40,
      80,
      [gas, wind],
      [
        { generator: wind, watts: 20 },
        { generator: gas, watts: 1000 },
      ],
    ),
  ).toBeCloseTo(gasIntensity * 0.65);
});

it("handles incremental exports with no native supply", () => {
  expect(
    pooledPeerExportEmissions(20, 0, 0, [], [{ generator: gas, watts: 50 }]),
  ).toBe(gasIntensity);
});

it("reports no intensity without an export", () => {
  expect(pooledPeerExportEmissions(0, 0, 0, [], [])).toBe(0);
  expect(pooledPeerExportEmissions(0, 40, 80, [gas, wind], [])).toBe(0);
});
