import fs from "fs";
import path from "path";
import {
  AppStateType,
  isGatedStep,
  ScenarioType,
  TUTORIAL_UI_SELECTORS,
} from "../Types";
import { getScenarioLocation } from "../helpers/Locations";
import { intertiesEnabledForScenario } from "./AdjacentMarkets";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  getNextTutorial,
  getScenario,
  SCENARIOS,
  TUTORIALS,
} from "./Scenarios";
import { isPaneLayout } from "../Globals";

// Registered above the imports by babel's jest.mock hoisting, so the step predicates (which
// call isPaneLayout) see the mock. Kept after the imports for import/first.
jest.mock("../Globals", () => ({
  ...jest.requireActual("../Globals"),
  isPaneLayout: jest.fn(),
}));
const mockIsPaneLayout = isPaneLayout as jest.MockedFunction<
  typeof isPaneLayout
>;

describe("getScenario", () => {
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

  it("places Mission 7 after Forecasting and keeps its append-only id", () => {
    expect(getNextTutorial(5)?.id).toBe(112);
    expect(getNextTutorial(112)).toBeUndefined();
  });

  // Which is what both callers rely on to decide whether to offer one at all
  it("finds nothing for a scenario that isn't a tutorial", () => {
    const scenario = SCENARIOS.find((s: ScenarioType) => !s.tutorialSteps);
    expect(getNextTutorial((scenario as ScenarioType).id)).toBeUndefined();
    expect(getNextTutorial(CUSTOM_SCENARIO_ID)).toBeUndefined();
  });
});

describe("tutorial mission metadata", () => {
  afterEach(() => {
    mockIsPaneLayout.mockReset();
  });

  it("advances the finances tutorial when the mobile Insights tab opens", () => {
    // A phone: the switch itself is the deed, and the pane escape hatch does not apply
    mockIsPaneLayout.mockReturnValue(false);
    const finances = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 4: Finances",
    )!;
    const firstStep = finances.tutorialSteps![0];

    // Gated rather than explained: the Next button used to jump the player there instead
    expect(isGatedStep(firstStep)).toBe(true);
    expect(
      firstStep.advanceOn?.({ card: { name: "INSIGHTS" } } as AppStateType),
    ).toBe(true);
    expect(
      firstStep.advanceOn?.({ card: { name: "FACILITIES" } } as AppStateType),
    ).toBe(false);
  });

  it("advances the mission 5 opening the same way, keeping its rate escape hatch", () => {
    mockIsPaneLayout.mockReturnValue(false);
    const pricing = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 5: Pricing",
    )!;
    const firstStep = pricing.tutorialSteps![0];

    expect(isGatedStep(firstStep)).toBe(true);
    expect(
      firstStep.advanceOn?.({ card: { name: "INSIGHTS" } } as AppStateType),
    ).toBe(true);
    // Already did the next step's deed, so no tap is owed
    expect(
      firstStep.advanceOn?.({
        card: { name: "FACILITIES" },
        game: { dollarsPerkWh: 0.06 },
      } as unknown as AppStateType),
    ).toBe(true);
  });

  it("gives every mission deterministic unguided proof points", () => {
    TUTORIALS.forEach((tutorial) => {
      expect(tutorial.seed).toEqual(expect.any(Number));
      const capstones = tutorial.tutorialSteps!.filter((step) => step.capstone);
      expect(capstones).toHaveLength(tutorial.id === 112 ? 2 : 1);
      capstones.forEach((step) => {
        expect(step.target).toBeUndefined();
        expect(step.hint).toBeTruthy();
      });
    });
  });
  it("authors the Interties mission as a fixed two-plant California lesson", () => {
    const interties = getScenario(112)!;
    expect(interties).toMatchObject({
      name: "Mission 7: Interties",
      seed: 249007,
      startingYear: 2019,
      durationMonths: 24,
      intertiesEnabled: true,
    });
    expect(interties.facilities).toEqual([
      expect.objectContaining({ fuel: "Sun", peakW: 800000000 }),
      expect.objectContaining({ fuel: "Natural Gas", peakW: 500000000 }),
    ]);
    expect(interties.tutorialSteps).toHaveLength(19);
  });

  it("keeps interties out of earlier tutorials without disabling ordinary California games", () => {
    for (const tutorial of TUTORIALS.filter(({ id }) => id !== 112)) {
      expect(
        intertiesEnabledForScenario(tutorial, getScenarioLocation(tutorial)!),
      ).toBe(false);
    }
    const interties = getScenario(112)!;
    expect(
      intertiesEnabledForScenario(interties, getScenarioLocation(interties)!),
    ).toBe(true);
    const ordinaryCalifornia = getScenario(100)!;
    expect(
      intertiesEnabledForScenario(
        ordinaryCalifornia,
        getScenarioLocation(ordinaryCalifornia)!,
      ),
    ).toBe(true);
    const noCorridor = getScenario(103)!;
    const islanded = {
      ...getScenarioLocation(noCorridor)!,
      id: "HNL",
      name: "Honolulu, HI",
    };
    expect(
      intertiesEnabledForScenario(
        { ...noCorridor, intertiesEnabled: true },
        islanded,
      ),
    ).toBe(false);
  });
});

describe("tutorial step actions", () => {
  const allSteps = TUTORIALS.flatMap((tutorial) =>
    tutorial.tutorialSteps!.map((step, index) => ({
      step,
      label: `${tutorial.name} step ${index}`,
    })),
  );

  // Every objective opens on something to do, short enough to take in at a glance
  it("gives every step one short imperative action", () => {
    allSteps.forEach(({ step, label }) => {
      [step.action, step.desktop?.action]
        .filter((action) => action !== undefined)
        .forEach((action) => {
          expect({ label, action: action!.trim().length > 0 }).toEqual({
            label,
            action: true,
          });
          expect({ label, length: action!.length <= 60 }).toEqual({
            label,
            length: true,
          });
        });
    });
  });

  it("does not combine sequential player actions in a step", () => {
    allSteps.forEach(({ step }) => {
      [step.action, step.desktop?.action].filter(Boolean).forEach((action) => {
        expect(action).not.toMatch(
          /,? then | and (?:tap|click|choose|drag|run)/i,
        );
        expect(isGatedStep(step) && /\bNext\b/.test(action!)).toBe(false);
      });
    });
  });

  it("never points a step at chrome that step hides", () => {
    allSteps.forEach(({ step, label }) => {
      const targets = [step.target, step.desktop?.target].filter(Boolean);
      (step.hideUi || []).forEach((id) => {
        TUTORIAL_UI_SELECTORS[id].forEach((selector) => {
          targets.forEach((target) => {
            expect({
              label,
              target,
              hides: target!.includes(selector),
            }).toEqual({ label, target, hides: false });
          });
        });
      });
    });
  });

  it("opens the first mission without navigation, building or speed controls", () => {
    const [first] = TUTORIALS[0].tutorialSteps!;
    expect(first.hideUi).toEqual(
      expect.arrayContaining(["nav", "build", "speed", "menu", "sidePanes"]),
    );
    const capstone = TUTORIALS[0].tutorialSteps!.find((step) => step.capstone)!;
    expect(capstone.hideUi).not.toContain("speed");
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

  it("only labels starting facilities whose fleet icon still resolves", () => {
    // The fleet draws each plant's icon from its name, and a label replaces that name. Only
    // Uranium falls back to the Nuclear artwork, so any other label needs an image of its own.
    const images = path.resolve(__dirname, "../../public/images");
    const missing = SCENARIOS.flatMap((scenario) =>
      [
        ...scenario.facilities,
        ...(scenario.tutorialSteps || []).flatMap(
          (step) => step.capstone?.checkpoint?.facilities || [],
        ),
      ]
        .filter(({ fuel, label }) => label && fuel !== "Uranium")
        .map(({ label }) => `${label!.toLowerCase()}.svg`)
        .filter((icon) => !fs.existsSync(path.join(images, icon)))
        .map((icon) => `${scenario.name}: ${icon}`),
    );
    expect(missing).toEqual([]);
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

  it("authors distinct heatwave and generation-loss resilience challenges", () => {
    const heatwave = getScenario(108)!;
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

  it("authors a Los Angeles-only January 2025 wildfire challenge", () => {
    const wildfire = getScenario(111)!;

    expect(wildfire).toMatchObject({
      name: "Wildfire Emergency",
      icon: "wildfire emergency",
      locationId: "LA",
      startingYear: 2024,
      durationMonths: 36,
      startingCustomers: 16_000,
      reliabilityObjective: {
        year: 2025,
        month: 1,
        durationMonths: 2,
        minimumDemandServed: 1,
      },
    });
    expect(wildfire.briefing?.threat).toMatch(
      /safety shutoffs.*sales.*restoration costs/i,
    );
    expect(
      wildfire.facilities.reduce(
        (total, facility) => total + (facility.peakW || 0),
        0,
      ),
    ).toBe(80_810_000);
    expect(wildfire.facilities[0]).toEqual({
      fuel: "Natural Gas",
      peakW: 24_240_000,
      initialAgeYears: 18,
    });
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
