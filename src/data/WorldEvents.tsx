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
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { randomAt, RANDOM_STREAM } from "../helpers/Math";

export interface StoryContextType {
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
  details?: string;
  concept?: ConceptNameType;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
  attributes?: Record<string, StoryAttributeValueType>;
  effects?: WorldEventEffectsType;
  turningPointPriority?: number;
}

export interface StoryPhaseDefinitionType {
  id: string;
  schedule: StoryScheduleType;
  /** Zero (the default) logs a point-in-time phase without applying lasting effects. */
  durationMonths?: number | ((context: StoryContextType) => number);
  /** Allows linked seeded phases (for example landfall/restoration) to share one addressed draw. */
  scheduleAddress?: string;
  scheduleOffsetMonths?: number | ((context: StoryContextType) => number);
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
      describe: () => ({
        title: "Cheaper gas forecast",
        message: "Local gas prices are expected to fall in January 2010.",
        details: "Cheap gas may not last. Avoid relying on one fuel.",
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
      describe: ({ difficulty }) => {
        const { boomGasMultiplier } = SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Gas prices fall",
          message: `Natural gas prices fall ${Math.round((1 - boomGasMultiplier) * 100)}% through Feb 2016.`,
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
      describe: ({ difficulty }) => {
        const balance = SHALE_BOOM_BALANCE[difficulty];
        const effectiveMultiplier =
          balance.boomGasMultiplier * balance.freezeSurcharge;
        return {
          title: "Winter freeze",
          message: `The freeze has pushed gas prices ${Math.round(Math.abs(effectiveMultiplier - 1) * 100)}% ${effectiveMultiplier >= 1 ? "above" : "below"} normal and cut gas plants to ${Math.round(balance.freezeGasOutput * 100)}% output.`,
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
            ? "Gas prices return to normal, and your diverse grid stays reliable."
            : "Gas prices return to normal, exposing how much the grid still depends on gas.",
          details: `Last year, gas supplied ${percent(gasShare)} of power and the grid met ${percent(reliability)} of demand.`,
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
      describe: ({ difficulty }) => ({
        title: "Winter freeze ends",
        message: `Gas output is fully restored and prices return to the continuing ${Math.round((1 - SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier) * 100)}% shale discount.`,
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
      describe: ({ difficulty }) => {
        const feePerTon = CARBON_FEE_BALANCE[difficulty];
        return {
          title: "Higher pollution fee announced",
          message: `The pollution fee rises to $${feePerTon} per ton in January 2024.`,
          details: "Coal will feel the biggest cost increase.",
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
      describe: ({ difficulty }) => {
        const feePerTon = CARBON_FEE_BALANCE[difficulty];
        return {
          title: "Higher pollution fee begins",
          message: `Polluting plants now pay $${feePerTon} per ton through the end of the mission.`,
          details: "Coal and gas power now cost more to run.",
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
    {
      id: "transition-audit",
      schedule: { atMonth: 84 },
      describe: ({ snapshot }) => {
        const combustion = deliveredFrom(snapshot, [
          "Coal",
          "Natural Gas",
          "Oil",
          "Biomass",
        ]);
        const combustionShare = share(combustion, snapshot.demandWh12m);
        const unservedShare = share(
          snapshot.unservedWh12m,
          snapshot.demandWh12m,
        );
        const onTrack =
          unservedShare <= 0.001 &&
          combustionShare < 0.5 &&
          snapshot.netIncome12m > 0;
        return {
          title: "Clean-grid check-in",
          message: onTrack
            ? "Your cleaner grid is reliable and profitable."
            : "The transition is still falling short on clean power, reliability, or profit.",
          details: `Last year: ${percent(combustionShare)} fossil power, ${percent(1 - unservedShare)} of demand met, and a ${snapshot.netIncome12m >= 0 ? "profit" : "loss"}.`,
          concept: "goal",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: SUPPLY_DEMAND_TARGET,
          attributes: {
            combustionShare,
            reliability: 1 - unservedShare,
            netIncome: snapshot.netIncome12m,
          },
          turningPointPriority: 100,
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
      describe: ({ difficulty }) => ({
        title: "Visitor surge forecast",
        message: `Visitors are expected to raise electricity use ${Math.round((PARADISE_BALANCE[difficulty].visitorDemand - 1) * 100)}% from May 2006 through October 2007.`,
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
      describe: ({ difficulty }) => ({
        title: "Fuel delivery warning",
        message: `A late fuel shipment could raise oil prices ${Math.round((PARADISE_BALANCE[difficulty].oilShock - 1) * 100)}% this fall.`,
        details: "Prepare local power or reserves before September.",
        concept: "danger",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: FLEET_TARGET,
      }),
    },
    {
      id: "visitor-recovery",
      schedule: { atMonth: 46 },
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
              ? "The island stayed reliable while local sources supplied most power."
              : "The island still relies heavily on shipped fuel or has reliability problems.",
          details: `Last year, shipped fuels supplied ${percent(shippedShare)} of power and the grid met ${percent(reliability)} of demand.`,
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
      describe: () => ({
        title: "Fuel delivery restored",
        message: "Oil deliveries and prices return to normal after the delay.",
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
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Discounted gas plants",
          message: `New gas plants cost ${percent(balance.bridgeGasBuildCost)} of their normal price through the end of the mission.`,
          details: "Projects already being built keep their original price.",
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
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Cheaper solar and wind forecast",
          message: `Solar and wind prices will fall in January 2009 to ${percent(balance.solarBuildCost)} and ${percent(balance.windBuildCost)} of today's cost.`,
          details: "Projects already being built keep their original price.",
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
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Solar and wind prices fall",
          message: `New Solar costs ${Math.round((1 - balance.solarBuildCost) * 100)}% less and new Wind costs ${Math.round((1 - balance.windBuildCost) * 100)}% less through mission end.`,
          details: "The discount applies to new projects only.",
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
      describe: ({ difficulty }) => ({
        title: "Factory growth forecast",
        message: `New factories are expected to raise electricity use ${Math.round((RENEWABLES_BALANCE[difficulty].demandLoad - 1) * 100)}% from 2012 through 2013.`,
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
              ? "Clean power grew while backup plants and storage kept the grid reliable."
              : "Clean power has grown faster than the backup needed for peak demand.",
          details: `Last year, wind and solar supplied ${percent(variableShare)} of power and the grid met ${percent(reliability)} of demand.`,
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
      schedule: { atMonth: 96 },
      describe: ({ difficulty }) => {
        const balance = HURRICANE_BALANCE[difficulty];
        return {
          title: "2008 hurricane forecast",
          message: `A ${balance.severity.toLowerCase()} hurricane may cut output at several plants for ${balance.durationMonths} months.`,
          details: `Oil prices could rise ${Math.round((balance.oilMultiplier - 1) * 100)}%. Add backup power and storage.`,
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
              ? `${selectedNames.join(", ")} ${selectedNames.length === 1 ? "is" : "are"} running at ${percent(balance.outputMultiplier)} output until repairs finish.`
              : `No plant is operating, but oil prices still rise ${Math.round((balance.oilMultiplier - 1) * 100)}%.`,
          details: `Oil prices are up ${Math.round((balance.oilMultiplier - 1) * 100)}%. Storage remains available.`,
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
          message: `${selectedNames.length ? `${selectedNames.join(", ")} restored. ` : "Plant output restored. "}The grid met ${percent(reliability)} of demand during the storm.`,
          details: "Oil prices have returned to normal.",
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
      describe: ({ snapshot, difficulty }) => {
        const selected = snapshot.facilities.filter(
          (facility) => facility.fuel === "Coal" && facility.ageYears + 2 >= 30,
        );
        return {
          title: "Aging coal warning",
          message: `${selected.length} coal ${selected.length === 1 ? "plant will" : "plants will"} be at least 30 years old by January 1986.`,
          details: `Their output will drop to ${percent(END_OF_ERA_BALANCE[difficulty].oldCoalOutput)} for two years.`,
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
          message: `${selected.length} aging coal ${selected.length === 1 ? "plant is" : "plants are"} limited to ${percent(outputMultiplier)} output through December 1987.`,
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
      describe: ({ difficulty }) => ({
        title: "New coal rules announced",
        message: `Coal operating costs will rise ${Math.round((END_OF_ERA_BALANCE[difficulty].coalOM - 1) * 100)}% in January 1995.`,
        details: "Both old and new coal plants will cost more to run.",
        concept: "danger",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: GENERATOR_TARGET,
      }),
    },
    {
      id: "aging-restoration",
      schedule: { atMonth: 96 },
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
      describe: ({ difficulty }) => {
        const { coalOM, complianceCoalOutput } = END_OF_ERA_BALANCE[difficulty];
        return {
          title: "New coal rules begin",
          message: `Coal costs ${Math.round((coalOM - 1) * 100)}% more to run and can produce only ${percent(complianceCoalOutput)} of normal output.`,
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
              ? "Your newer grid is reliable, profitable, and no longer led by coal."
              : "The business still relies too much on coal or is falling short on reliability or profit.",
          details: `Last year, coal supplied ${percent(coalShare)} of power, the grid met ${percent(reliability)} of demand, and the business made a ${snapshot.netIncome12m >= 0 ? "profit" : "loss"}.`,
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

/**
 * Austin-scale simulation of ERCOT-wide Winter Storm Uri conditions. The availability ratios are
 * system abstractions from FERC/NERC actual-versus-expected output, not outage claims about named
 * Austin Energy plants. Wind uses this one explicit availability adjustment; no icing derate is
 * applied elsewhere, and solar follows only the event weather.
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
      describe: () => ({
        title: "The deep freeze",
        message:
          "Record cold is straining power supplies across Texas just as demand surges.",
        details:
          "This month, gas, coal, nuclear, and wind plants can produce less while gas costs spike.",
        concept: "blackout",
        kind: "WORLD_EVENT",
        importance: "CRITICAL",
        actionTarget: { card: "FACILITIES", view: "FLEET" },
        effects: {
          // Calibrated against the fixed scenario seed so the representative February day reaches
          // approximately 6°F (-14.4°C) for several game hours.
          temperatureOffsetC: -20,
          fuelPriceMultipliers: { "Natural Gas": 2.8 },
          facilityOutputMultipliersByFuel: {
            "Natural Gas": 0.62,
            Coal: 0.73,
            Uranium: 0.77,
            Wind: 0.44,
          },
        },
        turningPointPriority: 110,
      }),
    },
    {
      id: "thaw",
      schedule: { atMonth: 50 },
      describe: ({ periodSnapshots }) => {
        const event = periodSnapshots?.[1];
        const unservedWh = event?.unservedWh || 0;
        return {
          title: "The thaw",
          message:
            event === undefined
              ? "The freeze ends next month. Normal plant output and gas prices should return."
              : unservedWh > 0
                ? "The freeze has ended. The grid now faces a difficult recovery after blackouts."
                : "The freeze has ended. Your preparations kept every customer supplied.",
          details:
            "The real 2021 storm caused widespread outages across Austin and Texas.",
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

export const STORY_ARC_DEFINITIONS: StoryArcDefinitionType[] = [
  CARBON_FEE_ARC,
  RENEWABLES_ARC,
  END_OF_ERA_ARC,
  SHALE_BOOM_ARC,
  HURRICANE_ARC,
  PARADISE_ARC,
  TEXAS_DEEP_FREEZE_ARC,
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
      result[key as keyof T] = ((result[key] || 1) * multiplier) as T[keyof T];
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
    combined.fuelPriceMultipliers = multiplyEffects(
      combined.fuelPriceMultipliers,
      effects.fuelPriceMultipliers,
    );
    combined.buildCostMultipliersByFuel = multiplyEffects(
      combined.buildCostMultipliersByFuel,
      effects.buildCostMultipliersByFuel,
    );
    combined.operatingCostMultipliersByFuel = multiplyEffects(
      combined.operatingCostMultipliersByFuel,
      effects.operatingCostMultipliersByFuel,
    );
    combined.facilityOutputMultipliersByFuel = multiplyEffects(
      combined.facilityOutputMultipliersByFuel,
      effects.facilityOutputMultipliersByFuel,
    );
    combined.facilityOutputMultipliersById = multiplyEffects(
      combined.facilityOutputMultipliersById,
      effects.facilityOutputMultipliersById,
    );
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
  const description = phase.describe(context, random);
  const startsMinute = scheduledMonth * MINUTES_PER_MONTH;
  return {
    key,
    definitionId: `${arc.id}:${phase.id}`,
    startsMinute,
    endsMinute: startsMinute + durationMonths * MINUTES_PER_MONTH,
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
  const scheduledMonth =
    resolveStoryScheduleMonth(phase.schedule, context.seed, scheduleKey) +
    offset;
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
  const occurrences: ResolvedStoryType["occurrences"] = [];
  const active: ResolvedStoryType["active"] = [];
  definitions
    // This explicit equality is the scenario boundary. Custom games (id 999) cannot inherit
    // authored content by sharing a location or starting year with one of the scored scenarios.
    .filter((arc) => arc.scenarioId === context.scenarioId)
    .flatMap((arc) => arc.phases.map((phase) => ({ arc, phase })))
    // Persisted occurrence order is part of save/replay determinism too, so content-file order is
    // not allowed to decide it.
    .sort((a, b) =>
      storyPhaseKey(a.arc.scenarioId, a.arc.id, a.phase.id).localeCompare(
        storyPhaseKey(b.arc.scenarioId, b.arc.id, b.phase.id),
      ),
    )
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
  return definitions
    .filter((arc) => arc.scenarioId === context.scenarioId)
    .flatMap((arc) =>
      arc.phases.map((phase) => resolveStoryPhase(arc, phase, context)),
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

export function activeWorldEventEffects(
  events: ActiveWorldEventType[] | undefined,
  minute: number,
): WorldEventEffectsType {
  return combineStoryEffects(
    (events || []).filter(
      (event) => minute >= event.startsMinute && minute < event.endsMinute,
    ),
  );
}
