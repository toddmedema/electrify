import cloneDeep from "lodash.clonedeep";
import {
  CHERNOBYL_RECOVERY_MONTHLY_COST,
  CHERNOBYL_SCENARIO,
  CHERNOBYL_SCENARIO_ID,
} from "../data/ChernobylScenario";
import { resolveStoryAtDate } from "../data/WorldEvents";
import { summarizeHistory } from "../helpers/DateTime";
import { facilityCashBack } from "../helpers/Financials";
import { currentTick } from "../helpers/GameSelectors";
import { scenarioRules } from "../helpers/ScenarioRules";
import {
  computeScoreBreakdown,
  startingDollarRevenue,
  totalScore,
} from "../helpers/Scoring";
import { buildStorySnapshot } from "../helpers/Story";
import gameReducer, { sellFacility, tickState } from "../reducers/Game";
import { parseSave } from "../SaveGame";
import { DifficultyType } from "../Types";
import { roundTrip } from "./SaveForgery";
import {
  expectNoViolations,
  runMonths,
  runSimulationOnce,
} from "./SimulationTestHelpers";
import { createGame, SimResultType } from "./Simulator";

const score = (result: SimResultType) =>
  totalScore(
    computeScoreBreakdown(
      result.scenario,
      summarizeHistory(result.months),
      startingDollarRevenue(
        result.months,
        result.scenario.startingYear,
        result.options.seed,
      ),
    ),
  );

const simulate = (difficulty: DifficultyType, seed: number) =>
  runSimulationOnce({ scenarioId: CHERNOBYL_SCENARIO_ID, difficulty, seed });

const reserveRun = (difficulty: DifficultyType, seed: number) =>
  runSimulationOnce({
    scenarioId: CHERNOBYL_SCENARIO_ID,
    difficulty,
    seed,
    scheduledActions: [
      {
        month: 1,
        type: "build",
        build: {
          name: "Oil",
          peakW: 500e6,
          financed: true,
          priority: "reserve",
        },
      },
    ],
  });

describe("Chernobyl recovery through the real reducer", () => {
  it("shuts all original units in April and restarts survivors in their historical months", () => {
    const game = createGame({ scenarioId: CHERNOBYL_SCENARIO_ID, seed: 17 });
    const checkpoints = [
      { elapsed: 0, year: 1986, month: 3, offline: [] },
      { elapsed: 1, year: 1986, month: 4, offline: [1, 2, 3, 4] },
      { elapsed: 7, year: 1986, month: 10, offline: [2, 3, 4] },
      { elapsed: 8, year: 1986, month: 11, offline: [3, 4] },
      { elapsed: 21, year: 1987, month: 12, offline: [4] },
    ];
    let previous = 0;
    const serviceRatios: number[] = [];
    for (const checkpoint of checkpoints) {
      runMonths(game, checkpoint.elapsed - previous);
      previous = checkpoint.elapsed;
      tickState(game);
      expect(game.date).toMatchObject({
        year: checkpoint.year,
        monthNumber: checkpoint.month,
      });
      const effects = resolveStoryAtDate({
        rules: scenarioRules(CHERNOBYL_SCENARIO, game),
        scenarioId: game.scenarioId,
        seed: game.seed,
        difficulty: game.difficulty,
        date: game.date,
        location: game.location,
        occurrences: game.worldEvents.occurrences,
        snapshot: buildStorySnapshot(
          game.monthlyHistory,
          game.facilities,
          game.date.minute,
        ),
      }).effects;
      for (let unit = 1; unit <= 4; unit++) {
        const facility = game.facilities.find(
          (candidate) => candidate.startingAssetId === `chernobyl-unit-${unit}`,
        )!;
        expect(effects.facilityOutputMultipliersById?.[facility.id] ?? 1).toBe(
          checkpoint.offline.includes(unit) ? 0 : 1,
        );
      }
      expect(
        checkpoint.offline.map(
          (unit) =>
            game.facilities.find(
              (facility) =>
                facility.startingAssetId === `chernobyl-unit-${unit}`,
            )!.currentW,
        ),
      ).toEqual(checkpoint.offline.map(() => 0));
      serviceRatios.push(
        currentTick(game)!.supplyW / currentTick(game)!.demandW,
      );
    }
    expect(serviceRatios[1]).toBeLessThan(0.5);
    expect(game.worldEvents.occurrences).toHaveLength(4);
  });

  it("retains the service obligation through severe shortages", () => {
    const result = simulate("CEO", 17);
    expectNoViolations(result);
    expect(result.months).toHaveLength(60);
    expect(result.months[0]).toMatchObject({ year: 1986, month: 3 });
    expect(result.months[59]).toMatchObject({ year: 1991, month: 2 });
    expect(
      result.months
        .slice(1, 7)
        .every((month) => month.supplyWh < month.demandWh * 0.5),
    ).toBe(true);
    expect(
      result.months.every(
        (month) => month.customers >= CHERNOBYL_SCENARIO.startingCustomers!,
      ),
    ).toBe(true);
    expect(result.outcome).toBe("completed");
  });

  for (const difficulty of ["Intern", "Manager", "CEO"] as const) {
    for (const seed of [1, 17]) {
      it(`trades rate relief against cash on ${difficulty}, seed ${seed}`, () => {
        const passive = simulate(difficulty, seed);
        const relief = runSimulationOnce({
          scenarioId: CHERNOBYL_SCENARIO_ID,
          difficulty,
          seed,
          dollarsPerkWh: 0.045,
        });
        [passive, relief].forEach(expectNoViolations);
        expect(passive.outcome).toBe("completed");
        expect(relief.outcome).toBe("completed");
        expect(relief.finalCash).toBeGreaterThan(0);
        expect(relief.finalCash).toBeLessThan(passive.finalCash);
        expect(score(relief)).toBeGreaterThan(score(passive));
      });

      it(`allows a reserve purchase to improve service at a cost on ${difficulty}, seed ${seed}`, () => {
        const passive = simulate(difficulty, seed);
        const reserve = reserveRun(difficulty, seed);
        expectNoViolations(reserve);
        expect(reserve.outcome).toBe("completed");
        expect(reserve.builds).toHaveLength(1);
        expect(reserve.finalCash).toBeLessThan(passive.finalCash);
        expect(summarizeHistory(reserve.months).supplyWh).toBeGreaterThan(
          summarizeHistory(passive.months).supplyWh,
        );
      });
    }
  }

  it.each(["Intern", "Manager"] as const)(
    "earns more recovery points with a reserve on %s",
    (difficulty) => {
      for (const seed of [1, 17]) {
        expect(score(reserveRun(difficulty, seed))).toBeGreaterThan(
          score(simulate(difficulty, seed)),
        );
      }
    },
  );

  it.each(["Intern", "CEO"] as const)(
    "still goes bankrupt with an unfunded rate cut on %s",
    (difficulty) => {
      const result = runSimulationOnce({
        scenarioId: CHERNOBYL_SCENARIO_ID,
        difficulty,
        seed: 17,
        dollarsPerkWh: 0.01,
      });
      expectNoViolations(result);
      expect(result.outcome).toBe("bankrupt");
      expect(result.firedAtMonth).toBeNull();
      expect(result.months.length).toBeLessThan(60);
    },
  );

  it("keeps Unit 4 and its cleanup obligation through sale attempts and saves", () => {
    const game = createGame({ scenarioId: CHERNOBYL_SCENARIO_ID, seed: 17 });
    const save = roundTrip(game);
    const restored = parseSave(save)!.game;
    const reactor = restored.facilities.find(
      (facility) => facility.startingAssetId === "chernobyl-unit-4",
    )!;
    expect(reactor.saleRestricted).toBe(true);
    expect(reactor.peakW).toBe(1e9);
    expect(reactor.maintenanceObligation).toEqual({
      startsMonth: 4,
      monthlyCost: CHERNOBYL_RECOVERY_MONTHLY_COST,
      reason: "Cleanup and recovery",
    });
    const attemptedSale = gameReducer(restored, sellFacility(reactor.id));
    expect(attemptedSale.facilities).toEqual(restored.facilities);
    expect(currentTick(attemptedSale)!.cash).toBe(currentTick(restored)!.cash);
    expect(facilityCashBack(reactor, restored.date.minute)).toBe(0);
    expect(
      facilityCashBack(
        restored.facilities.find((facility) => facility.fuel === "Coal")!,
        restored.date.minute,
      ),
    ).toBeGreaterThan(0);
    for (const multiplier of [undefined, -0.1, 0.5, 1, 1.1]) {
      const forged = cloneDeep(save);
      forged.game.facilities.find(
        (facility: { startingAssetId?: string }) =>
          facility.startingAssetId === "chernobyl-unit-4",
      ).cashBackMultiplier = multiplier;
      expect(parseSave(forged)).toBeNull();
    }
    for (const patch of [
      { saleRestricted: undefined },
      { saleRestricted: false },
      { maintenanceObligation: undefined },
      {
        maintenanceObligation: {
          ...reactor.maintenanceObligation!,
          monthlyCost: 0,
        },
      },
      {
        maintenanceObligation: {
          ...reactor.maintenanceObligation!,
          startsMonth: 5,
        },
      },
    ]) {
      const forged = cloneDeep(save);
      Object.assign(
        forged.game.facilities.find(
          (facility: { startingAssetId?: string }) =>
            facility.startingAssetId === "chernobyl-unit-4",
        ),
        patch,
      );
      expect(parseSave(forged)).toBeNull();
    }
    expect(parseSave(save)).not.toBeNull();
  });

  it("cannot reduce the recovery bill by pausing the destroyed reactor", () => {
    const difficulty = "CEO";
    const seed = 17;
    const reactorId = createGame({
      scenarioId: CHERNOBYL_SCENARIO_ID,
      seed,
    }).facilities.find(
      (facility) => facility.startingAssetId === "chernobyl-unit-4",
    )!.id;
    const paused = runSimulationOnce({
      scenarioId: CHERNOBYL_SCENARIO_ID,
      difficulty,
      seed,
      scheduledActions: [{ month: 1, type: "toggle", facilityId: reactorId }],
    });
    expectNoViolations(paused);
    expect(paused.outcome).toBe("completed");
    paused.months.slice(1).forEach((month) => {
      expect(month.expensesOM).toBeGreaterThanOrEqual(
        CHERNOBYL_RECOVERY_MONTHLY_COST,
      );
    });
    expect(
      Math.round(
        paused.finalFacilities.find(
          (facility) => facility.startingAssetId === "chernobyl-unit-4",
        )!.lifetimeExpenses,
      ),
    ).toBeGreaterThanOrEqual(14.75e9);
  });
});
