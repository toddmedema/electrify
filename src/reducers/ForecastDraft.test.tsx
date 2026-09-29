import { createNextState, current } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES, TICKS_PER_MONTH } from "../Constants";
import { getDateFromMinute, getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import { GameType } from "../Types";
import { generateNewTimeline, tickState } from "./Game";

it.each([103, 108, 112])(
  "forecasts current draft edits without changing the live state in scenario %s",
  (scenarioId) => {
    const base = createGame({ scenarioId, seed: 12345 });
    const saved = cloneDeep(base);
    const edit = (state: GameType) => {
      state.date = getDateFromMinute(
        state.date.minute + TICK_MINUTES,
        state.startingYear,
      );
      state.dollarsPerkWh *= 1.1;
      state.location = { ...state.location, lat: state.location.lat + 1 };
      state.facilities[0].yearsToBuildLeft = 0.1;
    };
    const plain = cloneDeep(base);
    edit(plain);
    const now = getTimeFromTimeline(plain.date.minute, plain.timeline)!;
    const edited = cloneDeep(plain);
    const expected = generateNewTimeline(plain, now.cash, now.customers);
    expect(plain).toEqual(edited);
    createNextState(base, (draft) => {
      edit(draft);
      const actual = generateNewTimeline(draft, now.cash, now.customers);
      expect(actual).toEqual(expected);
      expect(current(draft)).toEqual(edited);
    });
    expect(base).toEqual(saved);
  },
);

it.each([103, 108])(
  "keeps batched Immer ticks identical to plain ticks across rollovers in scenario %s",
  (scenarioId) => {
    const plain = createGame({ scenarioId, seed: 12345 });
    let immutable = cloneDeep(plain);
    // More than one tick in a reducer matters: each forecast must see prior edits in that draft.
    for (let month = 0; month < 2; month++) {
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) tickState(plain);
      immutable = createNextState(immutable, (draft) => {
        for (let tick = 0; tick < TICKS_PER_MONTH; tick++) tickState(draft);
      });
      expect(immutable).toEqual(plain);
    }
    expect(immutable.monthlyHistory).toHaveLength(2);
  },
);
