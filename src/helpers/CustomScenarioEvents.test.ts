import { SCENARIOS } from "../data/Scenarios";
import { inEraMoney } from "../data/FuelPrices";
import { customEventContext } from "./CustomScenarioEvents";

test("transfers 2025 wildfire repair dollars to the receiving event year and scales grid size once", () => {
  const source = SCENARIOS.find((scenario) => scenario.id === 111)!;
  const imported = {
    ...source,
    id: 999,
    startingYear: 1980,
    startingCustomers: source.startingCustomers! * 2,
    eventScenarioIds: [111],
  };
  // January 2025 occurs three years after the source start, so this event occurs in 1983.
  expect(customEventContext(imported)![0].moneyScale).toBe(
    2 * inEraMoney(1, 1983, 2025),
  );
  expect(
    customEventContext({ ...imported, startingYear: source.startingYear })![0]
      .moneyScale,
  ).toBe(2);
});

test("other imported stories retain their starting-era monetary basis", () => {
  const source = SCENARIOS.find((scenario) => scenario.id === 107)!;
  const imported = {
    ...source,
    id: 999,
    startingYear: 1980,
    eventScenarioIds: [107],
  };
  expect(customEventContext(imported)![0].moneyScale).toBe(
    inEraMoney(1, 1980, source.startingYear),
  );
});
