import { createNextState } from "@reduxjs/toolkit";
import * as Game from "../reducers/Game";
import { GameType } from "../Types";
import { runSimulation, SimOptionsType } from "./Simulator";

/** Drive the existing simulation, choices and builds through the browser's Immer tick path. */
export function expectDraftParity(options: SimOptionsType) {
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
