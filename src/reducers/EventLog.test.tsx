import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  buildFacility,
  logFuelCrossovers,
  sellFacility,
  tickState,
} from "./Game";
import { GENERATORS } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import {
  FacilityOperatingType,
  FuelNameType,
  GameEventType,
  GameType,
  GeneratorShoppingType,
} from "../Types";

/**
 * The event log: the run's own record of what happened to it.
 *
 * Everything in here was previously announced once - a toast, or a bar that pulsed while it was
 * true - and then forgotten, which is what these are about: not that the player was told, but
 * that they can still find out afterwards.
 */

// Redux Toolkit freezes reducer output in development, and tickState mutates state in place
function ticked(state: GameType, ticks: number): GameType {
  const next = cloneDeep(state);
  for (let i = 0; i < ticks; i++) {
    tickState(next);
  }
  return next;
}

function messages(state: GameType): string[] {
  return (state.eventLog || []).map((e: GameEventType) => e.message);
}

function kinds(state: GameType): string[] {
  return (state.eventLog || []).map((e: GameEventType) => e.kind);
}

// A fleet that has been switched off entirely, which is the shortest road to a blackout
function pauseEverything(state: GameType): GameType {
  const next = cloneDeep(state);
  next.facilities.forEach((f: FacilityOperatingType) => {
    f.paused = true;
  });
  return next;
}

describe("the event log", () => {
  it("starts empty, and stays empty while nothing happens", () => {
    const game = createGame({ scenarioId: 100 });
    expect(game.eventLog).toEqual([]);
    // Half a month of a company doing exactly what it was doing before
    expect(messages(ticked(game, 48))).toEqual([]);
  });

  it("records a blackout, and what it cost once the lights are back", () => {
    const dark = ticked(pauseEverything(createGame({ scenarioId: 100 })), 60);
    expect(kinds(dark)).toContain("BLACKOUT");

    // Switching the fleet back on ends it, and the entry that closes it carries the bill
    const recovered = cloneDeep(dark);
    recovered.facilities.forEach((f: FacilityOperatingType) => {
      f.paused = false;
    });
    const lit = ticked(recovered, 60);
    const over = (lit.eventLog || []).find(
      (e: GameEventType) => e.kind === "BLACKOUT_OVER",
    );
    expect(over).toBeDefined();
    expect(over?.message).toMatch(/unserved/);
    // Something was actually unserved, rather than the sentence being drawn around a zero
    expect(over?.message).not.toMatch(/\b0Wh\b/);
  });

  it("stamps each entry with the month it happened in, newest first", () => {
    const dark = ticked(pauseEverything(createGame({ scenarioId: 100 })), 200);
    const log = dark.eventLog || [];
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].label).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
    // Ids are handed out in order, so newest first means descending
    const ids = log.map((e: GameEventType) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("records building a facility, and selling it again", () => {
    const game = createGame({ scenarioId: 100 });
    const generator = GENERATORS(game, 500000000, [], []).find(
      (g: GeneratorShoppingType) => g.name === "Wind",
    );
    expect(generator).toBeDefined();

    const built = cloneDeep(
      gameReducer(
        game,
        buildFacility({ facility: generator!, financed: false }),
      ),
    );
    expect(kinds(built)[0]).toEqual("BUILD");
    expect(messages(built)[0]).toContain("Wind");

    // Still under construction, so this is a cancellation rather than a sale
    const underConstruction = built.facilities.find(
      (f: FacilityOperatingType) => f.yearsToBuildLeft > 0,
    );
    expect(underConstruction).toBeDefined();
    const cancelled = cloneDeep(
      gameReducer(built, sellFacility(underConstruction!.id)),
    );
    expect(messages(cancelled)[0]).toContain("Cancelled construction");

    const operating = built.facilities.find(
      (f: FacilityOperatingType) => f.yearsToBuildLeft === 0,
    );
    expect(operating).toBeDefined();
    const sold = cloneDeep(gameReducer(built, sellFacility(operating!.id)));
    expect(kinds(sold)[0]).toEqual("SELL");
    expect(messages(sold)[0]).toMatch(/^Sold /);
  });

  /**
   * A run can go on for a century, and every one of these is also carried in the save file --
   * so the log is a window on the recent past rather than a complete history.
   */
  it("keeps only the most recent hundred entries", () => {
    const dark = ticked(pauseEverything(createGame({ scenarioId: 100 })), 400);
    const log = dark.eventLog || [];
    expect(log.length).toBeLessThanOrEqual(100);
  });

  it("reports a fuel cost crossover only once for the fuel that became dearer", () => {
    const scenario = {
      id: 9991,
      name: "Crossover fixture",
      icon: "coal",
      locationId: "SF",
      ownership: "Investor" as const,
      startingYear: 2020,
      cash: 500000000,
      feePerKgCO2e: 0,
      dollarsPerkWh: 0.1,
      durationMonths: 24,
      facilities: [
        { fuel: "Coal" as const, peakW: 300000000 },
        { fuel: "Natural Gas" as const, peakW: 300000000 },
      ],
    };
    const game = createGame({ scenarioId: scenario.id, scenario, seed: 2468 });
    const costs = game.fuelCostSnapshot || {};
    const ordered: FuelNameType[] = ["Coal", "Natural Gas"];
    ordered.sort((a, b) => (costs[b] || 0) - (costs[a] || 0));
    const dearer = ordered[0];
    const cheaper = ordered[1];
    expect((costs[dearer] || 0) - (costs[cheaper] || 0)).toBeGreaterThan(1);

    // Reverse the prior ordering so today's deterministic prices form a real crossing edge.
    game.fuelCostSnapshot = { [dearer]: 1, [cheaper]: 1000 };
    game.speed = "FAST";
    logFuelCrossovers(game);
    expect(kinds(game)).toContain("FUEL_CROSSOVER");
    expect(messages(game)[0]).toContain(`${dearer} is now more expensive`);
    expect(game.eventLog?.[0].importance).toEqual("NOTABLE");
    expect(game.eventLog?.[0].actionTarget).toEqual("FACILITIES");
    expect(game.speed).toEqual("PAUSED");

    // Even after recreating the same edge, the persistent per-fuel key suppresses it.
    game.fuelCostSnapshot = { [dearer]: 1, [cheaper]: 1000 };
    logFuelCrossovers(game);
    expect(
      kinds(game).filter((kind) => kind === "FUEL_CROSSOVER"),
    ).toHaveLength(1);
  });
});
