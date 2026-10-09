import cloneDeep from "lodash.clonedeep";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { encodeReplay, decodeReplay, serializeReplay } from "../Replay";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, {
  buildTransmissionLine,
  reprioritizeTransmissionLine,
  tickState,
} from "./Game";

function twoInterties() {
  let state = createGame({ scenarioId: 100, seed: 61 });
  for (const corridorId of ["california-north", "california-south"]) {
    state = cloneDeep(
      gameReducer(state, buildTransmissionLine({ corridorId, financed: true })),
    );
  }
  expect(state.transmission!.lines).toHaveLength(2);
  return state;
}

describe("reprioritizeTransmissionLine", () => {
  it("moves building or paused lines without reordering generators and persists the choice", () => {
    const state = twoInterties();
    state.transmission!.lines[1].paused = true;
    tickState(state);
    const before = cloneDeep(state.transmission!.lines);
    const after = gameReducer(
      state,
      reprioritizeTransmissionLine({ spotInList: 0, delta: 1 }),
    );
    expect(after.transmission!.lines.map(({ id }) => id)).toEqual([
      before[1].id,
      before[0].id,
    ]);
    expect(after.transmission!.lines[0].paused).toBe(true);
    expect(after.facilities).toEqual(state.facilities);
    expect(after.replayLog!.at(-1)).toMatchObject({
      type: "reprioritizeTransmissionLine",
      payload: { spotInList: 0, delta: 1 },
    });
    expect(after.meaningfulDecisions.at(-1)).toMatchObject({
      kind: "trading",
      before: "0",
      after: "1",
    });
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(after))))!.game
        .transmission,
    ).toEqual(after.transmission);
  });

  it("reforecasts actual trade flows, prices and emissions using the new order", () => {
    const state = twoInterties();
    state.transmission!.lines.forEach((line) => {
      line.yearsToBuildLeft = 0;
    });
    state.facilities = [];
    state.timeline.forEach((tick) => {
      tick.demandW = 1e6;
    });
    // Trigger a forecast with both connections open and a shortage requiring imports.
    const first = gameReducer(
      state,
      reprioritizeTransmissionLine({ spotInList: 0, delta: 1 }),
    );
    const second = gameReducer(
      first,
      reprioritizeTransmissionLine({ spotInList: 0, delta: 1 }),
    );
    const firstTick = getTimeFromTimeline(first.date.minute, first.timeline)!;
    const secondTick = getTimeFromTimeline(
      second.date.minute,
      second.timeline,
    )!;
    expect(firstTick.importedW).toBeGreaterThan(0);
    expect(secondTick.importedW).toBeCloseTo(firstTick.importedW!);
    expect(secondTick.expensesImports).not.toBe(firstTick.expensesImports);
    expect(secondTick.importedKgco2e).not.toBe(firstTick.importedKgco2e);
    expect(
      Object.fromEntries(
        second.transmission!.lines.map(({ id, currentFlowW }) => [
          id,
          currentFlowW,
        ]),
      ),
    ).not.toEqual(
      Object.fromEntries(
        first.transmission!.lines.map(({ id, currentFlowW }) => [
          id,
          currentFlowW,
        ]),
      ),
    );
  });

  it.each([
    { spotInList: -1, delta: 1 },
    { spotInList: 2, delta: -1 },
    { spotInList: 0, delta: 2 },
    { spotInList: 0, delta: 0 },
    { spotInList: 0.5, delta: 1 },
    { spotInList: 0, delta: NaN },
    { spotInList: 0, delta: Infinity },
  ])("ignores an invalid or unchanged move: %j", (move) => {
    const state = twoInterties();
    expect(gameReducer(state, reprioritizeTransmissionLine(move))).toBe(state);
  });

  it("ignores moves without interties and during replay viewing", () => {
    const move = reprioritizeTransmissionLine({ spotInList: 0, delta: 1 });
    const empty = createGame({ scenarioId: 100 });
    expect(gameReducer(empty, move)).toBe(empty);
    const replay = {
      ...twoInterties(),
      replayPlayback: { actions: [], index: 0 },
    };
    expect(gameReducer(replay, move)).toBe(replay);
  });

  it("round trips and replays the order deterministically", () => {
    let state = twoInterties();
    tickState(state);
    state = cloneDeep(
      gameReducer(
        state,
        reprioritizeTransmissionLine({ spotInList: 0, delta: 1 }),
      ),
    );
    tickState(state);
    const replay = decodeReplay(encodeReplay(serializeReplay(state)!))!;
    expect(replay).not.toBeNull();
    const replayed = createGameFromReplay(replay);
    tickState(replayed);
    tickState(replayed);
    expect(replayed.transmission).toEqual(state.transmission);
    // Runtime forecast metadata is not part of a recorded or saved tick.
    expect(JSON.stringify(replayed.timeline)).toBe(
      JSON.stringify(state.timeline),
    );
    for (const payload of [
      null,
      {},
      { spotInList: -1, delta: 1 },
      { spotInList: 0, delta: 0.5 },
    ]) {
      expect(
        decodeReplay(
          encodeReplay({
            ...replay,
            actions: [
              { minute: 0, type: "reprioritizeTransmissionLine", payload },
            ],
          }),
        ),
      ).toBeNull();
    }
  });
});
