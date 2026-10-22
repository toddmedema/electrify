import { GeneratorShoppingType, StorageShoppingType } from "../Types";
import {
  buildConsequenceMessage,
  buildStartedMessage,
} from "./BuildConsequences";

const generator = {
  name: "Natural Gas Peaker",
  buildCost: 150000000,
  yearsToBuild: 1,
  peakW: 200000000,
  capacityFactor: 0.45,
} as GeneratorShoppingType;

it("names the new plant and its construction time", () => {
  expect(buildConsequenceMessage({ ...generator, name: "Solar" })).toBe(
    "Construction started: new solar plant will be online in 12 months",
  );
});

it("keeps construction event titles focused on what was started", () => {
  expect(buildStartedMessage(generator)).toBe(
    "Started construction on 200MW Natural Gas Peaker",
  );
  const storage: StorageShoppingType = {
    name: "Battery",
    description: "Fast storage",
    available: true,
    buildCost: 100000000,
    annualOperatingCost: 1000000,
    peakW: 200000000,
    peakWh: 800000000,
    maxPeakWh: 1000000000,
    lifespanYears: 20,
    yearsToBuild: 1,
    roundTripEfficiency: 0.85,
    hourlyLoss: 0.001,
    spinMinutes: 1,
  };
  expect(buildStartedMessage(storage)).toBe(
    "Started construction on 4hr 200MW Battery",
  );
});
