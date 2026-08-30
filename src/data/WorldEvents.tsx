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

function compactMultiplier(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
        title: "Regional gas boom forecast",
        message:
          "New shale production is expected to push natural gas prices down in Jan 2010.",
        details:
          "The discount is temporary. Compare flexible gas capacity with alternatives that are less exposed to fuel prices.",
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
          title: "Regional gas glut",
          message: `Natural gas prices fall ${Math.round((1 - boomGasMultiplier) * 100)}% through Feb 2016.`,
          details: `Difficulty-adjusted gas-price multiplier: ${boomGasMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}×.`,
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
        const { freezeGasOutput, freezeSurcharge } =
          SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Winter gas squeeze warning",
          message: `A Jan–Mar 2014 freeze could raise gas prices and cap gas generation at ${Math.round(freezeGasOutput * 100)}% output.`,
          details: `The freeze surcharge will be ${freezeSurcharge.toFixed(2).replace(/0$/, "")}×, stacked with the continuing shale discount.`,
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
          title: "Winter gas squeeze",
          message: `Gas is ${Math.round(Math.abs(effectiveMultiplier - 1) * 100)}% ${effectiveMultiplier >= 1 ? "above" : "below"} normal and all gas plants are capped at ${Math.round(balance.freezeGasOutput * 100)}% output through Mar 2014.`,
          details: `${balance.boomGasMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}× shale price × ${balance.freezeSurcharge.toFixed(2).replace(/0$/, "")}× freeze surcharge = ${effectiveMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}× effective gas price.`,
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
          title: "Gas market normalization",
          message: resilient
            ? "Regional gas prices normalize with the grid reliable and less than half dependent on gas."
            : "Regional gas prices normalize, exposing how strongly the grid still depends on gas.",
          details: `Prior 12 months: ${percent(gasShare)} delivered gas share and ${percent(reliability)} reliability.`,
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
        title: "Winter gas squeeze ends",
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
  Intern: 80,
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
  solarBuildCost: number;
  windBuildCost: number;
  demandLoad: number;
}

export const RENEWABLES_BALANCE: Record<DifficultyType, RenewablesBalanceType> =
  {
    Intern: { solarBuildCost: 0.7, windBuildCost: 0.86, demandLoad: 1.05 },
    Employee: {
      solarBuildCost: 0.725,
      windBuildCost: 0.88,
      demandLoad: 1.065,
    },
    Manager: { solarBuildCost: 0.75, windBuildCost: 0.9, demandLoad: 1.08 },
    VP: { solarBuildCost: 0.775, windBuildCost: 0.92, demandLoad: 1.095 },
    CEO: { solarBuildCost: 0.8, windBuildCost: 0.94, demandLoad: 1.11 },
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
    targetCapacityShare: 0.5,
    outputMultiplier: 0.4,
    durationMonths: 6,
    oilMultiplier: 1.6,
  },
};

export interface EndOfEraBalanceType {
  oldCoalOutput: number;
  coalOM: number;
}

export const END_OF_ERA_BALANCE: Record<DifficultyType, EndOfEraBalanceType> = {
  Intern: { oldCoalOutput: 0.9, coalOM: 1.1 },
  Employee: { oldCoalOutput: 0.875, coalOM: 1.15 },
  Manager: { oldCoalOutput: 0.85, coalOM: 1.2 },
  VP: { oldCoalOutput: 0.825, coalOM: 1.25 },
  CEO: { oldCoalOutput: 0.8, coalOM: 1.3 },
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
          title: "Carbon fee ratchet published",
          message: `The carbon fee rises to $${feePerTon}/t in Jan 2024.`,
          details: `At representative heat rates, that adds about $${Math.round(feePerTon)}/MWh for coal and $${Math.round(feePerTon * 0.5)}/MWh for gas.`,
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
          title: "Carbon fee ratchet begins",
          message: `The carbon fee is now $${feePerTon}/t CO2e through the end of the mission.`,
          details:
            "Dispatch, accounting, forecasts, fuel crossovers, generator quotes, and lifetime cost now use the higher fee.",
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
          title: "Carbon transition audit",
          message: onTrack
            ? "The audit finds a reliable, profitable grid with carbon-priced combustion below half of delivered power."
            : "The audit finds the transition still exposed on reliability, combustion, or income.",
          details: `${percent(combustionShare)} carbon-priced combustion share · ${percent(1 - unservedShare)} reliability · ${snapshot.netIncome12m >= 0 ? "positive" : "negative"} net income.`,
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
        title: "Visitor peak forecast",
        message: `Visitor demand is expected to lift electricity use ${Math.round((PARADISE_BALANCE[difficulty].visitorDemand - 1) * 100)}% from May 2006 through Oct 2007.`,
        details: "Usage rises, but customer count does not.",
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
          title: "Visitor peak",
          message: `Electricity usage rises ${Math.round((demandMultiplier - 1) * 100)}% through Oct 2007; customer count is unchanged.`,
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
        title: "Fuel cargo delay warning",
        message: `A Sep–Nov 2013 cargo disruption could raise oil prices ${Math.round((PARADISE_BALANCE[difficulty].oilShock - 1) * 100)}%.`,
        details:
          "Prepare local generation or reserves before the shipment window.",
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
        title: "Visitor peak ends",
        message: "Seasonal visitor electricity usage returns to normal.",
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
          title: "Fuel cargo delayed",
          message: `Oil prices rise ${Math.round((oilMultiplier - 1) * 100)}% through Nov 2013.`,
          details: `${compactMultiplier(oilMultiplier)}× oil price multiplier.`,
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
          title: "Local-energy review",
          message:
            reliability >= 0.999 && shippedShare < 0.5
              ? "The island stayed reliable while local resources supplied most delivered power."
              : "The review finds the island still exposed to shipped fuels or reliability risk.",
          details: `${percent(shippedShare)} shipped-fuel share · ${percent(reliability)} reliability. The game conservatively counts Coal, Natural Gas, Oil, Uranium, and Biomass as shipped because feedstock origin is not modeled.`,
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
        title: "Fuel cargo restored",
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
      id: "manufacturing-warning",
      schedule: { atMonth: 72 },
      describe: ({ difficulty }) => {
        const balance = RENEWABLES_BALANCE[difficulty];
        return {
          title: "Renewable manufacturing scale",
          message: `New Solar and Wind quotes fall in Jan 2009 to ${percent(balance.solarBuildCost)} and ${percent(balance.windBuildCost)} of normal cost.`,
          details:
            "Already-committed projects keep their signed construction cost.",
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
          title: "Renewable procurement step",
          message: `New Solar costs ${Math.round((1 - balance.solarBuildCost) * 100)}% less and new Wind costs ${Math.round((1 - balance.windBuildCost) * 100)}% less through mission end.`,
          details:
            "The discount applies once to new quotes after year, inflation, and difficulty pricing; commitments already underway do not change.",
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
        title: "Clean-tech load warning",
        message: `A new clean-tech industry raises usage ${Math.round((RENEWABLES_BALANCE[difficulty].demandLoad - 1) * 100)}% from Jan 2012 through Dec 2013.`,
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
          title: "Clean-tech load arrives",
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
          title: "Renewable integration review",
          message:
            reliability >= 0.999 && coverage >= 0.75
              ? "Variable renewables grew while firm and storage coverage kept the grid reliable."
              : "The review flags a gap between variable-renewable growth and dependable peak coverage.",
          details: `${percent(variableShare)} variable-renewable delivered share · ${percent(reliability)} reliability · ${percent(coverage)} firm/storage peak coverage.`,
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
          title: "2008 hurricane outlook",
          message: `A ${balance.severity.toLowerCase()} landfall may hit between Jun and Nov 2008, derating enough generators to reach ${percent(balance.targetCapacityShare)} of operating capacity for ${balance.durationMonths} months.`,
          details: `Affected output falls to ${percent(balance.outputMultiplier)} and oil rises ${Math.round((balance.oilMultiplier - 1) * 100)}%. Diversify the fleet and prepare storage.`,
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
          title: `${balance.severity} hurricane landfall`,
          message:
            selectedNames.length > 0
              ? `${selectedNames.join(", ")} ${selectedNames.length === 1 ? "is" : "are"} derated to ${percent(balance.outputMultiplier)} output for ${balance.durationMonths} months.`
              : `No generator is operating at landfall; the ${Math.round((balance.oilMultiplier - 1) * 100)}% oil surcharge still applies.`,
          details: `Selected ${percent(share(selectedPeakW, totalPeakW))} of operating generator capacity; oil prices are ${compactMultiplier(balance.oilMultiplier)}×. Storage remains available as prepared backup.`,
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
          title: "Storm restoration complete",
          message: `${selectedNames.length ? `${selectedNames.join(", ")} restored. ` : "Generator output restored. "}${percent(reliability)} of demand was served during the disruption.`,
          details: `${unservedWh > 0 ? `${unservedWh.toExponential(2)} Wh unserved` : "No unserved energy"} across the exact ${balance.durationMonths}-month event window; oil prices return to normal.`,
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
          title: "Aging coal review",
          message: `${selected.length} coal ${selected.length === 1 ? "unit is" : "units are"} projected to be at least 30 years old by Jan 1986.`,
          details: `Those units will fall to ${percent(END_OF_ERA_BALANCE[difficulty].oldCoalOutput)} output through Dec 1987. Sold units disappear naturally; newly purchased coal is not classified as old coal.`,
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
          title: "Old-coal derate",
          message: `${selected.length} aging coal ${selected.length === 1 ? "unit is" : "units are"} limited to ${percent(outputMultiplier)} output through Dec 1987.`,
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
        title: "1995 coal compliance deadline",
        message: `All coal O&M rises ${Math.round((END_OF_ERA_BALANCE[difficulty].coalOM - 1) * 100)}% in Jan 1995.`,
        details:
          "The policy covers fixed O&M, variable O&M, and start maintenance for existing and new coal.",
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
        title: "Aging review closes",
        message:
          "The temporary old-coal derate ends; nameplate output is restored.",
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
        const coalOM = END_OF_ERA_BALANCE[difficulty].coalOM;
        return {
          title: "Coal compliance deadline",
          message: `Coal fixed, variable, and start O&M are now ${Math.round((coalOM - 1) * 100)}% higher through mission end.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: GENERATOR_TARGET,
          attributes: { coalOM },
          effects: { operatingCostMultipliersByFuel: { Coal: coalOM } },
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
          title: "Successor fleet review",
          message:
            reliability >= 0.999 && snapshot.netIncome12m > 0 && coalShare < 0.5
              ? "A reliable, profitable successor fleet now supplies most power beyond coal."
              : "The successor review finds the business still exposed to coal, reliability, or profit risk.",
          details: `${percent(coalShare)} delivered coal share · ${percent(reliability)} reliability · ${snapshot.netIncome12m >= 0 ? "positive" : "negative"} net income · ${(legacyCoalW / 1e6).toFixed(0)} MW legacy coal · ${(nonCoalFirmW / 1e6).toFixed(0)} MW non-coal firm capacity.`,
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

export const STORY_ARC_DEFINITIONS: StoryArcDefinitionType[] = [
  CARBON_FEE_ARC,
  RENEWABLES_ARC,
  END_OF_ERA_ARC,
  SHALE_BOOM_ARC,
  HURRICANE_ARC,
  PARADISE_ARC,
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
