import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  getNextTutorial,
  getScenario,
  SCENARIOS,
  TUTORIALS,
} from "./Scenarios";
import { AppStateType, ScenarioType } from "../Types";
import { render, screen } from "@testing-library/react";

describe("getScenario", () => {
  it("finds an authored scenario by id", () => {
    const authored = SCENARIOS[SCENARIOS.length - 1];
    expect(getScenario(authored.id)).toBe(authored);
  });

  it("returns the custom scenario for the custom id", () => {
    const custom = {
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: 1990,
    } as ScenarioType;
    expect(getScenario(CUSTOM_SCENARIO_ID, custom)).toBe(custom);
  });

  it("ignores the custom scenario when asked for an authored one", () => {
    const authored = SCENARIOS[0];
    expect(getScenario(authored.id, DEFAULT_CUSTOM_SCENARIO)).toBe(authored);
  });

  it("finds nothing for a custom game that has no config", () => {
    expect(getScenario(CUSTOM_SCENARIO_ID)).toBeUndefined();
  });

  it("finds nothing for an id that doesn't exist", () => {
    expect(getScenario(-1)).toBeUndefined();
  });

  // Every custom game reuses one id, so an authored scenario taking it would be resolved as
  // whatever the player last set up
  it("keeps the custom id out of the authored scenarios", () => {
    expect(
      SCENARIOS.some((s: ScenarioType) => s.id === CUSTOM_SCENARIO_ID),
    ).toBe(false);
  });
});

describe("getNextTutorial", () => {
  it("follows the authored order", () => {
    expect(getNextTutorial(TUTORIALS[0].id)).toBe(TUTORIALS[1]);
  });

  it("finds nothing after the last tutorial", () => {
    expect(getNextTutorial(TUTORIALS[TUTORIALS.length - 1].id)).toBeUndefined();
  });

  // Which is what both callers rely on to decide whether to offer one at all
  it("finds nothing for a scenario that isn't a tutorial", () => {
    const scenario = SCENARIOS.find((s: ScenarioType) => !s.tutorialSteps);
    expect(getNextTutorial((scenario as ScenarioType).id)).toBeUndefined();
    expect(getNextTutorial(CUSTOM_SCENARIO_ID)).toBeUndefined();
  });
});

describe("tutorial mission metadata", () => {
  it("gives every tutorial a mission name, icon, and summary", () => {
    TUTORIALS.forEach((tutorial, index) => {
      expect(tutorial.name).toMatch(new RegExp(`^Mission ${index + 1}: `));
      expect(tutorial.icon).toBeTruthy();
      expect(tutorial.summary).toBeTruthy();
    });
  });

  it("expands the O&M abbreviation in the generator tutorial", () => {
    const generatorsMission = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 2: Generators",
    )!;
    render(generatorsMission.tutorialSteps![1].content);

    expect(screen.getByText(/Compare cost and build time/)).toHaveTextContent(
      "operations and maintenance (O&M)",
    );
  });

  it("advances the finances tutorial when the mobile Insights tab opens", () => {
    const finances = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 4: Finances",
    )!;
    const firstStep = finances.tutorialSteps![0];

    expect(
      firstStep.advanceOn?.({ card: { name: "INSIGHTS" } } as AppStateType),
    ).toBe(true);
    expect(
      firstStep.advanceOn?.({ card: { name: "FACILITIES" } } as AppStateType),
    ).toBe(false);
  });

  it("gives every mission one deterministic unguided capstone", () => {
    TUTORIALS.forEach((tutorial) => {
      expect(tutorial.seed).toEqual(expect.any(Number));
      const capstones = tutorial.tutorialSteps!.filter((step) => step.capstone);
      expect(capstones).toHaveLength(1);
      expect(capstones[0].target).toBeUndefined();
      expect(capstones[0].hint).toBeTruthy();
    });
  });

  it("ends the electricity mission after a single one-day challenge", () => {
    const electricity = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 1: Electricity",
    )!;
    const steps = electricity.tutorialSteps!;

    expect(steps).toHaveLength(5);
    expect(steps[3].advanceOn).toBeDefined();
    expect(steps[4].advanceOn).toBeUndefined();
    expect(steps[4].capstone).toBeDefined();
  });
});

describe("authored scenario briefings", () => {
  it("gives every scored scenario a reusable story and stakes", () => {
    SCENARIOS.filter((scenario) => !scenario.tutorialSteps).forEach(
      (scenario) => {
        expect(scenario.briefing).toEqual(
          expect.objectContaining({
            tone: expect.any(String),
            fantasy: expect.any(String),
            objective: expect.any(String),
            threat: expect.any(String),
          }),
        );
        expect(scenario.briefing).not.toHaveProperty("constraint");
      },
    );
  });

  it("gives every challenge at least one player-facing browse theme", () => {
    SCENARIOS.filter((scenario) => !scenario.tutorialSteps).forEach(
      (scenario) => expect(scenario.themes?.length).toBeGreaterThan(0),
    );
  });

  it("uses the three player-facing challenge themes", () => {
    const themes = new Set(
      SCENARIOS.filter((scenario) => !scenario.tutorialSteps).flatMap(
        (scenario) => scenario.themes ?? [],
      ),
    );
    expect(themes).toEqual(
      new Set(["Extreme weather", "Energy transition", "Rapid growth"]),
    );
  });
});

describe("authored starting fleets", () => {
  it("starts every facility with time in service", () => {
    SCENARIOS.filter((scenario) => scenario.id < 106).forEach((scenario) => {
      scenario.facilities.forEach((facility) => {
        expect(facility.initialAgeYears).toBeGreaterThan(0);
      });

      scenario.tutorialSteps?.forEach((step) => {
        step.capstone?.checkpoint?.facilities?.forEach((facility) => {
          expect(facility.initialAgeYears).toBeGreaterThan(0);
        });
      });
    });
  });

  it("keeps researched municipal and Austin-scale portfolio anchors exact", () => {
    const manassas = getScenario(106)!;
    const austin = getScenario(107)!;

    expect(manassas).toMatchObject({
      startingYear: 2020,
      durationMonths: 192,
      startingCustomers: 16_500,
      ownership: "Public",
      dollarsPerkWh: 0.1,
      minimumCustomerRetention: 0.9,
    });
    expect(manassas.location).toMatchObject({
      id: "Manassas",
      admin: "VA",
      timeZone: "America/New_York",
    });
    expect(manassas.loadAdditions).toEqual([
      expect.objectContaining({
        startsYear: 2026,
        peakW: 100_000_000,
        loadFactor: 0.9,
        demandType: "Data centers",
      }),
    ]);
    expect(manassas.facilities).toEqual([
      expect.objectContaining({
        fuel: "Natural Gas",
        peakW: 75_000_000,
      }),
      expect.objectContaining({ fuel: "Oil", peakW: 55_000_000 }),
    ]);

    expect(austin).toMatchObject({
      startingYear: 2017,
      durationMonths: 84,
      startingCustomers: 472_701,
      ownership: "Public",
      dollarsPerkWh: 0.09,
      reliabilityObjective: {
        year: 2021,
        month: 2,
        minimumDemandServed: 1,
        label: "February 2021 freeze",
      },
    });
    expect(austin.location).toMatchObject({
      id: "Austin",
      admin: "TX",
      timeZone: "America/Chicago",
    });
    expect(austin.briefing?.objective).toMatch(/strengthen.*freeze/i);
    expect(austin.briefing?.objective).not.toMatch(/build/i);
    expect(
      [
        austin.summary,
        austin.briefing?.fantasy,
        austin.briefing?.objective,
        austin.briefing?.threat,
      ].join(" "),
    ).not.toMatch(/ERCOT|PPA|portfolio/i);
    expect(
      austin.facilities.reduce(
        (total, facility) => total + (facility.peakW || 0),
        0,
      ),
    ).toBe(3_827_000_000);
    expect(
      austin.facilities.map((facility) => ({
        fuel: facility.fuel,
        peakW: facility.peakW,
      })),
    ).toEqual([
      { fuel: "Natural Gas", peakW: 1_497_000_000 },
      { fuel: "Coal", peakW: 700_000_000 },
      { fuel: "Uranium", peakW: 430_000_000 },
      { fuel: "Wind", peakW: 1_200_000_000 },
    ]);
  });

  it("keeps every scored-scenario generator at least 5% of its starting fleet", () => {
    SCENARIOS.filter((scenario) => !scenario.tutorialSteps).forEach(
      (scenario) => {
        const generators = scenario.facilities.filter(
          (facility) => facility.peakW !== undefined,
        );
        const totalPeakW = generators.reduce(
          (total, facility) => total + facility.peakW!,
          0,
        );

        generators.forEach((facility) => {
          expect({
            scenario: scenario.name,
            fuel: facility.fuel,
            meetsMinimum: facility.peakW! / totalPeakW >= 0.05,
          }).toEqual(expect.objectContaining({ meetsMinimum: true }));
        });
      },
    );
  });

  it("puts each scored scenario's defining facility first", () => {
    expect(
      SCENARIOS.filter((scenario) => !scenario.tutorialSteps).map(
        (scenario) => [
          scenario.name,
          scenario.facilities[0].fuel || scenario.facilities[0].name,
        ],
      ),
    ).toEqual([
      ["Carbon Fee", "Natural Gas"],
      ["The Shale Boom", "Coal"],
      ["Paradise", "Sun"],
      ["Rise of Renewables", "Uranium"],
      ["Hurricane Season", "Oil"],
      ["The End of an Era", "Coal"],
      ["Data Center Boom", "Natural Gas"],
      ["Deep Freeze", "Natural Gas"],
      ["Heatwave + Drought", "Hydro"],
      ["Solar Eclipse", "Sun"],
      ["Sudden Nuclear Shutdown", "Uranium"],
    ]);
  });

  it("authors three distinct generation and storage resilience challenges", () => {
    const heatwave = getScenario(108)!;
    const eclipse = getScenario(109)!;
    const trip = getScenario(110)!;

    expect(heatwave.reliabilityObjective).toMatchObject({
      year: 2026,
      month: 6,
      durationMonths: 3,
      minimumDemandServed: 1,
    });
    expect(heatwave).toMatchObject({
      name: "Heatwave + Drought",
      locationId: "Madrid",
      startingDemandScale: 0.73,
    });
    expect(heatwave.icon).toBe("heatwave-drought");
    expect(
      heatwave.facilities.map((facility) => facility.fuel || facility.name),
    ).toEqual(
      expect.arrayContaining(["Uranium", "Hydro", "Sun", "Wind", "Battery"]),
    );
    expect(eclipse).toMatchObject({
      name: "Solar Eclipse",
      locationId: "Beijing",
      startingYear: 2033,
      durationMonths: 33,
      startingDemandScale: 1.11,
      icon: "solar-eclipse",
      reliabilityObjective: { year: 2035, month: 9 },
    });
    expect(
      eclipse.facilities.find((facility) => facility.name === "Battery")
        ?.peakWh,
    ).toBe(240_000_000);
    expect(
      eclipse.facilities.find((facility) => facility.fuel === "Coal")?.peakW,
    ).toBe(685_830_000);
    expect(
      eclipse.facilities.some((facility) => facility.fuel === "Uranium"),
    ).toBe(false);
    expect(trip.reliabilityObjective).toMatchObject({
      year: 2026,
      month: 7,
      durationMonths: 18,
    });
    expect(trip).toMatchObject({
      name: "Sudden Nuclear Shutdown",
      icon: "sudden-nuclear-trip",
    });
    expect(
      trip.facilities.find(
        (facility) => facility.label === "Grand Nuclear Unit",
      ),
    ).toMatchObject({ fuel: "Uranium", peakW: 500_000_000 });
  });

  it("keeps locations in scenario metadata rather than scenario names", () => {
    expect(
      [107, 108, 109, 110].map((id) => ({
        name: getScenario(id)!.name,
        location: getScenario(id)!.location?.name,
      })),
    ).toEqual([
      { name: "Deep Freeze", location: "Austin, TX" },
      { name: "Heatwave + Drought", location: "Madrid, Spain" },
      { name: "Solar Eclipse", location: "Beijing, China" },
      { name: "Sudden Nuclear Shutdown", location: "Paris, France" },
    ]);
  });

  it("makes every plant in the aging coal fleet at least 20 years old", () => {
    const endOfEra = SCENARIOS.find(
      (scenario) => scenario.name === "The End of an Era",
    )!;

    endOfEra.facilities.forEach((facility) => {
      expect(facility.initialAgeYears).toBeGreaterThanOrEqual(20);
    });
  });
});
