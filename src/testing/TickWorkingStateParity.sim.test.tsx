import { createNextState } from "@reduxjs/toolkit";
import { SCENARIOS } from "../data/Scenarios";
import * as Game from "../reducers/Game";
import { GameType } from "../Types";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import { runSimulation, SimOptionsType } from "./Simulator";

jest.setTimeout(600000);

/** Drive the existing simulation, choices and builds through the browser's Immer tick path. */
function expectDraftParity(options: SimOptionsType) {
  const expected = runSimulation(options);
  const tickState = Game.tickState;
  const spy = jest.spyOn(Game, "tickState").mockImplementation((state) => {
    const next = createNextState(state, (draft: GameType) => {
      tickState(draft);
    });
    // The harness holds its mutable outer object between ticks. Its nested outputs are the
    // frozen reducer result, so each later draft must correctly isolate its mutation too.
    Object.keys(state).forEach((key) => {
      if (!(key in next)) Reflect.deleteProperty(state, key);
    });
    Object.assign(state, next);
  });
  try {
    const actual = runSimulation(options);
    expect(spy).toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(actual))).toEqual(
      JSON.parse(JSON.stringify(expected)),
    );
  } finally {
    spy.mockRestore();
  }
}

describe("live and headless simulation parity", () => {
  it.each(SCENARIOS)(
    "preserves $name through its baseline ending",
    (scenario) => {
      expectDraftParity({ scenarioId: scenario.id, scenario });
    },
  );

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
