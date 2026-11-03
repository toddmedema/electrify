import gameReducer, { reprioritizeFacility } from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import { facilityGroupMoves } from "./FacilitySelection";

it.each([
  [[2, 4], 1, 4, [1, 3, 5, 2, 4]],
  [[2, 4], 3, 0, [2, 4, 1, 3, 5]],
  [[2, 3], 1, 3, [1, 4, 2, 3, 5]],
  [[2, 4], 1, 1, [1, 2, 3, 4, 5]],
  [[1, 2, 3, 4, 5], 0, 4, [1, 2, 3, 4, 5]],
])(
  "moves %j from %i to %i through the reducer",
  (selection, source, destination, expected) => {
    let game = createGame({ scenarioId: 100 });
    game.facilities = Array.from({ length: 5 }, (_, index) => ({
      ...game.facilities[0],
      id: index + 1,
    }));
    for (const move of facilityGroupMoves(
      [1, 2, 3, 4, 5],
      selection,
      source,
      destination,
    )) {
      game = gameReducer(game, reprioritizeFacility(move));
    }
    expect(game.facilities.map((f) => f.id)).toEqual(expected);
  },
);

it.each([
  [[1, 5], 0, 2],
  [[1, 3, 5], 2, 3],
  [[2, 5], 4, 2],
])(
  "moves only selected facilities for a group straddling the drop boundary",
  (selected, source, destination) => {
    const ids = [1, 2, 3, 4, 5];
    const moves = facilityGroupMoves(ids, selected, source, destination);
    const working = [...ids];
    for (const { spotInList, delta } of moves) {
      expect(selected).toContain(working[spotInList]);
      working.splice(spotInList + delta, 0, working.splice(spotInList, 1)[0]);
    }
    expect(moves.length).toBeLessThanOrEqual(selected.length);
    const groupStart = working.indexOf(selected[0]);
    expect(working.slice(groupStart, groupStart + selected.length)).toEqual(
      selected,
    );
    expect(working.filter((id) => !selected.includes(id))).toEqual(
      ids.filter((id) => !selected.includes(id)),
    );
  },
);
