import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import { expectDraftParity } from "./SimulationDraftParity";

jest.setTimeout(600000);

describe("live and headless simulation parity", () => {
  it.each(Object.keys(STANDARD_BALANCE_PLAYS).map(Number))(
    "preserves scenario %i with the CEO build, policy, intertie and dispatch playbook",
    (scenarioId) => {
      expectDraftParity({
        scenarioId,
        difficulty: "CEO",
        ...STANDARD_BALANCE_PLAYS[scenarioId],
      });
    },
  );
});
