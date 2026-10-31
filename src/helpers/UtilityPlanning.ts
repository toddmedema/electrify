import { GENERATORS } from "../data/Facilities";
import { UTILITY_AREAS, utilityEntitlementsAt } from "../data/UtilityExpansion";
import type { GameType, UtilityId, UtilityTargetId } from "../Types";
import type { ProjectionView } from "./Projection";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { activeScenario } from "./GameSelectors";
import {
  demandServed,
  reliabilityThreshold,
  scenarioObjectiveDefinitions,
} from "./ObjectiveRules";

/** A reference project, not a promise that this one plant will cover the forecast gap. */
export const UTILITY_PLANNING_REFERENCE_W = 150e6;

/** Monthly service uses the same difficulty threshold as the survival rule. */
export function utilityServiceGap(game: GameType, forecast: ProjectionView) {
  const duration = activeScenario(game)?.durationMonths;
  // Once the player continues beyond the scored term, forward supply still matters.
  const lastMonth =
    duration !== undefined && game.date.monthsElapsed < duration
      ? duration
      : Infinity;
  return forecast.financeProjected.find((row) => {
    const month = (row.year - game.startingYear) * 12 + row.month - 1;
    return (
      month >= game.date.monthsElapsed &&
      month < lastMonth &&
      demandServed(row) < reliabilityThreshold(game.difficulty)
    );
  });
}

export function utilityPlanning(
  game: GameType,
  forecast?: ProjectionView,
  prospectiveTarget?: UtilityTargetId,
) {
  if (!isUtilityExpansionGame(game)) return undefined;
  const reference = GENERATORS(game, UTILITY_PLANNING_REFERENCE_W, [], []).find(
    (facility) => facility.name === "Natural Gas CC",
  );
  const buildMonths = reference
    ? Math.ceil(reference.yearsToBuild * 12)
    : undefined;
  const owned: UtilityId[] = [
    ...new Set<UtilityId>([
      "champlain",
      ...(game.utilityExpansion?.acquisitions
        .filter((receipt) => receipt.minute <= game.date.minute)
        .map((receipt) => receipt.targetId) ?? []),
      ...(prospectiveTarget ? [prospectiveTarget] : []),
    ]),
  ];
  const supplyChanges = owned
    .flatMap((id) => {
      const sources = UTILITY_AREAS[id].entitlements;
      const years = new Set(
        sources
          .flatMap((source) => [source.reductionYear])
          .filter((year): year is number => year !== undefined),
      );
      return [...years]
        .filter(
          (year) => year * 12 > game.date.year * 12 + game.date.monthNumber - 1,
        )
        .map((year) => ({
          utility: UTILITY_AREAS[id].name,
          year,
          startMonth:
            buildMonths === undefined
              ? undefined
              : (year - game.startingYear) * 12 - buildMonths,
          contracts: utilityEntitlementsAt(id, year).filter(
            (source) => source.reductionYear === year,
          ),
        }));
    })
    .sort((a, b) => a.year - b.year || a.utility.localeCompare(b.utility));
  const retirements = scenarioObjectiveDefinitions(
    activeScenario(game),
    game,
  ).flatMap((objective) =>
    objective.metric !== "assetRetirement"
      ? []
      : game.facilities
          .filter(
            (facility) =>
              !!facility.startingAssetId &&
              objective.assetIds.includes(facility.startingAssetId),
          )
          .map((facility) => ({
            id: facility.id,
            name: facility.name,
            startingAssetId: facility.startingAssetId,
            deadlineMonth: objective.deadlineMonth,
            startMonth:
              buildMonths === undefined
                ? undefined
                : objective.deadlineMonth - buildMonths,
          })),
  );
  const serviceThreshold = reliabilityThreshold(game.difficulty);
  const firstGap = forecast && utilityServiceGap(game, forecast);
  const nextYear = forecast?.forecast.filter(
    (tick) =>
      tick.minute >= game.date.minute &&
      tick.minute < game.date.minute + 12 * MINUTES_PER_MONTH,
  );
  const nextCustomers = forecast?.financeProjected.find(
    (row) =>
      (row.year - game.startingYear) * 12 + row.month - 1 >=
      game.date.monthsElapsed + 11,
  )?.customers;
  return {
    buildMonths,
    supplyChanges,
    retirements,
    serviceThreshold,
    nextCustomers,
    nextPeakW: nextYear?.length
      ? Math.max(...nextYear.map((tick) => tick.demandW))
      : undefined,
    gap: firstGap
      ? {
          date: getDateFromMinute(
            ((firstGap.year - game.startingYear) * 12 + firstGap.month - 1) *
              MINUTES_PER_MONTH,
            game.startingYear,
          ),
          startMonth:
            buildMonths === undefined
              ? undefined
              : (firstGap.year - game.startingYear) * 12 +
                firstGap.month -
                1 -
                buildMonths,
        }
      : undefined,
  };
}
