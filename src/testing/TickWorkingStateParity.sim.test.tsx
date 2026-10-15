import { SCENARIOS } from "../data/Scenarios";
import { expectDraftParity } from "./SimulationDraftParity";

jest.setTimeout(600000);

describe("live and headless simulation parity", () => {
  it.each(SCENARIOS)(
    "preserves $name through its baseline ending",
    (scenario) => {
      expectDraftParity({ scenarioId: scenario.id, scenario });
    },
  );
});
