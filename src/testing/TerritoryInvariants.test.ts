import cloneDeep from "lodash.clonedeep";
import reducer, { buildTransmissionLine, tickState } from "../reducers/Game";
import { acquireUtility } from "../reducers/GameActions";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { checkTick, InvariantCollector } from "./Invariants";
import { createGame } from "./Simulator";
import type { GameType, TickPresentFutureType } from "../Types";

let fixture: GameType;

beforeAll(() => {
  let game = createGame({ scenarioId: 116, seed: 12345 });
  currentTick(game)!.cash = 1e9;
  game = cloneDeep(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "vt-champlain-valley",
        financed: true,
      }),
    ),
  );
  game.transmission!.lines.find(
    (line) => line.corridorId === "vt-champlain-valley",
  )!.yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "valley-electric")!;
  fixture = cloneDeep(
    reducer(
      game,
      acquireUtility({
        targetId: "valley-electric",
        financed: true,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  tickState(fixture);
});

function inspect(
  mutate?: (game: GameType, tick: TickPresentFutureType) => void,
) {
  const game = cloneDeep(fixture);
  const tick = currentTick(game)!;
  mutate?.(game, tick);
  const collector = new InvariantCollector();
  checkTick(collector, game, null, tick, "territory fixture", false);
  return collector.getViolations();
}

it("accepts a real acquired territory's constrained dispatch", () => {
  expect(inspect()).toEqual([]);
});

it("detects energy invented in a territory even when company totals are untouched", () => {
  expect(
    inspect((_game, tick) => {
      tick.territories!["valley-electric"]!.generationW += 1e6;
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rule: "territory energy is conserved" }),
    ]),
  );
});

it("detects a balanced local load edit that disagrees with company totals", () => {
  expect(
    inspect((_game, tick) => {
      tick.territories!["valley-electric"]!.demandW += 1e6;
      tick.territories!["valley-electric"]!.unservedW += 1e6;
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "territory balances sum to company totals",
      }),
    ]),
  );
});

it("detects a line overload after its endpoint utility is acquired", () => {
  expect(
    inspect((game) => {
      game.transmission!.lines.find(
        (line) => line.corridorId === "vt-champlain-valley",
      )!.currentFlowW = 1e9;
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        rule: "internal transfers respect available wire capacity",
      }),
    ]),
  );
});
