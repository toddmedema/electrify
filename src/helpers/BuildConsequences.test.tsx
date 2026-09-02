import { GeneratorShoppingType, StorageShoppingType } from "../Types";
import {
  buildConsequenceMessage,
  buildStartedMessage,
} from "./BuildConsequences";

const generator = {
  name: "Natural Gas",
  buildCost: 150000000,
  yearsToBuild: 1,
  peakW: 200000000,
  capacityFactor: 0.45,
} as GeneratorShoppingType;

it("connects the commitment to construction and expected supply", () => {
  expect(buildConsequenceMessage(generator, false)).toBe(
    "$150M committed → Natural Gas online in 12 mo → +90MW typical supply",
  );
  expect(buildConsequenceMessage(generator, true)).toContain(
    "$30M down payment",
  );
});

it("keeps construction event titles focused on what was started", () => {
  expect(buildStartedMessage(generator)).toBe(
    "Started construction on 200MW Natural Gas",
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
  };
  expect(buildStartedMessage(storage)).toBe(
    "Started construction on 4h 200MW Battery",
  );
});
