import type {
  DifficultyType,
  StoryActionTargetType,
  StoryAttributeValueType,
} from "../Types";
import type { OfficialScenarioRuleDefinition } from "./OfficialScenarioRules";
import type { RuleObjective, RuleReport } from "./ScenarioRules";
import { buildLeadTimeHint } from "../helpers/BuildLeadTime";

// The national gas record already contains the shale price collapse (EIA MER Table 9.9: $8.87 in
// 2008 to $3.45 in 2012), so the boom's multiplier is not a second national drop. It is the local
// Marcellus glut: Appalachian hubs such as Dominion South traded 25-50% below Henry Hub through
// 2013-2016 as production outran pipeline capacity out of the region.
export interface ShaleBoomBalanceType {
  boomGasMultiplier: number;
  freezeSurcharge: number;
  freezeGasOutput: number;
}

export const SHALE_BOOM_BALANCE: Record<DifficultyType, ShaleBoomBalanceType> =
  {
    Intern: {
      boomGasMultiplier: 0.7,
      freezeSurcharge: 1.5,
      freezeGasOutput: 0.8,
    },
    Employee: {
      boomGasMultiplier: 0.725,
      freezeSurcharge: 1.65,
      freezeGasOutput: 0.75,
    },
    Manager: {
      boomGasMultiplier: 0.75,
      freezeSurcharge: 1.8,
      freezeGasOutput: 0.7,
    },
    VP: {
      boomGasMultiplier: 0.775,
      freezeSurcharge: 1.95,
      freezeGasOutput: 0.65,
    },
    CEO: {
      boomGasMultiplier: 0.8,
      freezeSurcharge: 2.1,
      freezeGasOutput: 0.6,
    },
  };

export const CARBON_FEE_BALANCE: Record<DifficultyType, number> = {
  Intern: 60,
  Employee: 90,
  Manager: 100,
  VP: 110,
  CEO: 120,
};

export interface ParadiseBalanceType {
  visitorDemand: number;
  oilShock: number;
}

export const PARADISE_BALANCE: Record<DifficultyType, ParadiseBalanceType> = {
  Intern: { visitorDemand: 1.04, oilShock: 1.3 },
  Employee: { visitorDemand: 1.05, oilShock: 1.375 },
  Manager: { visitorDemand: 1.06, oilShock: 1.45 },
  VP: { visitorDemand: 1.07, oilShock: 1.525 },
  CEO: { visitorDemand: 1.08, oilShock: 1.6 },
};

export interface RenewablesBalanceType {
  bridgeGasBuildCost: number;
  solarBuildCost: number;
  windBuildCost: number;
  demandLoad: number;
}

export const RENEWABLES_BALANCE: Record<DifficultyType, RenewablesBalanceType> =
  {
    Intern: {
      bridgeGasBuildCost: 0.3,
      solarBuildCost: 0.7,
      windBuildCost: 0.86,
      demandLoad: 1.05,
    },
    Employee: {
      bridgeGasBuildCost: 0.65,
      solarBuildCost: 0.725,
      windBuildCost: 0.88,
      demandLoad: 1.065,
    },
    Manager: {
      bridgeGasBuildCost: 1,
      solarBuildCost: 0.75,
      windBuildCost: 0.9,
      demandLoad: 1.08,
    },
    VP: {
      bridgeGasBuildCost: 1,
      solarBuildCost: 0.775,
      windBuildCost: 0.92,
      demandLoad: 1.095,
    },
    CEO: {
      bridgeGasBuildCost: 1,
      solarBuildCost: 0.8,
      windBuildCost: 0.94,
      demandLoad: 1.11,
    },
  };

export const TEXAS_DEEP_FREEZE_DEMAND: Record<DifficultyType, number> = {
  // The joint FERC/NERC report measured actual ERCOT peak load 20% above the normal-weather
  // forecast and estimated unconstrained demand 33% above it. Difficulty spans that observed
  // range while leaving the researched Austin portfolio and plant availability anchors intact.
  Intern: 1.2,
  Employee: 1.23,
  Manager: 1.27,
  VP: 1.3,
  CEO: 1.33,
};

export interface HeatwaveDroughtBalanceType {
  demandMultipliers: [number, number, number];
  hydroRunoffMultipliers: [number, number, number];
  hydroOutputMultipliers: [number, number, number];
  nuclearOutputMultipliers: [number, number, number];
}

export const HEATWAVE_DROUGHT_BALANCE: Record<
  DifficultyType,
  HeatwaveDroughtBalanceType
> = {
  Intern: {
    demandMultipliers: [1.06, 1.08, 1.1],
    hydroRunoffMultipliers: [0.7, 0.55, 0.4],
    hydroOutputMultipliers: [0.9, 0.8, 0.65],
    nuclearOutputMultipliers: [0.95, 0.85, 0.75],
  },
  Employee: {
    demandMultipliers: [1.07, 1.1, 1.13],
    hydroRunoffMultipliers: [0.65, 0.45, 0.3],
    hydroOutputMultipliers: [0.85, 0.72, 0.58],
    nuclearOutputMultipliers: [0.92, 0.8, 0.68],
  },
  Manager: {
    demandMultipliers: [1.08, 1.12, 1.16],
    hydroRunoffMultipliers: [0.6, 0.4, 0.22],
    hydroOutputMultipliers: [0.8, 0.65, 0.5],
    nuclearOutputMultipliers: [0.9, 0.75, 0.62],
  },
  VP: {
    demandMultipliers: [1.09, 1.14, 1.19],
    hydroRunoffMultipliers: [0.55, 0.33, 0.16],
    hydroOutputMultipliers: [0.75, 0.58, 0.43],
    nuclearOutputMultipliers: [0.87, 0.7, 0.56],
  },
  CEO: {
    demandMultipliers: [1.1, 1.16, 1.22],
    hydroRunoffMultipliers: [0.5, 0.25, 0.1],
    hydroOutputMultipliers: [0.7, 0.5, 0.35],
    nuclearOutputMultipliers: [0.85, 0.65, 0.5],
  },
};

export interface KaribaDroughtBalanceType {
  /** Inflow to the reservoir across the four steps of the drought. */
  hydroRunoffMultipliers: [number, number, number, number];
  /** What the remaining head can actually deliver as the lake falls. */
  hydroOutputMultipliers: [number, number, number, number];
}

// Kariba's usable storage fell from full in early 2014 to about 12% by the end of 2015 and under
// 5% in late 2016, taking Zambia's generation down with it. These steps are authored game-scale
// derates that trace that decline rather than a reconstruction of the lake's level record.
// https://www.zambezira.org/hydrology/lake-levels
export const KARIBA_DROUGHT_BALANCE: Record<
  DifficultyType,
  KaribaDroughtBalanceType
> = {
  Intern: {
    hydroRunoffMultipliers: [0.8, 0.6, 0.45, 0.6],
    hydroOutputMultipliers: [0.9, 0.75, 0.6, 0.75],
  },
  Employee: {
    hydroRunoffMultipliers: [0.7, 0.5, 0.33, 0.5],
    hydroOutputMultipliers: [0.85, 0.66, 0.5, 0.68],
  },
  Manager: {
    hydroRunoffMultipliers: [0.62, 0.4, 0.24, 0.45],
    hydroOutputMultipliers: [0.8, 0.58, 0.42, 0.62],
  },
  VP: {
    hydroRunoffMultipliers: [0.55, 0.32, 0.17, 0.4],
    hydroOutputMultipliers: [0.75, 0.5, 0.34, 0.56],
  },
  CEO: {
    hydroRunoffMultipliers: [0.48, 0.25, 0.1, 0.35],
    hydroOutputMultipliers: [0.7, 0.42, 0.26, 0.5],
  },
};

export interface DelhiSummerBalanceType {
  /** Peak-season demand across the summers of 2021 through 2024. */
  demandMultipliers: [number, number, number, number];
  /** Thermal output lost to intake and condenser temperatures in the same months. */
  thermalOutputMultipliers: [number, number, number, number];
  /** Degrees added to the record during each summer window. */
  temperatureOffsetC: [number, number, number, number];
}

// Delhi's peak demand rose from 7,695MW in 2022 to 8,656MW on 19 June 2024, its all-time record,
// after weeks above 45C. Thermal derating in extreme heat is an authored game-scale effect.
// https://cea.nic.in/general-review-report/
export const DELHI_SUMMER_BALANCE: Record<
  DifficultyType,
  DelhiSummerBalanceType
> = {
  Intern: {
    demandMultipliers: [1.01, 1.02, 1.04, 1.06],
    thermalOutputMultipliers: [0.99, 0.98, 0.96, 0.94],
    temperatureOffsetC: [0.2, 0.4, 0.6, 0.9],
  },
  Employee: {
    demandMultipliers: [1.02, 1.03, 1.05, 1.08],
    thermalOutputMultipliers: [0.98, 0.97, 0.95, 0.92],
    temperatureOffsetC: [0.3, 0.5, 0.8, 1.2],
  },
  Manager: {
    demandMultipliers: [1.03, 1.04, 1.07, 1.1],
    thermalOutputMultipliers: [0.97, 0.96, 0.93, 0.9],
    temperatureOffsetC: [0.4, 0.6, 1, 1.5],
  },
  VP: {
    demandMultipliers: [1.04, 1.05, 1.08, 1.12],
    thermalOutputMultipliers: [0.96, 0.95, 0.92, 0.88],
    temperatureOffsetC: [0.5, 0.7, 1.2, 1.8],
  },
  CEO: {
    demandMultipliers: [1.05, 1.06, 1.1, 1.14],
    thermalOutputMultipliers: [0.95, 0.94, 0.9, 0.86],
    temperatureOffsetC: [0.6, 0.8, 1.4, 2.1],
  },
};

const DIFFICULTIES: DifficultyType[] = [
  "Intern",
  "Employee",
  "Manager",
  "VP",
  "CEO",
];
const byDifficulty = <T>(
  value: (difficulty: DifficultyType) => T,
): Record<DifficultyType, T> =>
  Object.fromEntries(
    DIFFICULTIES.map((difficulty) => [difficulty, value(difficulty)]),
  ) as Record<DifficultyType, T>;
const values = (value: (difficulty: DifficultyType) => number) => ({
  byDifficulty: byDifficulty(value),
});
const facts = (
  value: (
    difficulty: DifficultyType,
  ) => Record<string, StoryAttributeValueType>,
) => byDifficulty(value);
const FUEL_PRICE_TARGET: StoryActionTargetType = {
  card: "INSIGHTS",
  layer: "FUEL_PRICES",
};
const FLEET_TARGET: StoryActionTargetType = {
  card: "FACILITIES",
  view: "FLEET",
};
const GENERATOR_TARGET: StoryActionTargetType = {
  card: "FACILITIES",
  view: "BUILD_GENERATORS",
};
const SUPPLY_DEMAND_TARGET: StoryActionTargetType = {
  card: "INSIGHTS",
  layer: "SUPPLY_DEMAND",
};
const source = (
  concept: NonNullable<
    OfficialScenarioRuleDefinition["presentation"][string]["source"]["concept"]
  >,
  importance: NonNullable<
    OfficialScenarioRuleDefinition["presentation"][string]["source"]["importance"]
  >,
  actionTarget: StoryActionTargetType,
  turningPointPriority?: number,
): OfficialScenarioRuleDefinition["presentation"][string]["source"] => ({
  kind: "WORLD_EVENT",
  concept,
  importance,
  actionTarget,
  ...(turningPointPriority === undefined ? {} : { turningPointPriority }),
});
const retention = (
  deadlineMonth: number,
  minRetainedShare = 0.8,
): RuleObjective => ({
  id: "retention",
  label: "Retain the community",
  metric: "customerRetention",
  deadlineMonth,
  minRetainedShare,
});
const reliability = (
  label: string,
  fromMonth: number,
  throughMonth: number,
  minDemandServedShare = 0.995,
): RuleObjective => ({
  id: "reliability",
  label,
  metric: "monthlyReliability",
  fromMonth,
  throughMonth,
  minDemandServedShare,
});
const reliabilityReport = (
  id: string,
  fromMonth: number,
  throughMonth: number,
): RuleReport => ({
  id,
  kind: "reliability",
  fromMonth,
  throughMonth,
  minDemandServedShare: 0.999,
});

/** Existing catalog setup and connection loads stay catalog-owned; choices use the common owner. */
export const DATA_CENTER_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 106,
  arcId: "data-center-boom",
  definitions: {
    objectives: [retention(192, 0.9)],
    debriefReports: [
      {
        id: "data-center-review",
        kind: "dataCenter",
        fromMonth: 73,
        throughMonth: 192,
      },
    ],
  },
  presentation: {},
};

/** February 2021 is authored month 50 from the unchanged January 2017 opening. */
export const DEEP_FREEZE_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 107,
  arcId: "texas-deep-freeze",
  reliabilityNoun: "February 2021 freeze",
  definitions: {
    events: [
      {
        id: "uri",
        title: "The deep freeze",
        message: "Cold strains power supplies across Texas.",
        startMonth: 50,
        durationMonths: 1,
        visibility: "forecast",
        preview: "Demand will rise as plant output falls and gas prices climb.",
        effects: {
          temperatureOffsetC: -20,
          demandMultiplier: { byDifficulty: TEXAS_DEEP_FREEZE_DEMAND },
          fuelPriceMultipliers: { "Natural Gas": 2.8 },
          outputMultipliersByFuel: {
            "Natural Gas": 0.62,
            Coal: 0.73,
            Uranium: 0.77,
            Wind: 0.44,
          },
        },
      },
      {
        id: "thaw",
        title: "The thaw",
        message:
          "The freeze ends next month. Plant output and gas prices return to normal.",
        startMonth: 51,
        visibility: "forecast",
        preview:
          "Normal plant output and gas prices will return as the cold eases.",
      },
    ],
    objectives: [reliability("Keep the lights on through the freeze", 50, 50)],
    debriefReports: [
      {
        id: "deep-freeze-review",
        label: "Winter Storm Uri",
        kind: "deepFreeze",
        fromMonth: 49,
        throughMonth: 51,
      },
    ],
  },
  presentation: {
    uri: {
      previewTitle: "Deep freeze straining supply",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Cold strains power supplies across Texas: demand is up ${Math.round((TEXAS_DEEP_FREEZE_DEMAND[difficulty] - 1) * 100)}%, plant output falls and gas prices spike.`,
      ),
      source: source("blackout", "CRITICAL", FLEET_TARGET, 110),
      protection: { kind: "deepFreezeWinterization" },
      nativeReview: "deepFreezeOnset",
    },
    thaw: {
      previewTitle: "Freeze ending",
      source: source("weather", "NOTABLE", { card: "INSIGHTS" }, 105),
      nativeReview: "deepFreezeThaw",
      reports: [reliabilityReport("arc-107-thaw-reliability", 50, 50)],
    },
  },
};

export const CARBON_FEE_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 100,
  arcId: "carbon-fee-ratchet",
  definitions: {
    events: [
      {
        id: "published-ratchet",
        title: "Higher carbon fee announced",
        message: "The carbon fee rises in January 2024.",
        startMonth: 13,
        visibility: "forecast",
      },
      {
        id: "ratchet-onset",
        title: "Higher carbon fee begins",
        message: "The carbon fee raises coal and gas running costs.",
        startMonth: 49,
        durationMonths: 96,
        visibility: "forecast",
        preview: "Coal and gas will cost more to run.",
        effects: {
          carbonFeeDollarsPerTonneCO2e: { byDifficulty: CARBON_FEE_BALANCE },
        },
      },
    ],
    objectives: [retention(144)],
  },
  presentation: {
    "published-ratchet": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `The carbon fee rises to $${CARBON_FEE_BALANCE[difficulty]} per ton in January 2024. Coal faces the biggest increase.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        feePerTon: CARBON_FEE_BALANCE[difficulty],
      })),
      source: source("goal", "NOTABLE", GENERATOR_TARGET),
    },
    "ratchet-onset": {
      previewTitle: "Carbon fee rising",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `The carbon fee is now $${CARBON_FEE_BALANCE[difficulty]} per ton, raising coal and gas running costs.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        feePerTon: CARBON_FEE_BALANCE[difficulty],
      })),
      source: source("goal", "NOTABLE", GENERATOR_TARGET, 90),
    },
  },
};

export const SHALE_BOOM_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 103,
  arcId: "shale-boom",
  definitions: {
    events: [
      {
        id: "regional-glut-warning",
        title: "Cheaper gas forecast",
        message:
          "Gas prices may fall in January 2010. Diversify: cheap gas may not last.",
        startMonth: 13,
        visibility: "forecast",
      },
      {
        id: "regional-glut",
        title: "Gas prices fall",
        message: "A regional shale glut lowers local gas prices.",
        startMonth: 49,
        durationMonths: 74,
        visibility: "forecast",
        preview: "A regional shale glut will lower local gas prices.",
        effects: {
          fuelPriceMultipliers: {
            "Natural Gas": values(
              (difficulty) => SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier,
            ),
          },
        },
      },
      {
        id: "freeze-warning",
        title: "Winter freeze warning",
        message:
          "A winter freeze may raise gas prices and cut gas-plant output.",
        startMonth: 96,
        visibility: "forecast",
      },
      {
        id: "freeze",
        title: "Winter freeze",
        message: "Gas prices spike and gas output falls.",
        startMonth: 97,
        durationMonths: 3,
        visibility: "forecast",
        preview: "Gas costs will spike and gas plants will produce less.",
        effects: {
          fuelPriceMultipliers: {
            "Natural Gas": values(
              (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeSurcharge,
            ),
          },
          outputMultipliersByFuel: {
            "Natural Gas": values(
              (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeGasOutput,
            ),
          },
        },
      },
      {
        id: "normalization",
        title: "Gas boom ends",
        message: "Gas prices return to normal.",
        startMonth: 123,
        visibility: "forecast",
        preview: "Natural gas prices will return to normal.",
      },
      {
        id: "freeze-recovery",
        title: "Winter freeze ends",
        message:
          "Gas output is fully restored, and lower boom-era prices return.",
        startMonth: 100,
        visibility: "forecast",
        preview:
          "Plant limits will lift and lower boom-era prices will return.",
      },
    ],
    objectives: [retention(240)],
  },
  presentation: {
    "regional-glut-warning": {
      hidePreview: true,
      source: source("fuel", "NOTABLE", FUEL_PRICE_TARGET),
    },
    "regional-glut": {
      previewTitle: "Gas prices falling",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `A regional shale glut puts local gas ${Math.round((1 - SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier) * 100)}% below the national price through Feb 2016.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        boomGasMultiplier: SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier,
      })),
      source: source("fuel", "NOTABLE", FUEL_PRICE_TARGET),
    },
    "freeze-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `A winter freeze may raise gas prices and cut gas-plant output to ${Math.round(SHALE_BOOM_BALANCE[difficulty].freezeGasOutput * 100)}%.`,
      ),
      source: source("danger", "NOTABLE", FUEL_PRICE_TARGET),
    },
    freeze: {
      previewTitle: "Winter freeze approaching",
      messageByDifficulty: byDifficulty((difficulty) => {
        const balance = SHALE_BOOM_BALANCE[difficulty],
          effective = balance.boomGasMultiplier * balance.freezeSurcharge;
        return `Gas prices are ${Math.round(Math.abs(effective - 1) * 100)}% ${effective >= 1 ? "above" : "below"} normal; gas output is down to ${Math.round(balance.freezeGasOutput * 100)}%.`;
      }),
      attributesByDifficulty: facts((difficulty) => ({
        freezeSurcharge: SHALE_BOOM_BALANCE[difficulty].freezeSurcharge,
        freezeGasOutput: SHALE_BOOM_BALANCE[difficulty].freezeGasOutput,
        effectiveGasPriceMultiplier:
          SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier *
          SHALE_BOOM_BALANCE[difficulty].freezeSurcharge,
      })),
      source: source("danger", "CRITICAL", FUEL_PRICE_TARGET),
    },
    normalization: {
      previewTitle: "Gas boom ending",
      nativeReview: "shaleNormalization",
      source: source("fuel", "ROUTINE", FUEL_PRICE_TARGET, 80),
      reports: [
        {
          id: "arc-103-normalization-fuel-mix",
          kind: "fuelMix",
          fromMonth: 111,
          throughMonth: 122,
          fuels: ["Natural Gas"],
          basis: "customerDemand",
        },
        reliabilityReport("arc-103-normalization-reliability", 111, 122),
      ],
    },
    "freeze-recovery": {
      previewTitle: "Gas output recovering",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Gas output is fully restored, and prices return to the ${Math.round((1 - SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier) * 100)}% reduction caused by the shale gas boom.`,
      ),
      source: source("supply", "ROUTINE", FUEL_PRICE_TARGET),
    },
  },
};

export const PARADISE_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 105,
  arcId: "island-energy",
  definitions: {
    events: [
      {
        id: "visitor-warning",
        title: "Visitor surge forecast",
        message: "Visitors expected to raise electricity use.",
        startMonth: 22,
        visibility: "forecast",
      },
      {
        id: "visitor-peak",
        title: "Visitor surge",
        message: "Visitor electricity use rises through October 2007.",
        startMonth: 29,
        durationMonths: 18,
        visibility: "forecast",
        preview: "More visitors will increase electricity use.",
        effects: {
          demandMultiplier: values(
            (difficulty) => PARADISE_BALANCE[difficulty].visitorDemand,
          ),
        },
      },
      {
        id: "cargo-warning",
        title: "Fuel delivery warning",
        message:
          "Oil prices may rise this fall. Prepare local generation or storage before September.",
        startMonth: 102,
        visibility: "forecast",
      },
      {
        id: "visitor-recovery",
        title: "Visitor surge ends",
        message: "Visitor electricity use returns to normal.",
        startMonth: 47,
        visibility: "forecast",
        preview: "Visitor electricity use will return to normal.",
      },
      {
        id: "oil-shock",
        title: "Fuel delivery delayed",
        message: "Oil prices rise through Nov 2013.",
        startMonth: 117,
        durationMonths: 3,
        visibility: "forecast",
        preview: "A delayed fuel shipment will raise oil prices.",
        effects: {
          fuelPriceMultipliers: {
            Oil: values((difficulty) => PARADISE_BALANCE[difficulty].oilShock),
          },
        },
      },
      {
        id: "local-energy-review",
        title: "Island power check-in",
        message: "Review last year's local power and reliability.",
        startMonth: 121,
        visibility: "forecast",
        preview: "Local generation and grid reliability will be assessed.",
      },
      {
        id: "cargo-restored",
        title: "Fuel delivery restored",
        message: "Oil deliveries and prices return to normal.",
        startMonth: 120,
        visibility: "forecast",
        preview: "Oil deliveries and prices will return to normal.",
      },
    ],
    objectives: [retention(156)],
  },
  presentation: {
    "visitor-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Visitors expected to raise electricity use ${Math.round((PARADISE_BALANCE[difficulty].visitorDemand - 1) * 100)}% from May 2006 through October 2007.`,
      ),
      source: source("customers", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    "visitor-peak": {
      previewTitle: "Visitor demand rising",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Electricity use rises ${Math.round((PARADISE_BALANCE[difficulty].visitorDemand - 1) * 100)}% through October 2007.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        demandMultiplier: PARADISE_BALANCE[difficulty].visitorDemand,
      })),
      source: source("customers", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    "cargo-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Oil prices may rise ${Math.round((PARADISE_BALANCE[difficulty].oilShock - 1) * 100)}% this fall. Prepare local generation or storage before September.`,
      ),
      source: source("danger", "NOTABLE", FLEET_TARGET),
    },
    "visitor-recovery": {
      previewTitle: "Visitor demand easing",
      source: source("customers", "ROUTINE", SUPPLY_DEMAND_TARGET),
    },
    "oil-shock": {
      previewTitle: "Possible fuel delivery delays",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Oil prices rise ${Math.round((PARADISE_BALANCE[difficulty].oilShock - 1) * 100)}% through Nov 2013.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        oilMultiplier: PARADISE_BALANCE[difficulty].oilShock,
      })),
      source: source("danger", "CRITICAL", FLEET_TARGET, 95),
    },
    "local-energy-review": {
      previewTitle: "Island power review ahead",
      nativeReview: "paradiseReview",
      source: source("goal", "ROUTINE", SUPPLY_DEMAND_TARGET, 85),
      reports: [
        {
          id: "arc-105-local-energy-review-fuel-mix",
          kind: "fuelMix",
          fromMonth: 121,
          throughMonth: 132,
          fuels: ["Coal", "Natural Gas", "Oil", "Uranium", "Biomass"],
          basis: "customerDemand",
        },
        reliabilityReport("arc-105-local-energy-review-reliability", 121, 132),
      ],
    },
    "cargo-restored": {
      previewTitle: "Fuel deliveries resuming",
      source: source("fuel", "ROUTINE", FUEL_PRICE_TARGET),
    },
  },
};

export const RENEWABLES_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 101,
  arcId: "renewables-scale",
  definitions: {
    events: [
      {
        id: "bridge-contracts",
        title: "Discounted gas plants",
        message:
          "New gas projects cost less through mission end. Existing projects keep their price.",
        startMonth: 1,
        durationMonths: 144,
        visibility: "forecast",
        preview: "New gas plants will become cheaper to build.",
        effects: {
          constructionCostMultipliersByFuel: {
            "Natural Gas": values(
              (difficulty) => RENEWABLES_BALANCE[difficulty].bridgeGasBuildCost,
            ),
          },
        },
      },
      {
        id: "manufacturing-warning",
        title: "Cheaper solar and wind forecast",
        message:
          "New solar and wind projects cost less from January 2009. Existing projects keep their price.",
        startMonth: 73,
        visibility: "forecast",
      },
      {
        id: "procurement-step",
        title: "Solar and wind prices fall",
        message: "New solar and wind projects cost less through mission end.",
        startMonth: 85,
        durationMonths: 60,
        visibility: "forecast",
        preview:
          "New solar plants and wind farms will become cheaper to build.",
        effects: {
          constructionCostMultipliersByFuel: {
            Sun: values(
              (difficulty) => RENEWABLES_BALANCE[difficulty].solarBuildCost,
            ),
            Wind: values(
              (difficulty) => RENEWABLES_BALANCE[difficulty].windBuildCost,
            ),
          },
        },
      },
      {
        id: "clean-tech-load-warning",
        title: "Factory growth forecast",
        message:
          "New factories expected to raise electricity use from 2012 through 2013.",
        startMonth: 115,
        visibility: "forecast",
      },
      {
        id: "clean-tech-load",
        title: "New factories open",
        message: "Electricity usage rises through Dec 2013.",
        startMonth: 121,
        durationMonths: 24,
        visibility: "forecast",
        preview: "Factory growth will increase electricity use.",
        effects: {
          demandMultiplier: values(
            (difficulty) => RENEWABLES_BALANCE[difficulty].demandLoad,
          ),
        },
      },
      {
        id: "integration-review",
        title: "Clean-power check-in",
        message: "Review last year's clean power and backup capacity.",
        startMonth: 133,
        visibility: "forecast",
        preview: "Renewable generation and backup capacity will be assessed.",
      },
    ],
    objectives: [retention(144)],
  },
  presentation: {
    "bridge-contracts": {
      previewTitle: "Gas plant discounts coming",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `New gas projects cost ${Math.round((1 - RENEWABLES_BALANCE[difficulty].bridgeGasBuildCost) * 100)}% less through mission end. Existing projects keep their price.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        bridgeGasBuildCost: RENEWABLES_BALANCE[difficulty].bridgeGasBuildCost,
      })),
      source: source("build", "NOTABLE", GENERATOR_TARGET),
    },
    "manufacturing-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `New solar projects costing ${Math.round((1 - RENEWABLES_BALANCE[difficulty].solarBuildCost) * 100)}% less and wind ${Math.round((1 - RENEWABLES_BALANCE[difficulty].windBuildCost) * 100)}% less from January 2009. Existing projects keep their price.`,
      ),
      source: source("build", "NOTABLE", GENERATOR_TARGET),
    },
    "procurement-step": {
      previewTitle: "Solar and wind costs falling",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `New solar projects cost ${Math.round((1 - RENEWABLES_BALANCE[difficulty].solarBuildCost) * 100)}% less and wind ${Math.round((1 - RENEWABLES_BALANCE[difficulty].windBuildCost) * 100)}% less through mission end.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        solarBuildCost: RENEWABLES_BALANCE[difficulty].solarBuildCost,
        windBuildCost: RENEWABLES_BALANCE[difficulty].windBuildCost,
      })),
      source: source("build", "NOTABLE", GENERATOR_TARGET, 80),
    },
    "clean-tech-load-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `New factories expected to raise electricity use ${Math.round((RENEWABLES_BALANCE[difficulty].demandLoad - 1) * 100)}% from 2012 through 2013.`,
      ),
      source: source("customers", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    "clean-tech-load": {
      previewTitle: "New factories opening",
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `Electricity usage rises ${Math.round((RENEWABLES_BALANCE[difficulty].demandLoad - 1) * 100)}% through Dec 2013.`,
      ),
      attributesByDifficulty: facts((difficulty) => ({
        demandMultiplier: RENEWABLES_BALANCE[difficulty].demandLoad,
      })),
      source: source("customers", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    "integration-review": {
      previewTitle: "Clean power review ahead",
      nativeReview: "renewablesReview",
      source: source("goal", "ROUTINE", SUPPLY_DEMAND_TARGET, 90),
      reports: [
        {
          id: "arc-101-integration-review-fuel-mix",
          kind: "fuelMix",
          fromMonth: 121,
          throughMonth: 132,
          fuels: ["Sun", "Wind", "Offshore Wind", "Airborne Wind"],
          basis: "customerDemand",
        },
        reliabilityReport("arc-101-integration-review-reliability", 121, 132),
        {
          id: "arc-101-integration-review-firm-coverage",
          kind: "firmCoverage",
          fromMonth: 121,
          throughMonth: 132,
        },
        {
          id: "arc-101-integration-review-storage-coverage",
          kind: "storageCoverage",
          fromMonth: 121,
          throughMonth: 132,
        },
      ],
    },
  },
};

export const HEATWAVE_DROUGHT_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 108,
  arcId: "heatwave-drought",
  reliabilityNoun: "2026 heatwave and drought",
  definitions: {
    events: [
      {
        id: "seasonal-warning",
        title: "A hot, dry summer ahead",
        message:
          "June–August 2026 heat raising demand as drought cuts hydro and nuclear output. Build generation and storage.",
        startMonth: 7,
        visibility: "forecast",
      },
      ...([30, 31, 32] as const).map((startMonth, step) => ({
        id: `heatwave-month-${step + 1}`,
        title: [
          "Heatwave begins",
          "Rivers keep falling",
          "Peak heat and drought",
        ][step],
        message:
          "Heat raises demand as drought limits hydro and nuclear output.",
        startMonth,
        durationMonths: 1,
        visibility: "forecast" as const,
        preview: [
          "Heat raising demand as drought limits hydro and nuclear output.",
          "Drought tightening hydro and nuclear limits as demand rises further.",
          "Demand climbing further as hydro and nuclear output reach seasonal lows.",
        ][step],
        effects: {
          temperatureOffsetC: 4 + step * 2,
          demandMultiplier: values(
            (difficulty) =>
              HEATWAVE_DROUGHT_BALANCE[difficulty].demandMultipliers[step],
          ),
          hydroInflowMultiplier: values(
            (difficulty) =>
              HEATWAVE_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[step],
          ),
          outputMultipliersByFuel: {
            Hydro: values(
              (difficulty) =>
                HEATWAVE_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[
                  step
                ],
            ),
            Uranium: values(
              (difficulty) =>
                HEATWAVE_DROUGHT_BALANCE[difficulty].nuclearOutputMultipliers[
                  step
                ],
            ),
          },
        },
      })),
      {
        id: "cooler-weather",
        title: "The heat breaks",
        message:
          "Cooler weather lowers demand, but reservoirs will take time to recover.",
        startMonth: 33,
        visibility: "forecast",
        preview:
          "Cooler weather will lower demand, with slower reservoir recovery.",
      },
    ],
    objectives: [
      reliability("Keep the lights on through the heatwave", 42, 44),
    ],
    debriefReports: [
      {
        id: "heatwave-drought-reliability",
        label: "2026 heatwave and drought",
        kind: "reliability",
        fromMonth: 42,
        throughMonth: 44,
        minDemandServedShare: 0.995,
      },
    ],
  },
  presentation: {
    "seasonal-warning": {
      hidePreview: true,
      messageByDifficulty: byDifficulty(
        (difficulty) =>
          `June–August 2026 heat raising demand as drought cuts hydro and nuclear output. Build generation and storage. ${buildLeadTimeHint(difficulty)}`,
      ),
      source: source("forecast", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    ...Object.fromEntries(
      [0, 1, 2].map((step) => [
        `heatwave-month-${step + 1}`,
        {
          previewTitle: [
            "Heat building",
            "Rivers falling further",
            "Heat and drought peaking",
          ][step],
          messageByDifficulty: byDifficulty((difficulty) => {
            const balance = HEATWAVE_DROUGHT_BALANCE[difficulty];
            return `Demand is up ${Math.round((balance.demandMultipliers[step] - 1) * 100)}%. Hydro output is down to ${Math.round(balance.hydroOutputMultipliers[step] * 100)}%; nuclear to ${Math.round(balance.nuclearOutputMultipliers[step] * 100)}%.`;
          }),
          source: source(
            "weather",
            step === 2 ? "CRITICAL" : "NOTABLE",
            FLEET_TARGET,
            100 + step,
          ),
        },
      ]),
    ),
    "cooler-weather": {
      previewTitle: "Heat easing",
      source: source("weather", "NOTABLE", { card: "INSIGHTS" }),
    },
  },
};

export const KARIBA_DROUGHT_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 114,
  arcId: "kariba-drought",
  reliabilityNoun: "2016 drought",
  definitions: {
    events: [
      {
        id: "poor-rains-forecast",
        title: "Weak rainy season forecast",
        message:
          "El Niño may reduce reservoir inflow in 2015–2016. Nearly all your power depends on this water.",
        startMonth: 9,
        visibility: "forecast",
      },
      ...([13, 19, 25, 37] as const).map((startMonth, step) => ({
        id: `reservoir-step-${step + 1}`,
        title: [
          "The rains came up short",
          "The lake keeps dropping",
          "Kariba near its minimum",
          "The rains return",
        ][step],
        message: "Reservoir inflow and hydro output change.",
        startMonth,
        durationMonths: step >= 2 ? 12 : 6,
        visibility: "forecast" as const,
        preview:
          step === 3
            ? "Better rains will increase inflow and help hydro output recover."
            : step === 0
              ? "Poor rains will reduce reservoir inflow and hydro output."
              : "Reservoir inflow and hydro output will decrease further.",
        effects: {
          hydroInflowMultiplier: values(
            (difficulty) =>
              KARIBA_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[step],
          ),
          outputMultipliersByFuel: {
            Hydro: values(
              (difficulty) =>
                KARIBA_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[step],
            ),
          },
        },
      })),
    ],
    objectives: [
      reliability("Keep the grid running through the drought", 49, 60, 0.98),
    ],
    debriefReports: [
      {
        id: "kariba-drought-reliability",
        label: "2016 drought",
        kind: "reliability",
        fromMonth: 49,
        throughMonth: 60,
        minDemandServedShare: 0.98,
      },
    ],
  },
  presentation: {
    "poor-rains-forecast": {
      hidePreview: true,
      source: source("forecast", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    ...Object.fromEntries(
      [0, 1, 2, 3].map((step) => [
        `reservoir-step-${step + 1}`,
        {
          previewTitle: [
            "Rains falling short",
            "Lake levels dropping further",
            "Kariba approaching its minimum",
            "Rains returning",
          ][step],
          messageByDifficulty: byDifficulty((difficulty) => {
            const balance = KARIBA_DROUGHT_BALANCE[difficulty],
              runoff = balance.hydroRunoffMultipliers[step],
              output = balance.hydroOutputMultipliers[step];
            return step === 3
              ? `Hydro output recovers to ${Math.round(output * 100)}%; inflow rises to ${Math.round(runoff * 100)}%.`
              : `Hydro output is down to ${Math.round(output * 100)}%; inflow is at ${Math.round(runoff * 100)}%.`;
          }),
          source: source(
            "weather",
            step === 2 ? "CRITICAL" : "NOTABLE",
            FLEET_TARGET,
            100 + step,
          ),
        },
      ]),
    ),
  },
};

export const DELHI_SUMMER_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: 115,
  arcId: "delhi-summer",
  reliabilityNoun: "record summer of 2024",
  definitions: {
    events: [
      {
        id: "summer-outlook",
        title: "A hotter summer than the last",
        message:
          "Pre-monsoon demand peaks rise each year as heat cuts coal and gas output. Build for the peak, not the average.",
        startMonth: 3,
        visibility: "forecast",
      },
      ...([5, 17, 29, 41] as const).map((startMonth, step) => ({
        id: `summer-peak-${step + 1}`,
        title: [
          "The 2021 pre-monsoon heat",
          "A longer, hotter 2022",
          "2023 sets a new peak",
          "The record summer",
        ][step],
        message: "Summer heat raises demand and limits coal and gas output.",
        startMonth,
        durationMonths: 3,
        visibility: "forecast" as const,
        preview:
          step === 0
            ? "Heat will raise demand and reduce coal and gas output."
            : "Summer demand will rise further as heat tightens coal and gas output limits.",
        effects: {
          temperatureOffsetC: values(
            (difficulty) =>
              DELHI_SUMMER_BALANCE[difficulty].temperatureOffsetC[step],
          ),
          demandMultiplier: values(
            (difficulty) =>
              DELHI_SUMMER_BALANCE[difficulty].demandMultipliers[step],
          ),
          outputMultipliersByFuel: {
            Coal: values(
              (difficulty) =>
                DELHI_SUMMER_BALANCE[difficulty].thermalOutputMultipliers[step],
            ),
            "Natural Gas": values(
              (difficulty) =>
                DELHI_SUMMER_BALANCE[difficulty].thermalOutputMultipliers[step],
            ),
          },
        },
      })),
    ],
    objectives: [
      reliability("Keep the lights on through the record summer", 77, 79),
    ],
    debriefReports: [
      {
        id: "delhi-summer-reliability",
        label: "record summer of 2024",
        kind: "reliability",
        fromMonth: 77,
        throughMonth: 79,
        minDemandServedShare: 0.995,
      },
    ],
  },
  presentation: {
    "summer-outlook": {
      hidePreview: true,
      source: source("forecast", "NOTABLE", SUPPLY_DEMAND_TARGET),
    },
    ...Object.fromEntries(
      [0, 1, 2, 3].map((step) => [
        `summer-peak-${step + 1}`,
        {
          previewTitle: [
            "Summer heat raising demand",
            "Hotter summer straining supply",
            "Summer demand climbing further",
            "Summer demand may reach a record",
          ][step],
          messageByDifficulty: byDifficulty(
            (difficulty) =>
              `Demand is up ${Math.round((DELHI_SUMMER_BALANCE[difficulty].demandMultipliers[step] - 1) * 100)}%; coal and gas output is down to ${Math.round(DELHI_SUMMER_BALANCE[difficulty].thermalOutputMultipliers[step] * 100)}%.`,
          ),
          source: source(
            "weather",
            step === 3 ? "CRITICAL" : "NOTABLE",
            FLEET_TARGET,
            100 + step,
          ),
        },
      ]),
    ),
  },
};

/** Materialized trusted data only: no phase callbacks or simulation calculations survive here. */
export const OFFICIAL_EFFECT_SCENARIO_RULES: readonly OfficialScenarioRuleDefinition[] =
  [
    DATA_CENTER_RULES,
    DEEP_FREEZE_RULES,
    CARBON_FEE_RULES,
    SHALE_BOOM_RULES,
    PARADISE_RULES,
    RENEWABLES_RULES,
    HEATWAVE_DROUGHT_RULES,
    KARIBA_DROUGHT_RULES,
    DELHI_SUMMER_RULES,
  ];
