import { DIFFICULTIES, TICK_MINUTES } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { getInflationIndex } from "../data/Economy";
import {
  CoalRepowerType,
  FacilityOperatingType,
  FacilityUpgradeInProgressType,
  GameType,
  isCoalRepower,
  isStorage,
} from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import { activeScenario } from "./GameSelectors";

// Brownfield site reuse assumptions. See docs/coal-to-gas-repowering.md for the cases and scope.
export const COAL_REPOWER_OPTIONS = {
  coalToGasCC: {
    name: "Natural Gas CC",
    firstYear: 1990,
    baseMonths: 36,
    buildCostShare: 0.75,
    decision: "coal-to-gas-cc",
  },
  coalToGasPeaker: {
    name: "Natural Gas Peaker",
    firstYear: 1966,
    baseMonths: 18,
    buildCostShare: 0.85,
    decision: "coal-to-gas-peaker",
  },
} as const satisfies Record<
  CoalRepowerType,
  {
    name: string;
    firstYear: number;
    baseMonths: number;
    buildCostShare: number;
    decision: string;
  }
>;

function coalRepowerTarget(
  facility: FacilityOperatingType,
  game: GameType,
  kind: CoalRepowerType,
) {
  const name = COAL_REPOWER_OPTIONS[kind].name;
  const atSize = (peakW: number) =>
    GENERATORS(game, peakW, [], []).find((g) => g.name === name);
  const target = atSize(facility.peakW);
  return target && target.peakW > target.maxPeakW
    ? atSize(target.maxPeakW)
    : target;
}

export function coalRepowerQuote(
  facility: FacilityOperatingType,
  game: GameType,
  kind: CoalRepowerType,
) {
  const option = COAL_REPOWER_OPTIONS[kind];
  if (
    facility.fuel !== "Coal" ||
    isStorage(facility) ||
    !Number.isFinite(facility.peakW) ||
    facility.peakW <= 0 ||
    facility.yearsToBuildLeft !== 0 ||
    facility.saleRestricted ||
    facility.permanentShutdownMonth !== undefined ||
    facility.upgradeInProgress ||
    game.date.year < option.firstYear ||
    activeScenario(game)?.tutorialSteps
  )
    return undefined;
  const target = coalRepowerTarget(facility, game, kind);
  if (!target) return undefined;
  const months = option.baseMonths * DIFFICULTIES[game.difficulty].buildTime;
  return {
    cost: Math.round(target.buildCost * option.buildCostShare),
    durationMinutes:
      Math.ceil((months * MINUTES_PER_MONTH) / TICK_MINUTES) * TICK_MINUTES,
    constructionKgco2eTotal:
      (target.constructionKgco2ePerW ?? 0) * target.peakW,
    target,
  };
}

type CoalRepowerProject = FacilityUpgradeInProgressType & {
  upgrade: CoalRepowerType;
};

function isCoalRepowerProject(
  project: FacilityUpgradeInProgressType | undefined,
): project is CoalRepowerProject {
  return isCoalRepower(project?.upgrade);
}

export function coalRepowerInProgress(
  facility: FacilityOperatingType,
): CoalRepowerProject | undefined {
  const project = facility.upgradeInProgress;
  return isCoalRepowerProject(project) ? project : undefined;
}

/** Embodied emissions for the elapsed portion of a construction interval. */
export function coalRepowerConstructionEmissions(
  work: FacilityUpgradeInProgressType,
  endMinute: number,
  stepMinutes: number,
): number {
  const start = Math.max(work.startsMinute, endMinute - stepMinutes);
  const end = Math.min(work.completesMinute, endMinute);
  return end > start
    ? (work.constructionKgco2eTotal ?? 0) *
        ((end - start) / (work.completesMinute - work.startsMinute))
    : 0;
}

/** Replace the generating equipment while keeping the site identity and its ongoing obligations. */
export function completeCoalRepower(
  facility: FacilityOperatingType,
  game: GameType,
  project: FacilityUpgradeInProgressType,
): boolean {
  if (
    isStorage(facility) ||
    facility.fuel !== "Coal" ||
    !isCoalRepower(project.upgrade)
  )
    return false;
  const target = coalRepowerTarget(facility, game, project.upgrade);
  if (!target) return false;
  // The catalog supplies the new turbine, including the site's normal gas weather rating.
  // Keep prior operating history and debt. The gas investment replaces the coal resale basis.
  const { resilienceExtraBuildCost: _resilienceExtraBuildCost, ...technology } =
    target;
  Object.assign(facility, technology, {
    buildCost: project.cost,
    yearsToBuild:
      (project.completesMinute - project.startsMinute) /
      (12 * MINUTES_PER_MONTH),
    minuteOperational: project.completesMinute,
    costIndexAtBuild: getInflationIndex(
      game.date,
      game.startingYear,
      game.seed,
    ),
    currentW: 0,
    committed: false,
    generatingLastRealTick: false,
  });
  return true;
}
