import { decodeSave, encodeSave } from "./SaveEncoding";
import { parseSave, serializeSave } from "./SaveGame";
import { serializeCommitmentMetadata } from "./helpers/Commitment";
import { tickState } from "./reducers/Game";
import { createGame } from "./testing/Simulator";
import { runMonths } from "./testing/SimulationTestHelpers";
import { GameType } from "./Types";

jest.setTimeout(60000);

let game: GameType;
beforeAll(() => {
  game = createGame({ scenarioId: 101, seed: 31337 });
  runMonths(game, 24);
  tickState(game);
});

it("preserves every JSON value and the commitment forecast without mutating live state", () => {
  const save = serializeSave(game);
  const before = JSON.stringify(save);
  const encoded = encodeSave(save);
  expect(decodeSave(JSON.parse(JSON.stringify(encoded)))).toEqual(
    JSON.parse(before),
  );
  const restored = parseSave(JSON.parse(JSON.stringify(encoded)))!;
  expect(restored).not.toBeNull();
  expect(serializeCommitmentMetadata(restored.game.timeline)).toEqual(
    save.commitmentForecast,
  );
  expect(JSON.stringify(save)).toBe(before);
});

it("distinguishes null, absent fields, empty objects, and nested arrays", () => {
  const save = serializeSave(game);
  const sample = {
    ...save,
    commitmentForecast: [
      null,
      { dispatchTargets: {}, runningCostToNextDispatch: { "1": null } },
    ],
    game: {
      ...game,
      timeline: [
        {
          ...game.timeline[0],
          deferredResidential: [],
          windOffshoreKph: undefined,
        },
        {
          ...game.timeline[1],
          deferredResidential: [
            { recoveryStartMinute: 1, recoveryEndMinute: 2, energyWh: 3 },
          ],
        },
      ],
    },
  };
  expect(decodeSave(JSON.parse(JSON.stringify(encodeSave(sample))))).toEqual(
    JSON.parse(JSON.stringify(sample)),
  );
});

it("encodes compact records and validates an expanded save", () => {
  const wire = JSON.parse(JSON.stringify(encodeSave(serializeSave(game))));
  expect(Array.isArray(wire.game.timeline)).toBe(false);
  const restored = parseSave(wire);
  expect(restored?.game.timeline).toEqual(game.timeline);
  expect(restored?.game.monthlyHistory).toEqual(game.monthlyHistory);
});

it("keeps a twenty-year save below 55% of the unpacked JSON without dropping history", () => {
  const longRun = createGame({ scenarioId: 101, seed: 31337 });
  runMonths(longRun, 240);
  const save = serializeSave(longRun);
  const packed = JSON.stringify(encodeSave(save));
  expect(packed.length).toBeLessThan(JSON.stringify(save).length * 0.55);
  expect(parseSave(JSON.parse(packed))?.game.monthlyHistory).toEqual(
    longRun.monthlyHistory,
  );
});

it.each([
  null,
  { shapes: null, rows: [] },
  { shapes: [null], rows: [] },
  { shapes: [[1]], rows: [] },
  { shapes: [["cash", "cash"]], rows: [] },
  { shapes: [["__proto__"]], rows: [[0, {}]] },
  { shapes: [["constructor"]], rows: [[0, {}]] },
  { shapes: [["prototype"]], rows: [[0, {}]] },
  { shapes: [], rows: null },
  { shapes: [], rows: [[0]] },
  { shapes: [[]], rows: [[-1]] },
  { shapes: [[]], rows: [[0.5]] },
  { shapes: [[]], rows: [["0"]] },
  { shapes: [["cash"]], rows: [[0]] },
  { shapes: [[]], rows: [[0, 1]] },
  { shapes: [["cash"]], rows: [[0, NaN]] },
  { shapes: [["cash"]], rows: [[0, {}]] },
  { shapes: [["cash"]], rows: [[0, { items: null }]] },
  { shapes: [["cash"]], rows: [[0, { items: [], extra: true }]] },
])("rejects malformed packed records before domain validation: %p", (table) => {
  const raw = encodeSave(serializeSave(game));
  expect(
    parseSave({ ...raw, game: { ...raw.game, timeline: table } }),
  ).toBeNull();
});

it("rejects corrupt packed history and commitment metadata too", () => {
  const raw = encodeSave(serializeSave(game));
  const invalid = { shapes: [], rows: [[0]] };
  expect(
    parseSave({ ...raw, game: { ...raw.game, monthlyHistory: invalid } }),
  ).toBeNull();
  expect(parseSave({ ...raw, commitmentForecast: invalid })).toBeNull();
  const negative = encodeSave({
    ...serializeSave(game),
    commitmentForecast: serializeSave(game).commitmentForecast!.map(
      (entry, i) =>
        i === 0
          ? { dispatchTargets: { "1": -1 }, runningCostToNextDispatch: {} }
          : entry,
    ),
  });
  expect(parseSave(negative)).toBeNull();
});

it("bounds imported record nesting", () => {
  let nested: unknown = null;
  for (let depth = 0; depth < 40; depth++) nested = [0, nested];
  const raw = encodeSave(serializeSave(game));
  expect(
    parseSave({
      ...raw,
      game: { ...raw.game, timeline: { shapes: [["nested"]], rows: [nested] } },
    }),
  ).toBeNull();
});
