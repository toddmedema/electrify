import { GeneratorShoppingType } from "../Types";
import { buildConsequenceMessage } from "./BuildConsequences";

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
