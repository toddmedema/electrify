import {
  ActiveWorldEventType,
  ConceptNameType,
  DateType,
  DifficultyType,
  GameEventImportanceType,
  GameEventKindType,
  FuelNameType,
  LocationType,
  StoryAttributeValueType,
  StoryPeriodSnapshotType,
  StorySnapshotType,
  StoryActionTargetType,
  WorldEventEffectsType,
} from "../Types";
import { scenarioEffectsSummary } from "../helpers/ScenarioEffectsSummary";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { buildLeadTimeHint } from "../helpers/BuildLeadTime";
import { randomAt, RANDOM_STREAM } from "../helpers/Math";
import { relocateOfficialArcMonth } from "../helpers/ScenarioArcTiming";
import {
  DEEP_FREEZE_DECISION_KEY,
  WILDFIRE_DECISION_KEY,
  WINTERIZATION_COST,
  WILDFIRE_PREPARATION_COST,
} from "./ScenarioChoiceRules";
import { wildfirePreparednessEffectiveness } from "../helpers/Wildfire";
import type { CompiledScenarioRules } from "./ScenarioRules";
import type { MonthlyHistoryType } from "../Types";
import {
  resolveScenarioRuleEvents,
  upcomingScenarioRuleEvents,
} from "../helpers/ScenarioRuleRuntime";
export {
  DEEP_FREEZE_DECISION_KEY,
  WILDFIRE_DECISION_KEY,
  WINTERIZATION_COST,
} from "./ScenarioChoiceRules";

export interface StoryContextType {
  rules?: CompiledScenarioRules;
  monthlyHistory?: MonthlyHistoryType[];
  completedMonths?: number;
  startingRateDollarsPerKWh?: number;
  endingRateDollarsPerKWh?: number;
  customEvents?: Array<{ scenarioId: number; moneyScale: number }>;
  seed: number;
  scenarioId: number;
  difficulty: DifficultyType;
  date: DateType;
  location: LocationType;
  snapshot: StorySnapshotType;
  /** Exact completed-month summaries used by short recovery phases. */
  periodSnapshots?: Partial<Record<number, StoryPeriodSnapshotType>>;
  /** Previously persisted live resolutions, including expired onsets. */
  occurrences?: ActiveWorldEventType[];
}

export type StoryScheduleType =
  | { atMonth: number }
  | {
      seededMonthRange: { firstMonth: number; lastMonth: number };
      randomKey: string;
    };

export type StoryRandomType = (attribute: string) => number;

export interface StoryPhaseDescriptionType {
  title?: string;
  message: string;
  concept?: ConceptNameType;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
  attributes?: Record<string, StoryAttributeValueType>;
  effects?: WorldEventEffectsType;
  turningPointPriority?: number;
}

export interface StoryPhasePreviewType {
  title?: string;
  message: string;
}

export interface StoryPhaseDefinitionType {
  id: string;
  schedule: StoryScheduleType;
  /** Defaults to true. False keeps a surprise hidden until its onset. */
  forecastable?: boolean;
  /** Zero (the default) logs a point-in-time phase without applying lasting effects. */
  durationMonths?: number | ((context: StoryContextType) => number);
  /** Allows linked seeded phases (for example landfall/restoration) to share one addressed draw. */
  scheduleAddress?: string;
  scheduleOffsetMonths?: number | ((context: StoryContextType) => number);
  /** Short anticipatory copy shared by all upcoming views; live logs use `describe`.
   * Return null to keep warning-only or surprise phases out of those views.
   */
  preview: (
    context: StoryContextType,
    random: StoryRandomType,
  ) => StoryPhasePreviewType | null;
  describe: (
    context: StoryContextType,
    random: StoryRandomType,
  ) => StoryPhaseDescriptionType;
}

export interface StoryArcDefinitionType {
  id: string;
  scenarioId: number;
  phases: StoryPhaseDefinitionType[];
}

export interface ResolvedStoryType {
  /** Phases whose scheduled month is the requested date, suitable for live persistence/logging. */
  occurrences: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  /** Scheduled phases whose effect window contains the requested date. */
  active: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  effects: WorldEventEffectsType;
}

const DIFFICULTY_ORDER: DifficultyType[] = [
  "Intern",
  "Employee",
  "Manager",
  "VP",
  "CEO",
];

function share(part: number, whole: number): number {
  return whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
}

function reliabilityOf(demandWh: number, unservedWh: number): number {
  return demandWh > 0 ? 1 - share(unservedWh, demandWh) : 1;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function deliveredFrom(
  snapshot: StorySnapshotType | StoryPeriodSnapshotType,
  fuels: FuelNameType[],
): number {
  const delivered =
    "deliveredWhByFuel12m" in snapshot
      ? snapshot.deliveredWhByFuel12m
      : snapshot.deliveredWhByFuel;
  return fuels.reduce((total, fuel) => total + (delivered[fuel] || 0), 0);
}

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

const FUEL_PRICE_TARGET: StoryActionTargetType = {
  card: "INSIGHTS",
  layer: "FUEL_PRICES",
};

const SHALE_BOOM_ARC: StoryArcDefinitionType = {
  id: "shale-boom",
  scenarioId: 103,
  phases: [
    {
      id: "regional-glut-warning",
      schedule: { atMonth: 12 },
      preview: () => null,
      describe: () => ({
        title: "Cheaper gas forecast",
        message:
          "Gas prices may fall in January 2010. Diversify: cheap gas may not last.",
        concept: "fuel",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: FUEL_PRICE_TARGET,
      }),
    },
    {
      id: "regional-glut",
      schedule: { atMonth: 48 },
      durationMonths: 74,
      preview: () => ({
        title: "Gas prices falling",
        message: "Regional shale glut lowering local gas prices.",
      }),
      describe: ({ difficulty }) => {
        const { boomGasMultiplier } = SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Gas prices fall",
          message: `A regional shale glut puts local gas ${Math.round((1 - boomGasMultiplier) * 100)}% below the national price through Feb 2016.`,
          concept: "fuel",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FUEL_PRICE_TARGET,
          attributes: { boomGasMultiplier },
          effects: {
            fuelPriceMultipliers: { "Natural Gas": boomGasMultiplier },
          },
        };
      },
    },
    {
      id: "freeze-warning",
      schedule: { atMonth: 95 },
      preview: () => null,
      describe: ({ difficulty }) => {
        const { freezeGasOutput } = SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Winter freeze warning",
          message: `A winter freeze may raise gas prices and cut gas-plant output to ${Math.round(freezeGasOutput * 100)}%.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FUEL_PRICE_TARGET,
        };
      },
    },
    {
      id: "freeze",
      schedule: { atMonth: 96 },
      durationMonths: 3,
      preview: () => ({
        title: "Winter freeze approaching",
        message: "Gas costs spiking and gas plants producing less.",
      }),
      describe: ({ difficulty }) => {
        const balance = SHALE_BOOM_BALANCE[difficulty];
        const effectiveMultiplier =
          balance.boomGasMultiplier * balance.freezeSurcharge;
        return {
          title: "Winter freeze",
          message: `Gas prices are ${Math.round(Math.abs(effectiveMultiplier - 1) * 100)}% ${effectiveMultiplier >= 1 ? "above" : "below"} normal; gas output is down to ${Math.round(balance.freezeGasOutput * 100)}%.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: FUEL_PRICE_TARGET,
          attributes: {
            freezeSurcharge: balance.freezeSurcharge,
            freezeGasOutput: balance.freezeGasOutput,
            effectiveGasPriceMultiplier: effectiveMultiplier,
          },
          effects: {
            fuelPriceMultipliers: {
              "Natural Gas": balance.freezeSurcharge,
            },
            facilityOutputMultipliersByFuel: {
              "Natural Gas": balance.freezeGasOutput,
            },
          },
        };
      },
    },
    {
      id: "normalization",
      schedule: { atMonth: 122 },
      preview: () => ({
        title: "Gas boom ending",
        message: "Natural gas prices returning to normal.",
      }),
      describe: ({ snapshot }) => {
        const gasShare = share(
          snapshot.deliveredWhByFuel12m["Natural Gas"] || 0,
          snapshot.demandWh12m,
        );
        const reliability = reliabilityOf(
          snapshot.demandWh12m,
          snapshot.unservedWh12m,
        );
        const resilient = reliability >= 0.999 && gasShare < 0.5;
        return {
          title: "Gas boom ends",
          message: resilient
            ? `Gas prices return to normal. Gas supplied ${percent(gasShare)} of last year's power; your grid stayed reliable.`
            : `Gas prices return to normal. Gas supplied ${percent(gasShare)} of last year's power; the grid met ${percent(reliability)} of demand.`,
          concept: "fuel",
          kind: "WORLD_EVENT",
          importance: "ROUTINE",
          actionTarget: FUEL_PRICE_TARGET,
          attributes: { gasShare, reliability },
          turningPointPriority: 80,
        };
      },
    },
    {
      id: "freeze-recovery",
      schedule: { atMonth: 99 },
      preview: () => ({
        title: "Gas output recovering",
        message: "Plant limits lifting and lower boom-era prices returning.",
      }),
      describe: ({ difficulty }) => ({
        title: "Winter freeze ends",
        message: `Gas output is fully restored, and prices return to the ${Math.round((1 - SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier) * 100)}% reduction caused by the shale gas boom.`,
        concept: "supply",
        kind: "WORLD_EVENT",
        importance: "ROUTINE",
        actionTarget: FUEL_PRICE_TARGET,
      }),
    },
  ],
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

export interface HurricaneBalanceType {
  severity: string;
  targetCapacityShare: number;
  outputMultiplier: number;
  durationMonths: number;
  oilMultiplier: number;
}

export const HURRICANE_BALANCE: Record<DifficultyType, HurricaneBalanceType> = {
  Intern: {
    severity: "Limited",
    targetCapacityShare: 0.15,
    outputMultiplier: 0.8,
    durationMonths: 2,
    oilMultiplier: 1.15,
  },
  Employee: {
    severity: "Moderate",
    targetCapacityShare: 0.2,
    outputMultiplier: 0.7,
    durationMonths: 3,
    oilMultiplier: 1.25,
  },
  Manager: {
    severity: "Major",
    targetCapacityShare: 0.3,
    outputMultiplier: 0.6,
    durationMonths: 4,
    oilMultiplier: 1.4,
  },
  VP: {
    severity: "Severe",
    targetCapacityShare: 0.4,
    outputMultiplier: 0.5,
    durationMonths: 5,
    oilMultiplier: 1.5,
  },
  CEO: {
    severity: "Extreme",
    targetCapacityShare: 0.6,
    outputMultiplier: 0.1,
    durationMonths: 6,
    oilMultiplier: 1.6,
  },
};

export interface EndOfEraBalanceType {
  oldCoalOutput: number;
  coalOM: number;
  complianceCoalOutput: number;
}

export const END_OF_ERA_BALANCE: Record<DifficultyType, EndOfEraBalanceType> = {
  Intern: { oldCoalOutput: 0.9, coalOM: 1.1, complianceCoalOutput: 1 },
  Employee: {
    oldCoalOutput: 0.875,
    coalOM: 1.15,
    complianceCoalOutput: 0.9,
  },
  Manager: {
    oldCoalOutput: 0.85,
    coalOM: 1.2,
    complianceCoalOutput: 0.75,
  },
  VP: { oldCoalOutput: 0.825, coalOM: 1.25, complianceCoalOutput: 0.5 },
  CEO: { oldCoalOutput: 0.8, coalOM: 1.3, complianceCoalOutput: 0.001 },
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

const CARBON_FEE_ARC: StoryArcDefinitionType = {
  id: "carbon-fee-ratchet",
  scenarioId: 100,
  phases: [
    {
      id: "published-ratchet",
      schedule: { atMonth: 12 },
      preview: () => null,
      describe: ({ difficulty }) => {
        const feePerTon = CARBON_FEE_BALANCE[difficulty];
        return {
          title: "Higher pollution fee announced",
          message: `The pollution fee rises to $${feePerTon} per ton in January 2024. Coal faces the biggest increase.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: GENERATOR_TARGET,
          attributes: { feePerTon },
        };
      },
    },
    {
      id: "ratchet-onset",
      schedule: { atMonth: 48 },
      durationMonths: 96,
      preview: () => ({
        title: "Pollution fees rising",
        message: "Coal and gas costing more to run.",
      }),
      describe: ({ difficulty }) => {
        const feePerTon = CARBON_FEE_BALANCE[difficulty];
        return {
          title: "Higher pollution fee begins",
          message: `The pollution fee is now $${feePerTon} per ton, raising coal and gas running costs.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: GENERATOR_TARGET,
          attributes: { feePerTon },
          effects: { carbonFeePerKgCO2e: feePerTon / 1000 },
          turningPointPriority: 90,
        };
      },
    },
  ],
};

const PARADISE_ARC: StoryArcDefinitionType = {
  id: "island-energy",
  scenarioId: 105,
  phases: [
    {
      id: "visitor-warning",
      schedule: { atMonth: 21 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "Visitor surge forecast",
        message: `Visitors expected to raise electricity use ${Math.round((PARADISE_BALANCE[difficulty].visitorDemand - 1) * 100)}% from May 2006 through October 2007.`,
        concept: "customers",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: SUPPLY_DEMAND_TARGET,
      }),
    },
    {
      id: "visitor-peak",
      schedule: { atMonth: 28 },
      durationMonths: 18,
      preview: () => ({
        title: "Visitor demand rising",
        message: "More visitors increasing electricity use.",
      }),
      describe: ({ difficulty }) => {
        const demandMultiplier = PARADISE_BALANCE[difficulty].visitorDemand;
        return {
          title: "Visitor surge",
          message: `Electricity use rises ${Math.round((demandMultiplier - 1) * 100)}% through October 2007.`,
          concept: "customers",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { demandMultiplier },
          effects: { demandMultiplier },
        };
      },
    },
    {
      id: "cargo-warning",
      schedule: { atMonth: 101 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "Fuel delivery warning",
        message: `Oil prices may rise ${Math.round((PARADISE_BALANCE[difficulty].oilShock - 1) * 100)}% this fall. Prepare local generation or storage before September.`,
        concept: "danger",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      }),
    },
    {
      id: "visitor-recovery",
      schedule: { atMonth: 46 },
      preview: () => ({
        title: "Visitor demand easing",
        message: "Visitor electricity use returning to normal.",
      }),
      describe: () => ({
        title: "Visitor surge ends",
        message: "Visitor electricity use returns to normal.",
        concept: "customers",
        kind: "WORLD_EVENT",
        importance: "ROUTINE",
        actionTarget: SUPPLY_DEMAND_TARGET,
      }),
    },
    {
      id: "oil-shock",
      schedule: { atMonth: 116 },
      durationMonths: 3,
      preview: () => ({
        title: "Possible fuel delivery delays",
        message: "Delayed fuel shipment raising oil prices.",
      }),
      describe: ({ difficulty }) => {
        const oilMultiplier = PARADISE_BALANCE[difficulty].oilShock;
        return {
          title: "Fuel delivery delayed",
          message: `Oil prices rise ${Math.round((oilMultiplier - 1) * 100)}% through Nov 2013.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: FLEET_TARGET,
          attributes: { oilMultiplier },
          effects: { fuelPriceMultipliers: { Oil: oilMultiplier } },
          turningPointPriority: 95,
        };
      },
    },
    {
      id: "local-energy-review",
      schedule: { atMonth: 120 },
      preview: () => ({
        title: "Island power review ahead",
        message: "Assessing local generation and grid reliability.",
      }),
      describe: ({ snapshot }) => {
        const shipped = deliveredFrom(snapshot, [
          "Coal",
          "Natural Gas",
          "Oil",
          "Uranium",
          "Biomass",
        ]);
        const shippedShare = share(shipped, snapshot.demandWh12m);
        const reliability = reliabilityOf(
          snapshot.demandWh12m,
          snapshot.unservedWh12m,
        );
        return {
          title: "Island power check-in",
          message:
            reliability >= 0.999 && shippedShare < 0.5
              ? `Local sources supplied most of last year's power. The island met ${percent(reliability)} of demand.`
              : `Shipped fuels supplied ${percent(shippedShare)} of last year's power. The island met ${percent(reliability)} of demand.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "ROUTINE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { shippedShare, reliability },
          turningPointPriority: 85,
        };
      },
    },
    {
      id: "cargo-restored",
      schedule: { atMonth: 119 },
      preview: () => ({
        title: "Fuel deliveries resuming",
        message: "Oil deliveries and prices returning to normal.",
      }),
      describe: () => ({
        title: "Fuel delivery restored",
        message: "Oil deliveries and prices return to normal.",
        concept: "fuel",
        kind: "WORLD_EVENT",
        importance: "ROUTINE",
        actionTarget: FUEL_PRICE_TARGET,
      }),
    },
  ],
};

const RENEWABLES_ARC: StoryArcDefinitionType = {
  id: "renewables-scale",
  scenarioId: 101,
  phases: [
    {
      id: "bridge-contracts",
      schedule: { atMonth: 0 },
      durationMonths: 144,
      preview: () => ({
        title: "Gas plant discounts coming",
        message: "New gas plants becoming cheaper to build.",
      }),
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Discounted gas plants",
          message: `New gas projects cost ${Math.round((1 - balance.bridgeGasBuildCost) * 100)}% less through mission end. Existing projects keep their price.`,
          concept: "build",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: GENERATOR_TARGET,
          attributes: {
            bridgeGasBuildCost: balance.bridgeGasBuildCost,
          },
          effects: {
            buildCostMultipliersByFuel: {
              "Natural Gas": balance.bridgeGasBuildCost,
            },
          },
        };
      },
    },
    {
      id: "manufacturing-warning",
      schedule: { atMonth: 72 },
      preview: () => null,
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Cheaper solar and wind forecast",
          message: `New solar projects costing ${Math.round((1 - balance.solarBuildCost) * 100)}% less and wind ${Math.round((1 - balance.windBuildCost) * 100)}% less from January 2009. Existing projects keep their price.`,
          concept: "build",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: GENERATOR_TARGET,
        };
      },
    },
    {
      id: "procurement-step",
      schedule: { atMonth: 84 },
      durationMonths: 60,
      preview: () => ({
        title: "Solar and wind costs falling",
        message: "New solar plants and wind farms becoming cheaper to build.",
      }),
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Solar and wind prices fall",
          message: `New solar projects cost ${Math.round((1 - balance.solarBuildCost) * 100)}% less and wind ${Math.round((1 - balance.windBuildCost) * 100)}% less through mission end.`,
          concept: "build",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: GENERATOR_TARGET,
          attributes: {
            solarBuildCost: balance.solarBuildCost,
            windBuildCost: balance.windBuildCost,
          },
          effects: {
            buildCostMultipliersByFuel: {
              Sun: balance.solarBuildCost,
              Wind: balance.windBuildCost,
            },
          },
          turningPointPriority: 80,
        };
      },
    },
    {
      id: "clean-tech-load-warning",
      schedule: { atMonth: 114 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "Factory growth forecast",
        message: `New factories expected to raise electricity use ${Math.round((RENEWABLES_BALANCE[difficulty].demandLoad - 1) * 100)}% from 2012 through 2013.`,
        concept: "customers",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: SUPPLY_DEMAND_TARGET,
      }),
    },
    {
      id: "clean-tech-load",
      schedule: { atMonth: 120 },
      durationMonths: 24,
      preview: () => ({
        title: "New factories opening",
        message: "Factory growth increasing electricity use.",
      }),
      describe: ({ difficulty }) => {
        const demandMultiplier = RENEWABLES_BALANCE[difficulty].demandLoad;
        return {
          title: "New factories open",
          message: `Electricity usage rises ${Math.round((demandMultiplier - 1) * 100)}% through Dec 2013.`,
          concept: "customers",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { demandMultiplier },
          effects: { demandMultiplier },
        };
      },
    },
    {
      id: "integration-review",
      schedule: { atMonth: 132 },
      preview: () => ({
        title: "Clean power review ahead",
        message: "Assessing renewable generation and backup capacity.",
      }),
      describe: ({ snapshot }) => {
        const variable = deliveredFrom(snapshot, [
          "Sun",
          "Wind",
          "Offshore Wind",
          "Airborne Wind",
        ]);
        const variableShare = share(variable, snapshot.demandWh12m);
        const reliability = reliabilityOf(
          snapshot.demandWh12m,
          snapshot.unservedWh12m,
        );
        const coverage = share(
          snapshot.firmPeakW + snapshot.storagePeakW,
          snapshot.peakDemandW12m,
        );
        return {
          title: "Clean-power check-in",
          message:
            reliability >= 0.999 && coverage >= 0.75
              ? `Wind and solar supplied ${percent(variableShare)} of last year's power; the grid met ${percent(reliability)} of demand.`
              : `Wind and solar supplied ${percent(variableShare)} of last year's power; the grid met ${percent(reliability)} of demand. Backup still trails peak needs.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "ROUTINE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { variableShare, reliability, coverage },
          turningPointPriority: 90,
        };
      },
    },
  ],
};

const HURRICANE_ARC: StoryArcDefinitionType = {
  id: "hurricane-2008",
  scenarioId: 104,
  phases: [
    {
      id: "outlook",
      // Landfall is seeded in months 101-106. Warning at month 60 leaves more than the CEO build
      // time of the reference gas plant, so the forecast can be answered with construction.
      schedule: { atMonth: 60 },
      preview: () => null,
      describe: ({ difficulty }) => {
        const balance = HURRICANE_BALANCE[difficulty];
        return {
          title: "2008 hurricane outlook",
          message: `A ${balance.severity.toLowerCase()} hurricane in 2008 may cut plant output for ${balance.durationMonths} months and raise oil prices. Add backup power. ${buildLeadTimeHint(difficulty)}`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FLEET_TARGET,
        };
      },
    },
    {
      id: "landfall",
      schedule: {
        seededMonthRange: { firstMonth: 101, lastMonth: 106 },
        randomKey: "landfall-month",
      },
      scheduleAddress: "landfall",
      durationMonths: ({ difficulty }) =>
        HURRICANE_BALANCE[difficulty].durationMonths,
      preview: () => ({
        title: "A hurricane may disrupt power",
        message: "Storm damage may reduce plant output and raise oil prices.",
      }),
      describe: (context, random) => {
        const balance = HURRICANE_BALANCE[context.difficulty];
        const candidates = context.snapshot.facilities
          .filter((facility) => facility.operational && !!facility.fuel)
          .map((facility) => ({
            ...facility,
            score: random(`facility|${facility.id}`),
          }))
          .sort((a, b) => a.score - b.score || a.id - b.id);
        const totalPeakW = candidates.reduce(
          (total, facility) => total + facility.peakW,
          0,
        );
        const targetPeakW = totalPeakW * balance.targetCapacityShare;
        const selected: typeof candidates = [];
        let selectedPeakW = 0;
        for (const candidate of candidates) {
          if (selectedPeakW >= targetPeakW) {
            break;
          }
          selected.push(candidate);
          selectedPeakW += candidate.peakW;
        }
        const facilityOutputMultipliersById = Object.fromEntries(
          selected.map((facility) => [
            String(facility.id),
            balance.outputMultiplier,
          ]),
        );
        const selectedNames = selected.map((facility) => facility.name);
        return {
          title: `${balance.severity} hurricane hits`,
          message:
            selectedNames.length > 0
              ? `${selectedNames.join(", ")}: output is down to ${percent(balance.outputMultiplier)} for ${balance.durationMonths} months. Oil prices rise ${Math.round((balance.oilMultiplier - 1) * 100)}%.`
              : `Oil prices rise ${Math.round((balance.oilMultiplier - 1) * 100)}% for ${balance.durationMonths} months. No operating plants were damaged.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: FLEET_TARGET,
          attributes: {
            severity: balance.severity,
            targetCapacityShare: balance.targetCapacityShare,
            selectedCapacityShare: share(selectedPeakW, totalPeakW),
            selectedFacilityIds: selected.map((facility) => facility.id),
            selectedFacilityNames: selectedNames,
            outputMultiplier: balance.outputMultiplier,
            durationMonths: balance.durationMonths,
            oilMultiplier: balance.oilMultiplier,
          },
          effects: {
            fuelPriceMultipliers: { Oil: balance.oilMultiplier },
            facilityOutputMultipliersById,
          },
          turningPointPriority: 100,
        };
      },
    },
    {
      id: "restoration",
      schedule: {
        seededMonthRange: { firstMonth: 101, lastMonth: 106 },
        randomKey: "landfall-month",
      },
      scheduleAddress: "landfall",
      scheduleOffsetMonths: ({ difficulty }) =>
        HURRICANE_BALANCE[difficulty].durationMonths,
      preview: () => ({
        title: "Storm repairs finishing",
        message: "Plant output and oil prices returning to normal.",
      }),
      describe: (context) => {
        const balance = HURRICANE_BALANCE[context.difficulty];
        const period = context.periodSnapshots?.[balance.durationMonths];
        const demandWh = period?.demandWh || context.snapshot.demandWh12m;
        const unservedWh = period?.unservedWh || context.snapshot.unservedWh12m;
        const reliability = reliabilityOf(demandWh, unservedWh);
        const onset = context.occurrences?.find(
          (event) => event.key === "story:104:hurricane-2008:landfall",
        );
        const selectedNames = (onset?.attributes.selectedFacilityNames ||
          []) as string[];
        return {
          title: "Storm repairs complete",
          message: `${selectedNames.length ? `${selectedNames.join(", ")}: output` : "Plant output"} and oil prices return to normal. The grid met ${percent(reliability)} of demand during the storm.`,
          concept: "supply",
          kind: "WORLD_EVENT",
          importance: unservedWh > demandWh * 0.001 ? "NOTABLE" : "ROUTINE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { demandWh, unservedWh, reliability },
          turningPointPriority: 90,
        };
      },
    },
  ],
};

const END_OF_ERA_ARC: StoryArcDefinitionType = {
  id: "coal-transition",
  scenarioId: 102,
  phases: [
    {
      id: "aging-warning",
      schedule: { atMonth: 48 },
      preview: () => null,
      describe: ({ snapshot, difficulty }) => {
        const selected = snapshot.facilities.filter(
          (facility) => facility.fuel === "Coal" && facility.ageYears + 2 >= 30,
        );
        return {
          title: "Aging coal warning",
          message: `${selected.length} aging coal ${selected.length === 1 ? "plant" : "plants"} dropping to ${percent(END_OF_ERA_BALANCE[difficulty].oldCoalOutput)} output for two years from January 1986.`,
          concept: "generator",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FLEET_TARGET,
          attributes: {
            selectedFacilityIds: selected.map((facility) => facility.id),
            selectedFacilityNames: selected.map((facility) => facility.name),
          },
        };
      },
    },
    {
      id: "aging-derate",
      schedule: { atMonth: 72 },
      durationMonths: 24,
      preview: () => ({
        title: "Older coal output falling",
        message: "Aging coal plants producing less power.",
      }),
      describe: ({ snapshot, difficulty }) => {
        const outputMultiplier = END_OF_ERA_BALANCE[difficulty].oldCoalOutput;
        const selected = snapshot.facilities.filter(
          (facility) =>
            facility.fuel === "Coal" &&
            facility.operational &&
            facility.ageYears >= 30,
        );
        return {
          title: "Aging coal slowdown",
          message: `${selected.length} aging coal ${selected.length === 1 ? "plant is" : "plants are"} down to ${percent(outputMultiplier)} output through December 1987.`,
          concept: "generator",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FLEET_TARGET,
          attributes: {
            selectedFacilityIds: selected.map((facility) => facility.id),
            outputMultiplier,
          },
          effects: {
            facilityOutputMultipliersById: Object.fromEntries(
              selected.map((facility) => [
                String(facility.id),
                outputMultiplier,
              ]),
            ),
          },
        };
      },
    },
    {
      id: "compliance-warning",
      schedule: { atMonth: 130 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "New coal rules announced",
        message: `Coal running costs rising ${Math.round((END_OF_ERA_BALANCE[difficulty].coalOM - 1) * 100)}% in January 1995.`,
        concept: "danger",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: GENERATOR_TARGET,
      }),
    },
    {
      id: "aging-restoration",
      schedule: { atMonth: 96 },
      preview: () => ({
        title: "Older coal output recovering",
        message: "Temporary limits on older coal plants lifting.",
      }),
      describe: () => ({
        title: "Aging slowdown ends",
        message: "Older coal plants return to full output.",
        concept: "supply",
        kind: "WORLD_EVENT",
        importance: "ROUTINE",
        actionTarget: FLEET_TARGET,
      }),
    },
    {
      id: "compliance",
      schedule: { atMonth: 180 },
      durationMonths: 60,
      preview: () => ({
        title: "Coal rules tightening",
        message: "Coal plants costing more to run and producing less power.",
      }),
      describe: ({ difficulty }) => {
        const { coalOM, complianceCoalOutput } = END_OF_ERA_BALANCE[difficulty];
        return {
          title: "New coal rules begin",
          message: `Coal running costs rise ${Math.round((coalOM - 1) * 100)}%; output is limited to ${percent(complianceCoalOutput)}.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: GENERATOR_TARGET,
          attributes: { coalOM, complianceCoalOutput },
          effects: {
            operatingCostMultipliersByFuel: { Coal: coalOM },
            facilityOutputMultipliersByFuel: {
              Coal: complianceCoalOutput,
            },
          },
          turningPointPriority: 100,
        };
      },
    },
    {
      id: "successor-review",
      schedule: { atMonth: 216 },
      preview: () => ({
        title: "Transition review ahead",
        message: "Assessing the move away from coal.",
      }),
      describe: ({ snapshot }) => {
        const coalShare = share(
          snapshot.deliveredWhByFuel12m.Coal || 0,
          snapshot.demandWh12m,
        );
        const reliability = reliabilityOf(
          snapshot.demandWh12m,
          snapshot.unservedWh12m,
        );
        const legacyCoalW = snapshot.facilities
          .filter(
            (facility) =>
              facility.fuel === "Coal" &&
              facility.operational &&
              facility.ageYears >= 30,
          )
          .reduce((total, facility) => total + facility.peakW, 0);
        const allCoalW = snapshot.facilities
          .filter(
            (facility) => facility.fuel === "Coal" && facility.operational,
          )
          .reduce((total, facility) => total + facility.peakW, 0);
        const nonCoalFirmW = Math.max(0, snapshot.firmPeakW - allCoalW);
        return {
          title: "New-grid check-in",
          message:
            reliability >= 0.999 && snapshot.netIncome12m > 0 && coalShare < 0.5
              ? `Coal supplied ${percent(coalShare)} of last year's power. Your grid stayed reliable and profitable.`
              : `Coal supplied ${percent(coalShare)} of last year's power. The grid met ${percent(reliability)} of demand at a ${snapshot.netIncome12m >= 0 ? "profit" : "loss"}.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "ROUTINE",
          actionTarget: FLEET_TARGET,
          attributes: {
            coalShare,
            reliability,
            netIncome: snapshot.netIncome12m,
            legacyCoalW,
            nonCoalFirmW,
          },
          turningPointPriority: 95,
        };
      },
    },
  ],
};

export function winterizationCost(difficulty: DifficultyType): number {
  return WINTERIZATION_COST[difficulty];
}
export function deepFreezeWinterized(
  occurrences?: ActiveWorldEventType[],
): boolean {
  return (
    occurrences?.some(
      (event) =>
        event.key === DEEP_FREEZE_DECISION_KEY &&
        event.attributes.choice === "winterize",
    ) ?? false
  );
}

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

/**
 * Austin-scale simulation of ERCOT-wide Winter Storm Uri conditions. The demand and availability
 * ratios are system abstractions from FERC/NERC actual-versus-forecast output, not outage claims
 * about named Austin Energy plants. Wind uses this one explicit availability adjustment; no icing
 * derate is applied elsewhere, and solar follows only the event weather.
 */
const TEXAS_DEEP_FREEZE_ARC: StoryArcDefinitionType = {
  id: "texas-deep-freeze",
  scenarioId: 107,
  phases: [
    {
      id: "uri",
      // January 2017 is month zero, so February 2021 is month 49.
      schedule: { atMonth: 49 },
      durationMonths: 1,
      preview: () => ({
        title: "Deep freeze straining supply",
        message: "Demand rising as plant output falls and gas prices climb.",
      }),
      describe: ({ difficulty, occurrences }) => {
        const winterized = deepFreezeWinterized(occurrences);
        const protectedOutput = (normal: number) =>
          winterized ? (1 + normal) / 2 : normal;
        const demandMultiplier = TEXAS_DEEP_FREEZE_DEMAND[difficulty];
        return {
          title: "The deep freeze",
          message: `Cold strains power supplies across Texas: demand is up ${Math.round((demandMultiplier - 1) * 100)}%, plant output falls and gas prices spike.${winterized ? " Your funded winterization halves output losses." : ""}`,
          concept: "blackout",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: { card: "FACILITIES", view: "FLEET" },
          effects: {
            // Calibrated against the fixed scenario seed so the representative February day
            // reaches approximately 6°F (-14.4°C) for several game hours.
            temperatureOffsetC: -20,
            demandMultiplier,
            fuelPriceMultipliers: { "Natural Gas": 2.8 },
            facilityOutputMultipliersByFuel: {
              "Natural Gas": protectedOutput(0.62),
              Coal: protectedOutput(0.73),
              Uranium: protectedOutput(0.77),
              Wind: protectedOutput(0.44),
            },
          },
          turningPointPriority: 110,
        };
      },
    },
    {
      id: "thaw",
      schedule: { atMonth: 50 },
      preview: () => ({
        title: "Freeze ending",
        message:
          "Normal plant output and gas prices returning as the cold eases.",
      }),
      describe: ({ periodSnapshots, occurrences }) => {
        const event = periodSnapshots?.[1];
        const unservedWh = event?.unservedWh || 0;
        const preparation = deepFreezeWinterized(occurrences)
          ? "Winterization halved output losses. "
          : "";
        return {
          title: "The thaw",
          message:
            event === undefined
              ? "The freeze ends next month. Plant output and gas prices return to normal."
              : unservedWh > 0
                ? `${preparation}The freeze ends. Recovery follows blackouts.`
                : `${preparation}The freeze ends with every customer supplied.`,
          concept: "weather",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: { card: "INSIGHTS" },
          turningPointPriority: 105,
        };
      },
    },
  ],
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

const HEATWAVE_DROUGHT_ARC: StoryArcDefinitionType = {
  id: "heatwave-drought",
  scenarioId: 108,
  phases: [
    {
      id: "seasonal-warning",
      // 23 months before the heat: time enough for a battery at any difficulty
      schedule: { atMonth: 6 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "A hot, dry summer ahead",
        message: `June–August 2026 heat raising demand as drought cuts hydro and nuclear output. Build generation and storage. ${buildLeadTimeHint(difficulty)}`,
        concept: "forecast",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      }),
    },
    ...([29, 30, 31] as const).map((atMonth, index) => ({
      id: `heatwave-month-${index + 1}`,
      schedule: { atMonth },
      durationMonths: 1,
      preview: () => ({
        title: [
          "Heat building",
          "Rivers falling further",
          "Heat and drought peaking",
        ][index],
        message:
          index === 0
            ? "Heat raising demand as drought limits hydro and nuclear output."
            : index === 1
              ? "Drought tightening hydro and nuclear limits as demand rises further."
              : "Demand climbing further as hydro and nuclear output reach seasonal lows.",
      }),
      describe: ({ difficulty }: StoryContextType) => {
        const balance = HEATWAVE_DROUGHT_BALANCE[difficulty];
        const demandMultiplier = balance.demandMultipliers[index];
        const hydroRunoffMultiplier = balance.hydroRunoffMultipliers[index];
        const hydroOutputMultiplier = balance.hydroOutputMultipliers[index];
        const nuclearOutputMultiplier = balance.nuclearOutputMultipliers[index];
        return {
          title:
            index === 0
              ? "Heatwave begins"
              : index === 1
                ? "Rivers keep falling"
                : "Peak heat and drought",
          message: `Demand is up ${Math.round((demandMultiplier - 1) * 100)}%. Hydro output is down to ${Math.round(hydroOutputMultiplier * 100)}%; nuclear to ${Math.round(nuclearOutputMultiplier * 100)}%.`,
          concept: "weather" as const,
          kind: "WORLD_EVENT" as const,
          importance:
            index === 2 ? ("CRITICAL" as const) : ("NOTABLE" as const),
          actionTarget: { card: "FACILITIES" as const, view: "FLEET" as const },
          effects: {
            temperatureOffsetC: 4 + index * 2,
            demandMultiplier,
            hydroRunoffMultiplier,
            facilityOutputMultipliersByFuel: {
              Hydro: hydroOutputMultiplier,
              Uranium: nuclearOutputMultiplier,
            },
          },
          turningPointPriority: 100 + index,
        };
      },
    })),
    {
      id: "cooler-weather",
      schedule: { atMonth: 32 },
      preview: () => ({
        title: "Heat easing",
        message:
          "Cooler weather lowering demand, with slower reservoir recovery.",
      }),
      describe: () => ({
        title: "The heat breaks",
        message:
          "Cooler weather lowers demand, but reservoirs will take time to recover.",
        concept: "weather",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS" },
      }),
    },
  ],
};

export interface CaliforniaWildfireBalanceType {
  disconnectedDemand: number;
  targetCapacityShare: number;
  outputMultiplier: number;
  restorationCostPerMonth: number;
}

// Restoration is an inferred damage-severity proxy, not a validated cost curve:
// LADWP's $78M electric restoration estimate × 1% municipal scale × 0.97436
// (2025 to 2024 dollars) gives about $760k at 2.2375% disconnected customers.
// Scale with the scenario's 2–10% severity, divide over January/February, and round.
// See src/testing/SCENARIO_CHOICE_BALANCE.md; advance preparation remains separate.
export const CALIFORNIA_WILDFIRE_BALANCE: Record<
  DifficultyType,
  CaliforniaWildfireBalanceType
> = {
  Intern: {
    disconnectedDemand: 0.02,
    targetCapacityShare: 0.3,
    outputMultiplier: 0.65,
    restorationCostPerMonth: 350000,
  },
  Employee: {
    disconnectedDemand: 0.04,
    targetCapacityShare: 0.4,
    outputMultiplier: 0.55,
    restorationCostPerMonth: 700000,
  },
  Manager: {
    disconnectedDemand: 0.06,
    targetCapacityShare: 0.5,
    outputMultiplier: 0.45,
    restorationCostPerMonth: 1000000,
  },
  VP: {
    disconnectedDemand: 0.08,
    targetCapacityShare: 0.6,
    outputMultiplier: 0.35,
    restorationCostPerMonth: 1350000,
  },
  CEO: {
    disconnectedDemand: 0.1,
    targetCapacityShare: 0.7,
    outputMultiplier: 0.25,
    restorationCostPerMonth: 1700000,
  },
};

export function wildfirePrepared(
  occurrences?: ActiveWorldEventType[],
): boolean {
  return (
    occurrences?.some(
      (event) =>
        event.key === WILDFIRE_DECISION_KEY &&
        event.attributes.choice === "prepare",
    ) ?? false
  );
}
export function wildfirePreparationCost(_difficulty: DifficultyType): number {
  return WILDFIRE_PREPARATION_COST;
}

const CALIFORNIA_WILDFIRE_ARC: StoryArcDefinitionType = {
  id: "california-wildfire-2025",
  scenarioId: 111,
  phases: [
    {
      id: "red-flag-warning",
      schedule: { atMonth: 11 },
      preview: () => null,
      describe: () => ({
        title: "Red-flag warning",
        message:
          "Extreme Santa Ana winds forecast for January. Fund preparedness or keep cash; choose to resume.",
        concept: "forecast",
        kind: "WORLD_EVENT",
        importance: "CRITICAL",
        actionTarget: { card: "EVENTS" },
      }),
    },
    {
      id: "firestorm",
      schedule: { atMonth: 12 },
      durationMonths: 2,
      preview: (context) => ({
        title: "Wildfires may disrupt power",
        message: wildfirePrepared(context.occurrences)
          ? "Safety shutoffs may disrupt supply, with prepared crews reducing generation losses."
          : "Extreme fire weather may force safety shutoffs and limit generation.",
      }),
      describe: (context, random) => {
        const original = CALIFORNIA_WILDFIRE_BALANCE[context.difficulty];
        const prepared = wildfirePrepared(context.occurrences);
        const balance = {
          ...original,
          disconnectedDemand:
            original.disconnectedDemand * (prepared ? 0.5 : 1),
          outputMultiplier: prepared
            ? (1 + original.outputMultiplier) / 2
            : original.outputMultiplier,
        };
        const candidates = context.snapshot.facilities
          .filter((facility) => facility.operational && !!facility.fuel)
          .map((facility) => ({
            ...facility,
            score: random(`facility|${facility.id}`),
          }))
          .sort((a, b) => a.score - b.score || a.id - b.id);
        const totalPeakW = candidates.reduce(
          (total, facility) => total + facility.peakW,
          0,
        );
        const targetPeakW = totalPeakW * balance.targetCapacityShare;
        const selected: typeof candidates = [];
        let selectedPeakW = 0;
        for (const candidate of candidates) {
          if (selectedPeakW >= targetPeakW) {
            break;
          }
          selected.push(candidate);
          selectedPeakW += candidate.peakW;
        }
        const outputMultipliers = Object.fromEntries(
          selected.map((facility) => [
            String(facility.id),
            balance.outputMultiplier,
          ]),
        );
        const selectedNames = selected.map((facility) => facility.name);
        const affectedFacilities = selectedNames.length
          ? selectedNames.join(", ")
          : "No operating generators are affected";
        return {
          title: "Wildfire emergency",
          message: `${prepared ? "Prepared crews are in place. " : "Standard response is in place. "}${Math.round(balance.disconnectedDemand * 100)}% of customer demand is disconnected. ${affectedFacilities}${selectedNames.length ? `: output is down to ${percent(balance.outputMultiplier)}` : ""}. Repairs cost $${balance.restorationCostPerMonth / 1000000}M/month through February.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: FLEET_TARGET,
          attributes: {
            prepared,
            disconnectedDemand: balance.disconnectedDemand,
            targetCapacityShare: balance.targetCapacityShare,
            selectedCapacityShare: share(selectedPeakW, totalPeakW),
            selectedFacilityIds: selected.map((facility) => facility.id),
            selectedFacilityNames: selectedNames,
            outputMultiplier: balance.outputMultiplier,
            restorationCostPerMonth: balance.restorationCostPerMonth,
          },
          effects: {
            demandMultiplier: 1 - balance.disconnectedDemand,
            facilityOutputMultipliersById: outputMultipliers,
            operatingExpensePerMonth: balance.restorationCostPerMonth,
          },
          turningPointPriority: 120,
        };
      },
    },
    {
      id: "restoration-complete",
      schedule: { atMonth: 14 },
      preview: () => null,
      describe: (context) => {
        const period = context.periodSnapshots?.[2];
        const demandWh = period?.demandWh || context.snapshot.demandWh12m;
        const unservedWh = period?.unservedWh || context.snapshot.unservedWh12m;
        const reliability = reliabilityOf(demandWh, unservedWh);
        const onset = context.occurrences?.find(
          (event) =>
            event.key === "story:111:california-wildfire-2025:firestorm",
        );
        const selectedNames = (onset?.attributes.selectedFacilityNames ||
          []) as string[];
        return {
          title: "Wildfire restoration complete",
          message: `${wildfirePrepared(context.occurrences) ? "Your funded preparedness halved disconnections and output losses. " : ""}Safety shutoffs end and ${selectedNames.length ? selectedNames.join(", ") : "affected generators"} return to normal. The grid met ${percent(reliability)} of connected demand.`,
          concept: "supply",
          kind: "WORLD_EVENT",
          importance: unservedWh > demandWh * 0.001 ? "NOTABLE" : "ROUTINE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: { demandWh, unservedWh, reliability },
          turningPointPriority: 110,
        };
      },
    },
  ],
};

const NUCLEAR_TRIP_ARC: StoryArcDefinitionType = {
  id: "nuclear-trip",
  scenarioId: 110,
  phases: [
    {
      id: "contingency-review",
      // The trip is seeded in months 30-36; reviewing in the first month leaves time to build
      schedule: { atMonth: 1 },
      preview: () => null,
      describe: ({ difficulty }) => ({
        title: "Backup-power review",
        message: `Your largest reactor may shut down between July 2026 and January 2027. Build backup power. ${buildLeadTimeHint(difficulty)}`,
        concept: "danger",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
      }),
    },
    {
      id: "trip",
      schedule: {
        seededMonthRange: { firstMonth: 30, lastMonth: 36 },
        randomKey: "largest-unit-trip",
      },
      forecastable: false,
      durationMonths: 48,
      preview: () => null,
      describe: ({ snapshot }) => {
        const unit = snapshot.facilities.find(
          (facility) => facility.name === "Grand Nuclear Unit",
        );
        const facilityOutputMultipliersById = unit
          ? { [String(unit.id)]: 0 }
          : {};
        return {
          title: "Grand Nuclear Unit shuts down",
          message:
            "Your largest generator is offline for the rest of the mission. Replace its power with backup generation and storage.",
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: { card: "FACILITIES", view: "FLEET" },
          attributes: {
            selectedFacilityIds: unit ? [unit.id] : [],
            selectedFacilityNames: unit ? [unit.name] : [],
          },
          effects: { facilityOutputMultipliersById },
          turningPointPriority: 120,
        };
      },
    },
  ],
};

export interface LoadSheddingBalanceType {
  /** Share of nominal coal output still available, year by year from 2019 to 2022. */
  coalOutputMultipliers: [number, number, number, number];
  /** Coal operating cost, which rises with the breakdowns and the running repairs. */
  coalOperatingMultipliers: [number, number, number, number];
  /** Diesel is what covers the gap, and it is bought at short notice. */
  dieselPriceMultipliers: [number, number, number, number];
}

// Eskom's energy availability factor fell from 78% in 2018 to about 58% in 2022, with unplanned
// outages roughly doubling over the same period. These multiply nameplate output, so Employee is
// set to the published EAF itself - 67, 65, 62 and 58 percent - and the other difficulties sit
// either side of the record. Anything shallower leaves the fleet able to carry the load on its
// own, which is the one thing the years these steps describe were not.
// https://www.eskom.co.za/dataportal/supply-side/eaf-weekly-data/
export const LOAD_SHEDDING_BALANCE: Record<
  DifficultyType,
  LoadSheddingBalanceType
> = {
  Intern: {
    coalOutputMultipliers: [0.74, 0.72, 0.7, 0.68],
    coalOperatingMultipliers: [1.05, 1.1, 1.15, 1.2],
    dieselPriceMultipliers: [1.05, 1.1, 1.15, 1.2],
  },
  Employee: {
    coalOutputMultipliers: [0.67, 0.65, 0.62, 0.58],
    coalOperatingMultipliers: [1.08, 1.16, 1.24, 1.32],
    dieselPriceMultipliers: [1.1, 1.2, 1.3, 1.4],
  },
  Manager: {
    coalOutputMultipliers: [0.64, 0.61, 0.57, 0.53],
    coalOperatingMultipliers: [1.1, 1.2, 1.3, 1.45],
    dieselPriceMultipliers: [1.15, 1.3, 1.45, 1.6],
  },
  VP: {
    coalOutputMultipliers: [0.61, 0.57, 0.52, 0.47],
    coalOperatingMultipliers: [1.12, 1.26, 1.4, 1.55],
    dieselPriceMultipliers: [1.2, 1.4, 1.6, 1.8],
  },
  CEO: {
    coalOutputMultipliers: [0.58, 0.53, 0.47, 0.42],
    coalOperatingMultipliers: [1.15, 1.32, 1.5, 1.7],
    dieselPriceMultipliers: [1.25, 1.5, 1.75, 2],
  },
};

const LOAD_SHEDDING_ARC: StoryArcDefinitionType = {
  id: "load-shedding",
  scenarioId: 113,
  phases: [
    {
      id: "maintenance-backlog",
      schedule: { atMonth: 6 },
      preview: () => null,
      describe: () => ({
        title: "The maintenance backlog is growing",
        message:
          "Coal output falling each year. Build replacement capacity before shortages begin.",
        concept: "forecast",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      }),
    },
    ...([12, 24, 36, 48] as const).map((atMonth, index) => ({
      id: `availability-step-${index + 1}`,
      schedule: { atMonth },
      durationMonths: 12,
      preview: () => ({
        title: [
          "Breakdowns outpacing repairs",
          "Another station facing output limits",
          "Fleet reliability declining further",
          "Coal availability reaching a low",
        ][index],
        message:
          index === 0
            ? "Coal output decreasing."
            : "Coal output decreasing further.",
      }),
      describe: ({ difficulty }: StoryContextType) => {
        const balance = LOAD_SHEDDING_BALANCE[difficulty];
        const output = balance.coalOutputMultipliers[index];
        const operating = balance.coalOperatingMultipliers[index];
        const diesel = balance.dieselPriceMultipliers[index];
        return {
          title: [
            "Breakdowns outpace repairs",
            "Another station derated",
            "The fleet is running on borrowed time",
            "Availability at its lowest",
          ][index],
          message: `Coal output is down to ${Math.round(output * 100)}%.`,
          concept: "fuel" as const,
          kind: "WORLD_EVENT" as const,
          importance: index >= 2 ? ("CRITICAL" as const) : ("NOTABLE" as const),
          actionTarget: { card: "FACILITIES" as const, view: "FLEET" as const },
          effects: {
            facilityOutputMultipliersByFuel: { Coal: output },
            operatingCostMultipliersByFuel: { Coal: operating },
            fuelPriceMultipliers: { Oil: diesel },
          },
          turningPointPriority: 100 + index,
        };
      },
    })),
  ],
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

const KARIBA_DROUGHT_ARC: StoryArcDefinitionType = {
  id: "kariba-drought",
  scenarioId: 114,
  phases: [
    {
      id: "poor-rains-forecast",
      schedule: { atMonth: 8 },
      preview: () => null,
      describe: () => ({
        title: "Weak rainy season forecast",
        message:
          "El Niño may reduce reservoir inflow in 2015–2016. Nearly all your power depends on this water.",
        concept: "forecast",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      }),
    },
    // Continuous cover from the first failed season to the end of the run. A gap here would hand
    // the lake a spell of undiminished inflow in the middle of the drought - and, worse, leave
    // the recovery step reading as a step down from the months before it.
    ...([12, 18, 24, 36] as const).map((atMonth, index) => ({
      id: `reservoir-step-${index + 1}`,
      schedule: { atMonth },
      durationMonths: index >= 2 ? 12 : 6,
      preview: () => ({
        title: [
          "Rains falling short",
          "Lake levels dropping further",
          "Kariba approaching its minimum",
          "Rains returning",
        ][index],
        message:
          index === 3
            ? "Better rains increasing inflow and helping hydro output recover."
            : index === 0
              ? "Poor rains reducing reservoir inflow and hydro output."
              : "Reservoir inflow and hydro output decreasing further.",
      }),
      describe: ({ difficulty }: StoryContextType) => {
        const balance = KARIBA_DROUGHT_BALANCE[difficulty];
        const runoff = balance.hydroRunoffMultipliers[index];
        const output = balance.hydroOutputMultipliers[index];
        return {
          title: [
            "The rains came up short",
            "The lake keeps dropping",
            "Kariba near its minimum",
            "The rains return",
          ][index],
          message:
            index === 3
              ? `Hydro output recovers to ${Math.round(output * 100)}%; inflow rises to ${Math.round(runoff * 100)}%.`
              : `Hydro output is down to ${Math.round(output * 100)}%; inflow is at ${Math.round(runoff * 100)}%.`,
          concept: "weather" as const,
          kind: "WORLD_EVENT" as const,
          importance:
            index === 2 ? ("CRITICAL" as const) : ("NOTABLE" as const),
          actionTarget: { card: "FACILITIES" as const, view: "FLEET" as const },
          effects: {
            hydroRunoffMultiplier: runoff,
            facilityOutputMultipliersByFuel: { Hydro: output },
          },
          turningPointPriority: 100 + index,
        };
      },
    })),
  ],
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

const DELHI_SUMMER_ARC: StoryArcDefinitionType = {
  id: "delhi-summer",
  scenarioId: 115,
  phases: [
    {
      id: "summer-outlook",
      schedule: { atMonth: 2 },
      preview: () => null,
      describe: () => ({
        title: "A hotter summer than the last",
        message:
          "Pre-monsoon demand peaks rise each year as heat cuts coal and gas output. Build for the peak, not the average.",
        concept: "forecast",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
      }),
    },
    ...([4, 16, 28, 40] as const).map((atMonth, index) => ({
      id: `summer-peak-${index + 1}`,
      schedule: { atMonth },
      durationMonths: 3,
      preview: () => ({
        title: [
          "Summer heat raising demand",
          "Hotter summer straining supply",
          "Summer demand climbing further",
          "Summer demand may reach a record",
        ][index],
        message:
          index === 0
            ? "Heat raising demand and reducing coal and gas output."
            : "Summer demand rising further as heat tightens coal and gas output limits.",
      }),
      describe: ({ difficulty }: StoryContextType) => {
        const balance = DELHI_SUMMER_BALANCE[difficulty];
        const demand = balance.demandMultipliers[index];
        const thermal = balance.thermalOutputMultipliers[index];
        return {
          title: [
            "The 2021 pre-monsoon heat",
            "A longer, hotter 2022",
            "2023 sets a new peak",
            "The record summer",
          ][index],
          message: `Demand is up ${Math.round((demand - 1) * 100)}%; coal and gas output is down to ${Math.round(thermal * 100)}%.`,
          concept: "weather" as const,
          kind: "WORLD_EVENT" as const,
          importance:
            index === 3 ? ("CRITICAL" as const) : ("NOTABLE" as const),
          actionTarget: { card: "FACILITIES" as const, view: "FLEET" as const },
          effects: {
            temperatureOffsetC: balance.temperatureOffsetC[index],
            demandMultiplier: demand,
            facilityOutputMultipliersByFuel: {
              Coal: thermal,
              "Natural Gas": thermal,
            },
          },
          turningPointPriority: 100 + index,
        };
      },
    })),
  ],
};

export const STORY_ARC_DEFINITIONS: StoryArcDefinitionType[] = [
  CARBON_FEE_ARC,
  RENEWABLES_ARC,
  END_OF_ERA_ARC,
  SHALE_BOOM_ARC,
  HURRICANE_ARC,
  PARADISE_ARC,
  TEXAS_DEEP_FREEZE_ARC,
  HEATWAVE_DROUGHT_ARC,
  NUCLEAR_TRIP_ARC,
  CALIFORNIA_WILDFIRE_ARC,
  LOAD_SHEDDING_ARC,
  KARIBA_DROUGHT_ARC,
  DELHI_SUMMER_ARC,
];

/** Content-level difficulty scaling is centralized and mechanically checkable. */
export function validateStoryDifficultyMonotonicity(): string[] {
  const problems: string[] = [];
  const ascending = (name: string, values: number[]) => {
    if (values.some((value, index) => index > 0 && value < values[index - 1])) {
      problems.push(`${name} must not decrease from Intern to CEO`);
    }
  };
  const descending = (name: string, values: number[]) => {
    if (values.some((value, index) => index > 0 && value > values[index - 1])) {
      problems.push(`${name} must not increase from Intern to CEO`);
    }
  };
  ascending(
    "Carbon fee",
    DIFFICULTY_ORDER.map((difficulty) => CARBON_FEE_BALANCE[difficulty]),
  );
  ascending(
    "Shale boom price",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier,
    ),
  );
  ascending(
    "Shale freeze surcharge",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeSurcharge,
    ),
  );
  descending(
    "Shale freeze output",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeGasOutput,
    ),
  );
  ascending(
    "Paradise visitor demand",
    DIFFICULTY_ORDER.map(
      (difficulty) => PARADISE_BALANCE[difficulty].visitorDemand,
    ),
  );
  ascending(
    "Paradise oil shock",
    DIFFICULTY_ORDER.map((difficulty) => PARADISE_BALANCE[difficulty].oilShock),
  );
  ascending(
    "Renewables bridge gas cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].bridgeGasBuildCost,
    ),
  );
  ascending(
    "Renewables solar cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].solarBuildCost,
    ),
  );
  ascending(
    "Renewables wind cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].windBuildCost,
    ),
  );
  ascending(
    "Renewables demand",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].demandLoad,
    ),
  );
  ascending(
    "Texas deep freeze demand",
    DIFFICULTY_ORDER.map((difficulty) => TEXAS_DEEP_FREEZE_DEMAND[difficulty]),
  );
  ([0, 1, 2] as const).forEach((month) => {
    ascending(
      `Heatwave month ${month + 1} demand`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].demandMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} hydro runoff`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} hydro output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} nuclear output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].nuclearOutputMultipliers[month],
      ),
    );
  });
  ascending(
    "Hurricane affected capacity",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].targetCapacityShare,
    ),
  );
  descending(
    "Hurricane output",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].outputMultiplier,
    ),
  );
  ascending(
    "Hurricane duration",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].durationMonths,
    ),
  );
  ascending(
    "Hurricane oil",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].oilMultiplier,
    ),
  );
  descending(
    "Old coal output",
    DIFFICULTY_ORDER.map(
      (difficulty) => END_OF_ERA_BALANCE[difficulty].oldCoalOutput,
    ),
  );
  ascending(
    "Coal O&M",
    DIFFICULTY_ORDER.map((difficulty) => END_OF_ERA_BALANCE[difficulty].coalOM),
  );
  descending(
    "Compliance coal output",
    DIFFICULTY_ORDER.map(
      (difficulty) => END_OF_ERA_BALANCE[difficulty].complianceCoalOutput,
    ),
  );
  ascending(
    "California wildfire disconnected demand",
    DIFFICULTY_ORDER.map(
      (difficulty) =>
        CALIFORNIA_WILDFIRE_BALANCE[difficulty].disconnectedDemand,
    ),
  );
  ascending(
    "California wildfire affected capacity",
    DIFFICULTY_ORDER.map(
      (difficulty) =>
        CALIFORNIA_WILDFIRE_BALANCE[difficulty].targetCapacityShare,
    ),
  );
  descending(
    "California wildfire output",
    DIFFICULTY_ORDER.map(
      (difficulty) => CALIFORNIA_WILDFIRE_BALANCE[difficulty].outputMultiplier,
    ),
  );
  ascending(
    "California wildfire restoration cost",
    DIFFICULTY_ORDER.map(
      (difficulty) =>
        CALIFORNIA_WILDFIRE_BALANCE[difficulty].restorationCostPerMonth,
    ),
  );
  ([0, 1, 2, 3] as const).forEach((step) => {
    descending(
      `Load shedding step ${step + 1} coal output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].coalOutputMultipliers[step],
      ),
    );
    ascending(
      `Load shedding step ${step + 1} coal operating cost`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].coalOperatingMultipliers[step],
      ),
    );
    ascending(
      `Load shedding step ${step + 1} diesel price`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].dieselPriceMultipliers[step],
      ),
    );
    descending(
      `Kariba step ${step + 1} runoff`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          KARIBA_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[step],
      ),
    );
    descending(
      `Kariba step ${step + 1} hydro output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          KARIBA_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[step],
      ),
    );
  });
  ([0, 1, 2, 3] as const).forEach((summer) => {
    ascending(
      `Delhi summer ${summer + 1} demand`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].demandMultipliers[summer],
      ),
    );
    descending(
      `Delhi summer ${summer + 1} thermal output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].thermalOutputMultipliers[summer],
      ),
    );
    ascending(
      `Delhi summer ${summer + 1} temperature`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].temperatureOffsetC[summer],
      ),
    );
  });
  return problems;
}

/** Stable 32-bit address for a string, independent of definition and facility array order. */
export function storyHash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result | 0;
}

export function storyPhaseKey(
  scenarioId: number,
  arcId: string,
  phaseId: string,
): string {
  return `story:${scenarioId}:${arcId}:${phaseId}`;
}

export function resolveStoryScheduleMonth(
  schedule: StoryScheduleType,
  seed: number,
  stableKey: string,
): number {
  if ("atMonth" in schedule) {
    return schedule.atMonth;
  }
  const { firstMonth, lastMonth } = schedule.seededMonthRange;
  if (lastMonth < firstMonth) {
    throw new Error(`Invalid seeded story schedule for ${stableKey}`);
  }
  const count = lastMonth - firstMonth + 1;
  return (
    firstMonth +
    Math.floor(
      randomAt(
        seed,
        RANDOM_STREAM.worldEvents,
        storyHash(`${stableKey}|${schedule.randomKey}`),
      ) * count,
    )
  );
}

function multiplyEffects<T extends Partial<Record<string, number>>>(
  target: T | undefined,
  source: T | undefined,
): T | undefined {
  if (!source) {
    return target;
  }
  const result = (target || {}) as T;
  Object.entries(source).forEach(([key, multiplier]) => {
    if (multiplier !== undefined) {
      result[key as keyof T] = ((result[key] ?? 1) * multiplier) as T[keyof T];
    }
  });
  return result;
}

/** Explicit composition semantics shared by persisted live occurrences and forecast resolution. */
export function combineStoryEffects(
  occurrences: Array<{ effects: WorldEventEffectsType }>,
): WorldEventEffectsType {
  const combined: WorldEventEffectsType = {};
  occurrences.forEach(({ effects }) => {
    combined.temperatureOffsetC =
      (combined.temperatureOffsetC || 0) + (effects.temperatureOffsetC || 0);
    combined.demandMultiplier =
      (combined.demandMultiplier || 1) * (effects.demandMultiplier || 1);
    if (
      combined.hydroRunoffMultiplier !== undefined ||
      effects.hydroRunoffMultiplier !== undefined
    ) {
      combined.hydroRunoffMultiplier =
        (combined.hydroRunoffMultiplier ?? 1) *
        (effects.hydroRunoffMultiplier ?? 1);
    }
    const fuelPriceMultipliers = multiplyEffects(
      combined.fuelPriceMultipliers,
      effects.fuelPriceMultipliers,
    );
    if (fuelPriceMultipliers !== undefined) {
      combined.fuelPriceMultipliers = fuelPriceMultipliers;
    }
    const buildCostMultipliersByFuel = multiplyEffects(
      combined.buildCostMultipliersByFuel,
      effects.buildCostMultipliersByFuel,
    );
    if (buildCostMultipliersByFuel !== undefined) {
      combined.buildCostMultipliersByFuel = buildCostMultipliersByFuel;
    }
    const operatingCostMultipliersByFuel = multiplyEffects(
      combined.operatingCostMultipliersByFuel,
      effects.operatingCostMultipliersByFuel,
    );
    if (operatingCostMultipliersByFuel !== undefined) {
      combined.operatingCostMultipliersByFuel = operatingCostMultipliersByFuel;
    }
    if (
      combined.operatingExpensePerMonth !== undefined ||
      effects.operatingExpensePerMonth !== undefined
    ) {
      combined.operatingExpensePerMonth =
        (combined.operatingExpensePerMonth || 0) +
        (effects.operatingExpensePerMonth || 0);
    }
    const facilityOutputMultipliersByFuel = multiplyEffects(
      combined.facilityOutputMultipliersByFuel,
      effects.facilityOutputMultipliersByFuel,
    );
    if (facilityOutputMultipliersByFuel !== undefined) {
      combined.facilityOutputMultipliersByFuel =
        facilityOutputMultipliersByFuel;
    }
    const facilityOutputMultipliersById = multiplyEffects(
      combined.facilityOutputMultipliersById,
      effects.facilityOutputMultipliersById,
    );
    if (facilityOutputMultipliersById !== undefined) {
      combined.facilityOutputMultipliersById = facilityOutputMultipliersById;
    }
    if (effects.carbonFeePerKgCO2e !== undefined) {
      if (
        combined.carbonFeePerKgCO2e !== undefined &&
        combined.carbonFeePerKgCO2e !== effects.carbonFeePerKgCO2e
      ) {
        throw new Error("Overlapping story carbon-fee overrides");
      }
      combined.carbonFeePerKgCO2e = effects.carbonFeePerKgCO2e;
    }
  });
  return combined;
}

export function resolveStoryPhase(
  arc: StoryArcDefinitionType,
  phase: StoryPhaseDefinitionType,
  context: StoryContextType,
): ActiveWorldEventType & StoryPhaseDescriptionType {
  const key = storyPhaseKey(arc.scenarioId, arc.id, phase.id);
  const { scheduledMonth, durationMonths } = resolvePhaseTiming(
    arc,
    phase,
    context,
  );
  const random = (attribute: string) =>
    randomAt(
      context.seed,
      RANDOM_STREAM.worldEvents,
      storyHash(`${key}|${attribute}`),
    );
  let description = phase.describe(context, random);
  const imported =
    context.scenarioId === 999 &&
    context.customEvents?.find((event) => event.scenarioId === arc.scenarioId);
  if (imported) {
    const effects = { ...description.effects };
    if (arc.scenarioId === 111 && phase.id === "firestorm") {
      const effectiveness = wildfirePreparednessEffectiveness(
        context.occurrences || [],
        context.location.id,
        scheduledMonth * MINUTES_PER_MONTH,
      );
      effects.demandMultiplier =
        1 - (1 - (effects.demandMultiplier ?? 1)) * (1 - 0.5 * effectiveness);
      effects.facilityOutputMultipliersById = Object.fromEntries(
        Object.entries(effects.facilityOutputMultipliersById || {}).map(
          ([id, output]) => [id, 1 - (1 - output) * (1 - 0.5 * effectiveness)],
        ),
      );
      description.attributes = {
        ...description.attributes,
        preparednessEffectiveness: effectiveness,
        prepared: effectiveness > 0,
        disconnectedDemand: 1 - effects.demandMultiplier,
      };
    }
    if (effects.operatingExpensePerMonth !== undefined)
      effects.operatingExpensePerMonth *= imported.moneyScale;
    // Prices per unit and percentage shocks retain their meaning in the receiving market.
    // Fixed restoration budgets scale to grid size and era; source-city choices are not imported.
    const changes = scenarioEffectsSummary(effects);
    description = {
      ...description,
      effects,
      message: `${context.location.name}: ${changes.length ? changes.join("; ") + "." : "Review your supply and reserves before the upcoming scenario event."}`,
      actionTarget: { card: "FACILITIES", view: "FLEET" },
    };
    const eventYear =
      context.date.year -
      Math.floor(context.date.monthsElapsed / 12) +
      Math.floor(scheduledMonth / 12);
    description.title = description.title?.replace(
      /\b(?:19|20)\d{2}\b/g,
      String(eventYear),
    );
    if (phase.id === "trip") {
      const largest = context.snapshot.facilities
        .filter(
          (facility) => facility.operational && facility.fuel === "Uranium",
        )
        .sort((a, b) => b.peakW - a.peakW || a.id - b.id)[0];
      effects.facilityOutputMultipliersById = largest
        ? { [String(largest.id)]: 0 }
        : {};
      description.title = largest
        ? `${largest.name} shuts down`
        : "Nuclear shutdown: no operating reactor affected";
      description.message = largest
        ? `${largest.name} is offline for the rest of this event. Replace its output with generation, storage or imports.`
        : "Your grid has no operating nuclear reactor, so this shutdown causes no loss of supply.";
      description.attributes = {
        ...description.attributes,
        selectedFacilityIds: largest ? [largest.id] : [],
        selectedFacilityNames: largest ? [largest.name] : [],
      };
    }
  }
  const startsMinute = scheduledMonth * MINUTES_PER_MONTH;
  return {
    key,
    definitionId: `${arc.id}:${phase.id}`,
    startsMinute,
    endsMinute: startsMinute + durationMonths * MINUTES_PER_MONTH,
    forecastable: phase.forecastable,
    ...description,
    attributes: {
      scheduledMonth,
      ...(description.attributes || {}),
    },
    effects: description.effects || {},
  };
}

function resolvePhaseTiming(
  arc: StoryArcDefinitionType,
  phase: StoryPhaseDefinitionType,
  context: StoryContextType,
) {
  const key = storyPhaseKey(arc.scenarioId, arc.id, phase.id);
  const scheduleKey = phase.scheduleAddress
    ? storyPhaseKey(arc.scenarioId, arc.id, phase.scheduleAddress)
    : key;
  const offset =
    typeof phase.scheduleOffsetMonths === "function"
      ? phase.scheduleOffsetMonths(context)
      : phase.scheduleOffsetMonths || 0;
  const scheduledMonth = relocateOfficialArcMonth(
    arc.scenarioId,
    resolveStoryScheduleMonth(phase.schedule, context.seed, scheduleKey) +
      offset,
    "phase",
  );
  const durationMonths =
    typeof phase.durationMonths === "function"
      ? phase.durationMonths(context)
      : phase.durationMonths || 0;
  return { scheduledMonth, durationMonths };
}

/**
 * Pure story resolver used at both live monthly rollover and every date in a forecast. It never
 * mutates checked keys, occurrences, logs, snackbars, recovery state, facilities, or speed.
 */
export function resolveStoryAtDate(
  context: StoryContextType,
  definitions: StoryArcDefinitionType[] = STORY_ARC_DEFINITIONS,
): ResolvedStoryType {
  if (context.rules) {
    const resolved = resolveScenarioRuleEvents(context);
    return { ...resolved, effects: combineStoryEffects(resolved.active) };
  }
  const occurrences: ResolvedStoryType["occurrences"] = [];
  const active: ResolvedStoryType["active"] = [];
  definitions
    // This explicit equality is the scenario boundary. Custom games (id 999) cannot inherit
    // authored content by sharing a location or starting year with one of the scored scenarios.
    .filter(
      (arc) =>
        arc.scenarioId === context.scenarioId ||
        (context.scenarioId === 999 &&
          context.customEvents?.some(
            (event) => event.scenarioId === arc.scenarioId,
          )),
    )
    .flatMap((arc) => arc.phases.map((phase) => ({ arc, phase })))
    // Persisted occurrence order is part of save/replay determinism too, so content-file order is
    // not allowed to decide it.
    .sort((a, b) => {
      const first = storyPhaseKey(a.arc.scenarioId, a.arc.id, a.phase.id);
      const second = storyPhaseKey(b.arc.scenarioId, b.arc.id, b.phase.id);
      return first < second ? -1 : first > second ? 1 : 0;
    })
    .forEach(({ arc, phase }) => {
      const { scheduledMonth, durationMonths } = resolvePhaseTiming(
        arc,
        phase,
        context,
      );
      const occursNow = context.date.monthsElapsed === scheduledMonth;
      const activeNow =
        durationMonths > 0 &&
        context.date.monthsElapsed >= scheduledMonth &&
        context.date.monthsElapsed < scheduledMonth + durationMonths;
      if (!occursNow && !activeNow) {
        return;
      }
      const resolved = resolveStoryPhase(arc, phase, context);
      if (occursNow) {
        occurrences.push(resolved);
      }
      if (activeNow) {
        active.push(resolved);
      }
    });
  return { occurrences, active, effects: combineStoryEffects(active) };
}

/** Future authored phases for presentation only; these never participate in effect aggregation. */
export function upcomingStoryPhases(
  context: StoryContextType,
  definitions: StoryArcDefinitionType[] = STORY_ARC_DEFINITIONS,
): Array<ActiveWorldEventType & StoryPhaseDescriptionType> {
  if (context.rules) return upcomingScenarioRuleEvents(context);
  return definitions
    .filter(
      (arc) =>
        arc.scenarioId === context.scenarioId ||
        (context.scenarioId === 999 &&
          context.customEvents?.some(
            (event) => event.scenarioId === arc.scenarioId,
          )),
    )
    .flatMap((arc) =>
      arc.phases
        .filter((phase) => phase.forecastable !== false)
        .flatMap((phase) => {
          const resolved = resolveStoryPhase(arc, phase, context);
          const random = (attribute: string) =>
            randomAt(
              context.seed,
              RANDOM_STREAM.worldEvents,
              storyHash(`${resolved.key}|${attribute}`),
            );
          const preview = phase.preview(context, random);
          return preview
            ? [
                {
                  ...resolved,
                  title: preview.title,
                  message: preview.message,
                },
              ]
            : [];
        }),
    )
    .filter(
      (phase) =>
        (phase.attributes.scheduledMonth as number) >
        context.date.monthsElapsed,
    )
    .sort(
      (a, b) => a.startsMinute - b.startsMinute || a.key.localeCompare(b.key),
    );
}
