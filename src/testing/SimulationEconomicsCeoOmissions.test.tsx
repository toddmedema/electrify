import {
  describeCeoOmissions,
  ECONOMICS_SCENARIOS,
} from "./SimulationTestHelpers";

jest.setTimeout(120000);

// The economics matrix is split across SimulationEconomics*.test.tsx so that Jest, which runs
// files rather than tests in parallel, can spread its long simulations over every CI core.
describe("simulation economics on CEO", () => {
  // The other half of the omission matrix is in SimulationEconomicsCeo.test.tsx
  describeCeoOmissions(
    ECONOMICS_SCENARIOS.filter((_scenario, index) => index % 2 === 1).map(
      (scenario) => scenario.id,
    ),
  );
});
