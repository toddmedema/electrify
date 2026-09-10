import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { DifficultyType, ScenarioType } from "../Types";
import { createGame, createGameFromReplay, runSimulation } from "./Simulator";
import { LOCATIONS } from "../Constants";
import { parseSave, serializeSave } from "../SaveGame";
import { serializeReplay } from "../Replay";
import { runMonths, expectNoViolations } from "./SimulationTestHelpers";

jest.setTimeout(120000);

describe("researched public-utility scenarios", () => {
  const manassas = SCENARIOS.find((scenario) => scenario.id === 106)!;

  it("calibrates Manassas against its authored weather", () => {
    const result = runSimulation({ scenarioId: 106, months: 12 });
    expect(result.months).toHaveLength(12);
    const firstYear = result.months.slice(-12);
    const annualDemandWh = firstYear.reduce(
      (total, month) => total + month.demandWh,
      0,
    );
    const peakDemandW = Math.max(
      ...firstYear.map((month) => month.peakDemandW),
    );

    expect(annualDemandWh).toBeGreaterThanOrEqual(394_000_000e3);
    expect(annualDemandWh).toBeLessThanOrEqual(455_000_000e3);
    expect(peakDemandW).toBeGreaterThanOrEqual(70_000_000);
    expect(peakDemandW).toBeLessThanOrEqual(80_000_000);
    const state = createGame({ scenarioId: 106 });
    expect(
      state.facilities.find((facility) => facility.fuel === "Natural Gas")
        ?.name,
    ).toBe("Natural Gas");
    expect(
      state.timeline.every((tick) => tick.demandByType["Data centers"] === 0),
    ).toBe(true);
    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(state))),
    )!.game;
    expect(restored.startingDemandScale).toBe(7.5);
    expect(restored.loadAdditions).toEqual(manassas.loadAdditions);
    const replayed = createGameFromReplay(serializeReplay(state)!);
    expect(replayed.startingDemandScale).toBe(7.5);
    expect(replayed.loadAdditions).toEqual(manassas.loadAdditions);
    expect(replayed.timeline).toEqual(state.timeline);
  });

  it("records only completed Manassas months across new game, save and replay", () => {
    const fresh = createGame({ scenarioId: 106 });
    expect(fresh.monthlyHistory).toEqual([]);
    runMonths(fresh, 1);
    expect(fresh.monthlyHistory).toHaveLength(1);
    expect(fresh.monthlyHistory[0]).toMatchObject({ year: 2020, month: 1 });

    const uninterrupted = createGame({ scenarioId: 106 });
    runMonths(uninterrupted, 73);
    const boundary = createGame({ scenarioId: 106 });
    runMonths(boundary, 71); // December 2025, immediately before the authored load arrives
    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(boundary))),
    )!.game;
    runMonths(restored, 2);
    expect(restored.monthlyHistory).toEqual(uninterrupted.monthlyHistory);

    const replayed = createGameFromReplay(serializeReplay(boundary)!);
    runMonths(replayed, 73);
    expect(replayed.monthlyHistory).toEqual(uninterrupted.monthlyHistory);

    const full = runSimulation({
      scenarioId: 106,
      initialBuild: {
        name: "Natural Gas",
        peakW: 50_000_000,
        financed: true,
      },
    });
    expect(full.months).toHaveLength(192);
    expect(full.months[0]).toMatchObject({ year: 2020, month: 1 });
    expect(full.months[191]).toMatchObject({ year: 2035, month: 12 });
    expect(
      new Set(full.months.map((month) => `${month.year}-${month.month}`)).size,
    ).toBe(192);
  });

  it("defaults demand calibration to one and applies it to the whole forecast", () => {
    const base: ScenarioType = {
      id: CUSTOM_SCENARIO_ID,
      name: "Demand calibration fixture",
      icon: "natural gas",
      locationId: "SF",
      location: LOCATIONS.SF,
      ownership: "Public",
      startingYear: 2019,
      startingCustomers: 10_000,
      cash: 1_000_000,
      dollarsPerkWh: 0.1,
      durationMonths: 1,
      feePerKgCO2e: 0,
      facilities: [],
    };
    const defaultScale = createGame({ scenarioId: base.id, scenario: base });
    const explicitOne = createGame({
      scenarioId: base.id,
      scenario: { ...base, startingDemandScale: 1 },
    });
    const doubled = createGame({
      scenarioId: base.id,
      scenario: { ...base, startingDemandScale: 2 },
    });

    expect(defaultScale.startingDemandScale).toBe(1);
    expect(defaultScale.timeline.map((tick) => tick.demandW)).toEqual(
      explicitOne.timeline.map((tick) => tick.demandW),
    );
    doubled.timeline.forEach((tick, index) => {
      expect(tick.demandW).toBeCloseTo(
        defaultScale.timeline[index].demandW * 2,
      );
    });
  });

  it("calibrates Austin's first full modeled year to FY2017 energy and peak", () => {
    const result = runSimulation({ scenarioId: 107, months: 12 });
    // The simulator records an opening forecast row before its first rollover; the trailing twelve
    // rows are the first complete January-December operating year.
    const firstYear = result.months.slice(-12);
    const annualDemandWh = firstYear.reduce(
      (total, month) => total + month.demandWh,
      0,
    );
    const peakDemandW = Math.max(
      ...firstYear.map((month) => month.peakDemandW),
    );
    expect(annualDemandWh).toBeGreaterThanOrEqual(13_010_291e6 * 0.9);
    expect(annualDemandWh).toBeLessThanOrEqual(13_010_291e6 * 1.1);
    expect(peakDemandW).toBeGreaterThanOrEqual(2_654_000_000 * 0.9);
    expect(peakDemandW).toBeLessThanOrEqual(2_654_000_000 * 1.1);
  });

  it("reproduces Uri once across forecast, save and replay, then expires every effect", () => {
    const event = createGame({ scenarioId: 107 });
    const control = createGame({
      scenarioId: 107,
      storyEffectsEnabled: false,
    });
    runMonths(event, 49);
    runMonths(control, 49);

    expect(event.date).toMatchObject({ year: 2021, monthNumber: 2 });
    expect(
      event.worldEvents.active.map((occurrence) => occurrence.key),
    ).toEqual(["story:107:texas-deep-freeze:uri"]);
    const minimumTemperatureC = Math.min(
      ...event.timeline.map((tick) => tick.temperatureC),
    );
    expect(minimumTemperatureC).toBeGreaterThanOrEqual(-16.5);
    expect(minimumTemperatureC).toBeLessThanOrEqual(-12.5);
    expect(
      Math.min(...event.timeline.map((tick) => tick.supplyW - tick.demandW)),
    ).toBeLessThan(100_000_000);

    event.timeline
      .map((tick, index) => ({
        actual: tick.supplyByFuel.Wind || 0,
        expected: control.timeline[index].supplyByFuel.Wind || 0,
      }))
      .filter(({ expected }) => expected > 0)
      .forEach(({ actual, expected }) => {
        expect(actual).toBeCloseTo(expected * 0.44, -2);
      });
    event.timeline.forEach((tick, index) => {
      expect(tick["Natural Gas"]).toBeCloseTo(
        control.timeline[index]["Natural Gas"]! * 2.8,
      );
    });

    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(event))),
    )!.game;
    expect(restored.startingDemandScale).toBe(event.startingDemandScale);
    expect(restored.loadAdditions).toEqual(event.loadAdditions);
    expect(restored.worldEvents).toEqual(event.worldEvents);

    const replay = serializeReplay(event)!;
    const replayed = createGameFromReplay(replay);
    runMonths(replayed, 49);
    expect(replayed.timeline).toEqual(event.timeline);
    expect(replayed.worldEvents).toEqual(event.worldEvents);

    runMonths(event, 1);
    runMonths(control, 1);
    expect(event.date).toMatchObject({ year: 2021, monthNumber: 3 });
    expect(
      event.worldEvents.active.map((occurrence) => occurrence.key),
    ).toEqual(["story:107:texas-deep-freeze:thaw"]);
    expect(
      event.worldEvents.occurrences.map((occurrence) => occurrence.key),
    ).toEqual([
      "story:107:texas-deep-freeze:uri",
      "story:107:texas-deep-freeze:thaw",
    ]);
    event.timeline.forEach((tick, index) => {
      // Different February dispatch changes cumulative emissions slightly; the 20°C event offset
      // itself is gone, leaving only that normal climate-forcing consequence.
      expect(
        Math.abs(tick.temperatureC - control.timeline[index].temperatureC),
      ).toBeLessThan(0.1);
      expect(tick["Natural Gas"]).toBe(control.timeline[index]["Natural Gas"]);
    });
  });

  const difficulties: DifficultyType[] = [
    "Intern",
    "Employee",
    "Manager",
    "VP",
    "CEO",
  ];
  it.each(difficulties)(
    "completes Data Center Boom on %s with capacity planned before the arrival",
    (difficulty) => {
      const result = runSimulation({
        scenarioId: 106,
        difficulty,
        initialBuild: {
          name: "Natural Gas",
          peakW: 50_000_000,
          financed: true,
        },
      });
      expectNoViolations(result);
      expect(result.outcome).toBe("completed");
    },
  );

  it.each(difficulties)(
    "rejects passive customer attrition as a Data Center Boom win on %s",
    (difficulty) => {
      const result = runSimulation({ scenarioId: 106, difficulty });
      expectNoViolations(result);
      expect(result.outcome).toBe("fired");
      expect(result.months[result.months.length - 1].customers).toBeLessThan(
        manassas.startingCustomers! * manassas.minimumCustomerRetention!,
      );
    },
  );

  it.each(difficulties)(
    "rejects an unattended Texas Deep Freeze run on %s",
    (difficulty) => {
      const result = runSimulation({ scenarioId: 107, difficulty });
      expectNoViolations(result);
      expect(result.outcome).toBe("fired");
      const uri = result.months.find(
        (month) => month.year === 2021 && month.month === 2,
      )!;
      expect(uri.supplyWh).toBeLessThan(uri.demandWh);
    },
  );

  it.each(difficulties)(
    "keeps Texas Deep Freeze winnable with planned firm capacity on %s",
    (difficulty) => {
      const result = runSimulation({
        scenarioId: 107,
        difficulty,
        initialBuild: {
          name: "Natural Gas",
          peakW: 1_100_000_000,
          financed: true,
        },
      });
      expectNoViolations(result);
      expect(result.outcome).toBe("completed");
      expect(result.actionCount).toBeGreaterThan(0);
    },
  );

  it("supports materially different Manager strategies for Data Center Boom", () => {
    const leanPlan = runSimulation({
      scenarioId: 106,
      difficulty: "Manager",
      initialBuild: {
        name: "Natural Gas",
        peakW: 40_000_000,
        financed: true,
      },
    });
    const reservePlan = runSimulation({
      scenarioId: 106,
      difficulty: "Manager",
      initialBuild: {
        name: "Natural Gas",
        peakW: 50_000_000,
        financed: true,
      },
    });
    expect(leanPlan.outcome).toBe("completed");
    expect(reservePlan.outcome).toBe("completed");
    expect(leanPlan.builds[0].buildCost).not.toBe(
      reservePlan.builds[0].buildCost,
    );
  });

  it("supports materially different Manager strategies for Texas Deep Freeze", () => {
    const gasPlan = runSimulation({
      scenarioId: 107,
      difficulty: "Manager",
      initialBuild: {
        name: "Natural Gas",
        peakW: 1_100_000_000,
        financed: true,
      },
    });
    const oilPlan = runSimulation({
      scenarioId: 107,
      difficulty: "Manager",
      initialBuild: { name: "Oil", peakW: 600_000_000, financed: true },
    });
    expect(gasPlan.outcome).toBe("completed");
    expect(oilPlan.outcome).toBe("completed");
    expect(gasPlan.builds[0].name).toBe("Natural Gas");
    expect(oilPlan.builds[0].name).toBe("Oil");
  });
});
