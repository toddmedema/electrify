import {
  FacilityShoppingType,
  FuelNameType,
  GameEventType,
  MonthlyHistoryType,
  ScenarioType,
  VictoryDebriefType,
  VictoryFleetCapacityType,
} from "../Types";

type FleetAssetType = Partial<FacilityShoppingType> & {
  yearsToBuildLeft?: number;
};

export function fleetCapacity(
  facilities: FleetAssetType[],
  operationalOnly = false,
): VictoryFleetCapacityType[] {
  const totals: Partial<Record<FuelNameType, number>> = {};
  facilities.forEach((facility) => {
    const fuel = facility.fuel as FuelNameType | undefined;
    if (
      !fuel ||
      !facility.peakW ||
      (operationalOnly && (facility.yearsToBuildLeft || 0) > 0)
    ) {
      return;
    }
    totals[fuel] = (totals[fuel] || 0) + facility.peakW;
  });
  return (Object.entries(totals) as [FuelNameType, number][])
    .map(([fuel, watts]) => ({ fuel, watts }))
    .sort((a, b) => b.watts - a.watts);
}

function debriefHighlights(events: GameEventType[]) {
  const seen = new Set<string>();
  const candidates = events
    .filter(
      (event) =>
        event.importance ||
        event.kind === "BLACKOUT" ||
        event.kind === "BLACKOUT_OVER" ||
        event.kind === "CONSTRUCTION",
    )
    .filter((event) => {
      if (seen.has(event.message)) {
        return false;
      }
      seen.add(event.message);
      return true;
    })
    .sort((a, b) => {
      const priority =
        (b.turningPointPriority || 0) - (a.turningPointPriority || 0);
      if (priority !== 0) {
        return priority;
      }
      const importance = { ROUTINE: 0, NOTABLE: 1, CRITICAL: 2 };
      const importanceDelta =
        importance[b.importance || "ROUTINE"] -
        importance[a.importance || "ROUTINE"];
      return importanceDelta !== 0 ? importanceDelta : b.id - a.id;
    })
    .slice(0, 3)
    // The chosen events are intentionally ranked, but the debrief reads as a timeline.
    .sort((a, b) => a.id - b.id);
  return candidates.map(({ kind, label, message, importance }) => ({
    kind,
    label,
    message,
    importance,
  }));
}

export function buildVictoryDebrief(
  scenario: ScenarioType,
  summary: MonthlyHistoryType,
  facilities: FleetAssetType[],
  events: GameEventType[],
): VictoryDebriefType {
  const unservedWh = Math.max(0, summary.demandWh - summary.supplyWh);
  const reliability =
    summary.demandWh > 0
      ? Math.max(0, Math.min(1, summary.supplyWh / summary.demandWh))
      : 1;
  return {
    startingFleet: fleetCapacity(scenario.facilities),
    finalFleet: fleetCapacity(facilities, true),
    startingCash: scenario.cash,
    finalCash: summary.cash,
    finalCustomers: summary.customers,
    reliability,
    unservedWh,
    kgco2e: summary.kgco2e,
    highlights: debriefHighlights(events),
  };
}
