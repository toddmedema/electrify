import { registerInternSeedTests } from "./SimulationInternSeeds";

jest.setTimeout(120000);

describe("simulation economics", () => {
  registerInternSeedTests(107);
});
