import {
  accessContextForGame,
  effectiveCorridor,
} from "../data/IntertieAccess";
import cloneDeep from "lodash.clonedeep";
import {
  DOWNPAYMENT_PERCENT,
  INTERTIE_UPGRADE_STEP,
  MAX_INTERTIE_UPGRADES,
  TICKS_PER_MONTH,
} from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import { serializeReplay, encodeReplay, decodeReplay } from "../Replay";
import gameReducer, {
  buildTransmissionLine,
  tickState,
  upgradeTransmissionLine,
} from "./Game";
import { GameType } from "../Types";
import {
  intertieTechnologyCeilingW,
  intertieUpgradeCount,
  intertieUpgradeQuote,
  intertieBuildQuote,
} from "../helpers/Transmission";
import { TRANSMISSION_CORRIDORS } from "../data/AdjacentMarkets";
import { parseSave, serializeSave } from "../SaveGame";

const CORRIDOR = "california-north";

/** A California run whose northern intertie is already open and carrying power. */
function openIntertie(financed = false): GameType {
  const game = createGame({ scenarioId: 100, seed: 61 });
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 100000000000;
  const state = cloneDeep(
    gameReducer(
      game,
      buildTransmissionLine({ corridorId: CORRIDOR, financed }),
    ),
  );
  state.transmission!.lines[0].yearsToBuildLeft = 0;
  return state;
}

function runMonths(state: GameType, months: number) {
  for (let i = 0; i < months * TICKS_PER_MONTH; i++) tickState(state);
}

function corridor() {
  return effectiveCorridor(CORRIDOR, { scenarioId: 100, locationId: "SF" })!;
}

describe("intertie upgrades", () => {
  it("keeps the line at its old rating until the work finishes", () => {
    const state = cloneDeep(
      gameReducer(
        openIntertie(),
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    const line = state.transmission!.lines[0];
    const original = corridor().capacityW;
    expect(line.capacityW).toBe(original);
    expect(line.upgrade!.targetCapacityW).toBe(
      Math.round(original * INTERTIE_UPGRADE_STEP),
    );

    // Crews restring one circuit at a time; the interconnector does not go dark for a year.
    runMonths(state, 1);
    expect(state.transmission!.lines[0].capacityW).toBe(original);

    runMonths(state, 24);
    const done = state.transmission!.lines[0];
    expect(done.upgrade).toBeUndefined();
    expect(done.capacityW).toBe(Math.round(original * INTERTIE_UPGRADE_STEP));
  });

  it("grows operating cost far slower than capacity", () => {
    const before = openIntertie().transmission!.lines[0];
    const state = cloneDeep(
      gameReducer(
        openIntertie(),
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    runMonths(state, 25);
    const after = state.transmission!.lines[0];
    const capacityRatio = after.capacityW / before.capacityW;
    const opexRatio = after.annualOperatingCost / before.annualOperatingCost;
    expect(capacityRatio).toBeCloseTo(INTERTIE_UPGRADE_STEP, 2);
    // Vegetation, patrols and inspections follow the route, not the load. Only the terminal
    // equipment really scales, which is what makes widening cheaper to run than building beside.
    expect(opexRatio).toBeGreaterThan(1);
    expect(opexRatio).toBeLessThan(1.2);
  });

  it("charges a down payment and books the work's own emissions", () => {
    const before = openIntertie();
    const cashBefore = getTimeFromTimeline(
      before.date.minute,
      before.timeline,
    )!.cash;
    const quote = intertieUpgradeQuote(
      before.transmission!.lines[0],
      before.date.year,
      1,
      1,
      accessContextForGame(before),
    )!;
    const state = cloneDeep(
      gameReducer(
        before,
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: true }),
      ),
    );
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(cashBefore - now.cash).toBeCloseTo(
      quote.buildCost * DOWNPAYMENT_PERCENT,
      2,
    );
    const line = state.transmission!.lines[0];
    expect(line.loanAmountLeft).toBeGreaterThan(0);
    expect(line.upgrade!.constructionKgco2eTotal).toBeGreaterThan(0);

    runMonths(state, 25);
    const done = state.transmission!.lines[0];
    // Widening emits for the watts it adds, not for the whole line over again.
    expect(done.constructionKgco2eEmitted || 0).toBeLessThan(
      done.constructionKgco2eTotal || 0,
    );
  });

  it("refuses to widen a line that is still being built", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 100000000000;
    const building = cloneDeep(
      gameReducer(
        game,
        buildTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    expect(building.transmission!.lines[0].yearsToBuildLeft).toBeGreaterThan(0);
    const after = gameReducer(
      building,
      upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
    );
    expect(after.transmission!.lines[0].upgrade).toBeUndefined();
  });

  it("refuses a second job while one is already running", () => {
    let state = cloneDeep(
      gameReducer(
        openIntertie(),
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    const target = state.transmission!.lines[0].upgrade!.targetCapacityW;
    state = cloneDeep(
      gameReducer(
        state,
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    expect(state.transmission!.lines[0].upgrade!.targetCapacityW).toBe(target);
  });

  it("stops after the corridor has been widened three times", () => {
    let state = openIntertie();
    for (let i = 0; i < MAX_INTERTIE_UPGRADES; i++) {
      expect(
        intertieUpgradeQuote(
          state.transmission!.lines[0],
          state.date.year,
          1,
          1,
          accessContextForGame(state),
        ),
      ).toBeDefined();
      state = cloneDeep(
        gameReducer(
          state,
          upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
        ),
      );
      expect(state.transmission!.lines[0].upgrade).toBeDefined();
      runMonths(state, 25);
    }
    const line = state.transmission!.lines[0];
    expect(intertieUpgradeCount(line, accessContextForGame(state))).toBe(
      MAX_INTERTIE_UPGRADES,
    );
    // The right of way and the substation land at either end are what run out, and no amount of
    // money buys past them: more capacity now needs a different route.
    expect(
      intertieUpgradeQuote(
        line,
        state.date.year,
        1,
        1,
        accessContextForGame(state),
      ),
    ).toBeUndefined();
    const refused = gameReducer(
      state,
      upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
    );
    expect(refused.transmission!.lines[0].upgrade).toBeUndefined();
  });

  it("will not exceed what the era knows how to build", () => {
    // One link, not one corridor: Itaipu is 3.15 GW per bipole even though its route moves twice
    // that. The ceiling is flat after 2019 because a bigger single infeed is more than most
    // grids can absorb losing at once, which is a system limit rather than a hardware one.
    expect(intertieTechnologyCeilingW(1950)).toBeLessThan(
      intertieTechnologyCeilingW(1970),
    );
    expect(intertieTechnologyCeilingW(1970)).toBeLessThan(
      intertieTechnologyCeilingW(2010),
    );
    expect(intertieTechnologyCeilingW(2019)).toBe(12e9);
    expect(intertieTechnologyCeilingW(2030)).toBe(12e9);

    const state = openIntertie();
    const line = state.transmission!.lines[0];
    expect(
      intertieUpgradeQuote({ ...line, capacityW: 8e9 }, 1960),
    ).toBeUndefined();
  });

  it("refuses when the player cannot cover the down payment", () => {
    const state = openIntertie();
    const quote = intertieUpgradeQuote(
      state.transmission!.lines[0],
      state.date.year,
      1,
      1,
      accessContextForGame(state),
    )!;
    getTimeFromTimeline(state.date.minute, state.timeline)!.cash =
      quote.buildCost * DOWNPAYMENT_PERCENT - 1;
    const after = gameReducer(
      state,
      upgradeTransmissionLine({ corridorId: CORRIDOR, financed: true }),
    );
    expect(after.transmission!.lines[0].upgrade).toBeUndefined();
  });

  it("replays an upgrade to the same capacity it reached live", () => {
    let state = createGame({ scenarioId: 112, seed: 249007 });
    const corridorId = state.transmission
      ? TRANSMISSION_CORRIDORS.find(({ id }) => id.startsWith("california"))!.id
      : CORRIDOR;
    state = cloneDeep(
      gameReducer(state, buildTransmissionLine({ corridorId, financed: true })),
    );
    runMonths(state, 14);
    state = cloneDeep(
      gameReducer(
        state,
        upgradeTransmissionLine({ corridorId, financed: true }),
      ),
    );
    runMonths(state, 14);

    const replay = serializeReplay(state)!;
    expect(
      replay.actions.some(({ type }) => type === "upgradeTransmissionLine"),
    ).toBe(true);
    const replayed = createGameFromReplay(replay);
    for (let i = 0; i < 28 * TICKS_PER_MONTH; i++) tickState(replayed);
    expect(replayed.transmission).toEqual(state.transmission);
    expect(replayed.monthlyHistory).toEqual(state.monthlyHistory);
  });

  it("survives a save round trip once widened", () => {
    let state = openIntertie();
    state = cloneDeep(
      gameReducer(
        state,
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    runMonths(state, 25);
    expect(state.transmission!.lines[0].capacityW).toBeGreaterThan(
      corridor().capacityW,
    );
    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(state))),
    );
    expect(restored).not.toBeNull();
    expect(restored!.game.transmission!.lines[0].capacityW).toBe(
      state.transmission!.lines[0].capacityW,
    );
  });

  it.each([false, true])(
    "round trips every upgrade stage (financed=%s)",
    (financed) => {
      let state = openIntertie(financed);
      for (let step = 0; step < MAX_INTERTIE_UPGRADES; step++) {
        state = cloneDeep(
          gameReducer(
            state,
            upgradeTransmissionLine({ corridorId: CORRIDOR, financed }),
          ),
        );
        expect(state.transmission!.lines[0].upgrade).toBeDefined();
        expect(
          parseSave(JSON.parse(JSON.stringify(serializeSave(state)))),
        ).not.toBeNull();
        runMonths(state, 12);
        expect(state.transmission!.lines[0].upgrade).toBeUndefined();
        expect(
          parseSave(JSON.parse(JSON.stringify(serializeSave(state)))),
        ).not.toBeNull();
      }
    },
  );

  it("rejects malformed pending upgrades and construction bookkeeping", () => {
    const state = cloneDeep(
      gameReducer(
        openIntertie(),
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    const good = JSON.parse(JSON.stringify(serializeSave(state)));
    expect(parseSave(good)).not.toBeNull();
    for (const patch of [
      { targetCapacityW: corridor().capacityW * INTERTIE_UPGRADE_STEP ** 2 },
      { annualOperatingCost: 0 },
      { buildCost: 0 },
      { yearsToBuild: 0, yearsToBuildLeft: 0 },
      { yearsToBuildLeft: 0 },
      { constructionKgco2eTotal: "bad" },
      { constructionKgco2eEmitted: -1 },
      { constructionKgco2eEmitted: 1e30 },
    ]) {
      const raw = cloneDeep(good);
      Object.assign(raw.game.transmission.lines[0].upgrade, patch);
      expect(parseSave(raw)).toBeNull();
    }
    for (const patch of [
      { buildCost: corridor().buildCost },
      { annualOperatingCost: 0 },
      { constructionKgco2eTotal: "bad" },
      { constructionKgco2eEmitted: -1 },
    ]) {
      const raw = cloneDeep(good);
      Object.assign(raw.game.transmission.lines[0], patch);
      expect(parseSave(raw)).toBeNull();
    }
  });

  it("rejects an imported line claiming a rating it could not have reached", () => {
    let state = openIntertie();
    state = cloneDeep(
      gameReducer(
        state,
        upgradeTransmissionLine({ corridorId: CORRIDOR, financed: false }),
      ),
    );
    runMonths(state, 25);
    const good = JSON.parse(JSON.stringify(serializeSave(state)));
    expect(parseSave(good)).not.toBeNull();

    // Every one of these is a save file a player could hand-edit, and each lands straight in
    // dispatch as free import capacity.
    const tamper = (mutate: (line: Record<string, number>) => void) => {
      const save = JSON.parse(JSON.stringify(serializeSave(state)));
      mutate(save.game.transmission.lines[0]);
      return parseSave(save);
    };
    // Not on the ladder at all.
    expect(tamper((line) => (line.capacityW *= 1.21))).toBeNull();
    // Past the three-step limit.
    expect(
      tamper(
        (line) =>
          (line.capacityW =
            corridor().capacityW *
            Math.pow(INTERTIE_UPGRADE_STEP, MAX_INTERTIE_UPGRADES + 1)),
      ),
    ).toBeNull();
    // Below the corridor's own authored rating.
    expect(
      tamper((line) => (line.capacityW = corridor().capacityW / 2)),
    ).toBeNull();
    // A widened line that somehow cost no more than the original.
    expect(
      tamper((line) => (line.buildCost = corridor().buildCost / 2)),
    ).toBeNull();
    // Flow beyond what the line is now rated for.
    expect(
      tamper((line) => (line.currentFlowW = line.capacityW * 2)),
    ).toBeNull();
  });
});

describe("building intertie tiers directly", () => {
  it.each([false, true])(
    "books the selected tier, total cost and emissions (financed: %s)",
    (financed) => {
      const before = createGame({ scenarioId: 100, seed: 61 });
      const cash = 100000000000;
      getTimeFromTimeline(before.date.minute, before.timeline)!.cash = cash;
      const quote = intertieBuildQuote(
        CORRIDOR,
        before.date.year,
        3,
        accessContextForGame(before),
      )!;
      const result = gameReducer(
        before,
        buildTransmissionLine({ corridorId: CORRIDOR, financed, tier: 3 }),
      );
      const line = result.transmission!.lines[0];
      expect(line.capacityW).toBe(
        Math.round(corridor().capacityW * INTERTIE_UPGRADE_STEP ** 2),
      );
      expect(line.buildCost).toBe(quote.buildCost);
      expect(line.yearsToBuildLeft).toBe(quote.yearsToBuild);
      expect(line.constructionKgco2eTotal).toBe(quote.constructionKgco2eTotal);
      expect(line.annualOperatingCost).toBe(quote.annualOperatingCost);
      expect(line.currentFlowW).toBe(0);
      expect(intertieUpgradeCount(line, accessContextForGame(result))).toBe(2);
      const paid = quote.buildCost * (financed ? DOWNPAYMENT_PERCENT : 1);
      expect(
        getTimeFromTimeline(result.date.minute, result.timeline)!.cash,
      ).toBeCloseTo(cash - paid);
      expect(line.loanAmountLeft).toBeCloseTo(
        financed ? quote.buildCost - paid : 0,
      );
    },
  );

  it.each([0, -1, 1.5, NaN, MAX_INTERTIE_UPGRADES + 2])(
    "rejects invalid tier %s without spending cash",
    (tier) => {
      const before = createGame({ scenarioId: 100, seed: 61 });
      expect(
        gameReducer(
          before,
          buildTransmissionLine({
            corridorId: CORRIDOR,
            financed: false,
            tier,
          }),
        ),
      ).toBe(before);
    },
  );

  it("rejects an unaffordable larger tier even when the base tier is affordable", () => {
    const before = createGame({ scenarioId: 100, seed: 61 });
    getTimeFromTimeline(before.date.minute, before.timeline)!.cash =
      corridor().buildCost;
    expect(
      gameReducer(
        before,
        buildTransmissionLine({
          corridorId: CORRIDOR,
          financed: false,
          tier: 2,
        }),
      ),
    ).toBe(before);
  });

  it("round trips a directly built tier through saves and deterministic replays", () => {
    const before = createGame({ scenarioId: 112, seed: 249007 });
    const state = cloneDeep(
      gameReducer(
        before,
        buildTransmissionLine({
          corridorId: CORRIDOR,
          financed: true,
          tier: 3,
        }),
      ),
    );
    expect(state.transmission!.lines).toHaveLength(1);
    const saved = parseSave(serializeSave(state));
    expect(saved?.game.transmission).toEqual(state.transmission);
    runMonths(state, 2);
    const replay = serializeReplay(state)!;
    expect(decodeReplay(encodeReplay(replay))).not.toBeNull();
    const replayed = createGameFromReplay(replay);
    runMonths(replayed, 2);
    expect(replayed.transmission).toEqual(state.transmission);
    expect(replayed.monthlyHistory).toEqual(state.monthlyHistory);
    const action = replay.actions.find(
      ({ type }) => type === "buildTransmissionLine",
    )!;
    action.payload = { corridorId: CORRIDOR, financed: true, tier: 99 };
    expect(decodeReplay(encodeReplay(replay))).toBeNull();
  });

  it("retains the existing physical capacity ceiling", () => {
    expect(
      intertieBuildQuote(CORRIDOR, 1900, 4, {
        scenarioId: 100,
        locationId: "SF",
      }),
    ).toBeUndefined();
  });
});
