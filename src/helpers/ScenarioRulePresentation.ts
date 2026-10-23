import type {
  CompiledRuleEvent,
  CompiledScenarioRules,
} from "../data/ScenarioRules";
import { officialScenarioRuleDefinition } from "../data/OfficialScenarioRules";
import type {
  StoryContextType,
  StoryPhaseDescriptionType,
} from "../data/WorldEvents";
import type {
  ActiveWorldEventType,
  FuelNameType,
  StoryAttributeValueType,
} from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import { scenarioEffectsSummary } from "./ScenarioEffectsSummary";

type Occurrence = ActiveWorldEventType & StoryPhaseDescriptionType;
const share = (part: number, whole: number) =>
  whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
const percent = (value: number) =>
  `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
export const officialPresentation = (event: CompiledRuleEvent) =>
  event.source
    ? officialScenarioRuleDefinition(event.source.scenarioId)?.presentation[
        event.source.phaseId
      ]
    : undefined;

/** Trusted catalog presentation consumes resolved common effects and recorded observations only.
 * No rule timing, targets, costs, objective judgments or physical effects are authored here. */
export function presentOfficialRuleOccurrence(
  event: CompiledRuleEvent,
  rules: CompiledScenarioRules,
  core: Occurrence,
  context?: StoryContextType,
  preview = false,
): Occurrence | undefined {
  if (rules.namespace.kind !== "official" || !event.source) return undefined;
  const presentation = officialPresentation(event);
  if (!presentation) return undefined;
  if (presentation.nativeReview && !context) return undefined;
  const attributes: Record<string, StoryAttributeValueType> = {
    scheduledMonth: event.startMonth,
    ...presentation.attributes,
    ...presentation.attributesByDifficulty?.[rules.difficulty],
  };
  let message = event.message;
  let importance = event.source.importance;
  const effects = { ...core.effects };
  const snapshot = context?.snapshot;
  const selectedIds = (core.attributes.selectedFacilityIds ?? []) as number[];
  const selectedNames = (core.attributes.selectedFacilityNames ??
    []) as string[];
  const selected =
    snapshot?.facilities.filter((facility) =>
      selectedIds.includes(facility.id),
    ) ?? [];
  const protection = Number(core.attributes.ruleProtectionFactor ?? 0);
  const priorChoice = (choice: string, option: string) =>
    context?.occurrences?.some(
      (occurrence) =>
        occurrence.key ===
          `story:${event.source!.scenarioId}:${event.source!.arcId}:${choice}` &&
        occurrence.attributes.choice === option,
    ) ?? false;
  const delivered = (fuels: FuelNameType[]) =>
    fuels.reduce(
      (sum, fuel) => sum + (snapshot!.deliveredWhByFuel12m[fuel] ?? 0),
      0,
    );
  const reliability =
    snapshot && snapshot.demandWh12m > 0
      ? 1 - share(snapshot.unservedWh12m, snapshot.demandWh12m)
      : undefined;
  const unavailable = () => {
    for (const key of Object.keys(attributes))
      if (key !== "scheduledMonth") delete attributes[key];
    attributes.reportAvailable = false;
    message =
      "Report unavailable. No completed electricity demand is recorded for this review.";
    importance = "ROUTINE";
  };
  switch (presentation.nativeReview) {
    case "agingWarning": {
      const onset = rules.events.find(
        (definition) => definition.source?.phaseId === "aging-derate",
      )!;
      const target = onset.targets[0].target;
      const yearsUntilOnset = (onset.startMonth - event.startMonth) / 12;
      const affected = snapshot!.facilities.filter(
        (facility) =>
          target.selector === "operatingAtLeastAge" &&
          facility.fuel === target.fuel &&
          facility.ageYears + yearsUntilOnset >= target.minAgeYears,
      );
      message = `${affected.length} aging coal ${affected.length === 1 ? "plant" : "plants"} dropping to ${percent(onset.targets[0].outputMultiplier)} output for two years from January 1986.`;
      attributes.selectedFacilityIds = affected.map((facility) => facility.id);
      attributes.selectedFacilityNames = affected.map(
        (facility) => facility.name,
      );
      break;
    }
    case "agingDerate":
      message = `${selected.length} aging coal ${selected.length === 1 ? "plant is" : "plants are"} down to ${percent(event.targets[0].outputMultiplier)} output through December 1987.`;
      attributes.selectedFacilityIds = selected.map((facility) => facility.id);
      effects.facilityOutputMultipliersById ??= {};
      break;
    case "hurricaneLandfall": {
      const output = event.targets[0].outputMultiplier;
      const oil = event.effects.fuelPriceMultipliers!.Oil!;
      const eligiblePeakW = snapshot!.facilities
        .filter((facility) => facility.operational && !!facility.fuel)
        .reduce((sum, facility) => sum + facility.peakW, 0);
      const selectedPeakW = selected.reduce(
        (sum, facility) => sum + facility.peakW,
        0,
      );
      attributes.selectedCapacityShare = share(selectedPeakW, eligiblePeakW);
      attributes.selectedFacilityIds = selectedIds;
      attributes.selectedFacilityNames = selectedNames;
      message = selectedNames.length
        ? `${selectedNames.join(", ")}: output is down to ${percent(output)} for ${event.durationMonths} months. Oil prices rise ${Math.round((oil - 1) * 100)}%.`
        : `Oil prices rise ${Math.round((oil - 1) * 100)}% for ${event.durationMonths} months. No operating plants were damaged.`;
      effects.facilityOutputMultipliersById ??= {};
      break;
    }
    case "nuclearTrip":
      attributes.selectedFacilityIds = selectedIds;
      attributes.selectedFacilityNames = selectedNames;
      effects.facilityOutputMultipliersById ??= {};
      break;
    case "deepFreezeOnset":
      if (protection > 0)
        message += " Your funded winterization halves output losses.";
      break;
    case "deepFreezeThaw": {
      const period = context!.periodSnapshots?.[1];
      const preparation = priorChoice("winterization", "winterize")
        ? "Winterization halved output losses. "
        : "";
      message =
        period === undefined
          ? "The freeze ends next month. Plant output and gas prices return to normal."
          : period.unservedWh > 0
            ? `${preparation}The freeze ends. Recovery follows blackouts.`
            : `${preparation}The freeze ends with every customer supplied.`;
      break;
    }
    case "shaleNormalization": {
      if (reliability === undefined) {
        unavailable();
        break;
      }
      const gasShare = share(delivered(["Natural Gas"]), snapshot!.demandWh12m);
      attributes.gasShare = gasShare;
      attributes.reliability = reliability;
      message =
        reliability >= 0.999 && gasShare < 0.5
          ? `Gas prices return to normal. Gas supplied ${percent(gasShare)} of last year's power; your grid stayed reliable.`
          : `Gas prices return to normal. Gas supplied ${percent(gasShare)} of last year's power; the grid met ${percent(reliability)} of demand.`;
      break;
    }
    case "paradiseReview": {
      if (reliability === undefined) {
        unavailable();
        break;
      }
      const shippedShare = share(
        delivered(["Coal", "Natural Gas", "Oil", "Uranium", "Biomass"]),
        snapshot!.demandWh12m,
      );
      attributes.shippedShare = shippedShare;
      attributes.reliability = reliability;
      message =
        reliability >= 0.999 && shippedShare < 0.5
          ? `Local sources supplied most of last year's power. The island met ${percent(reliability)} of demand.`
          : `Shipped fuels supplied ${percent(shippedShare)} of last year's power. The island met ${percent(reliability)} of demand.`;
      break;
    }
    case "renewablesReview": {
      if (reliability === undefined) {
        unavailable();
        break;
      }
      const variableShare = share(
        delivered(["Sun", "Wind", "Offshore Wind", "Airborne Wind"]),
        snapshot!.demandWh12m,
      );
      const coverage = share(
        snapshot!.firmPeakW + snapshot!.storagePeakW,
        snapshot!.peakDemandW12m,
      );
      Object.assign(attributes, { variableShare, reliability, coverage });
      message = `Wind and solar supplied ${percent(variableShare)} of last year's power; the grid met ${percent(reliability)} of demand.${reliability >= 0.999 && coverage >= 0.75 ? "" : " Backup still trails peak needs."}`;
      break;
    }
    case "coalTransitionReview": {
      if (reliability === undefined) {
        unavailable();
        break;
      }
      const coalShare = share(delivered(["Coal"]), snapshot!.demandWh12m);
      const legacyCoalW = snapshot!.facilities
        .filter(
          (facility) =>
            facility.fuel === "Coal" &&
            facility.operational &&
            facility.ageYears >= 30,
        )
        .reduce((sum, facility) => sum + facility.peakW, 0);
      const allCoalW = snapshot!.facilities
        .filter((facility) => facility.fuel === "Coal" && facility.operational)
        .reduce((sum, facility) => sum + facility.peakW, 0);
      Object.assign(attributes, {
        coalShare,
        reliability,
        netIncome: snapshot!.netIncome12m,
        legacyCoalW,
        nonCoalFirmW: Math.max(0, snapshot!.firmPeakW - allCoalW),
      });
      message =
        reliability >= 0.999 && snapshot!.netIncome12m > 0 && coalShare < 0.5
          ? `Coal supplied ${percent(coalShare)} of last year's power. Your grid stayed reliable and profitable.`
          : `Coal supplied ${percent(coalShare)} of last year's power. The grid met ${percent(reliability)} of demand at a ${snapshot!.netIncome12m >= 0 ? "profit" : "loss"}.`;
      break;
    }
    case "hurricaneRestoration": {
      const onsetId = "landfall";
      const onsetDefinition = rules.events.find(
        (definition) => definition.source?.phaseId === onsetId,
      )!;
      const period = context!.periodSnapshots?.[onsetDefinition.durationMonths];
      const demandWh = period?.demandWh || snapshot!.demandWh12m;
      const unservedWh = period?.unservedWh || snapshot!.unservedWh12m;
      if (!(demandWh > 0)) {
        unavailable();
        break;
      }
      const served = 1 - share(unservedWh, demandWh);
      const onset = context!.occurrences?.find(
        (occurrence) => occurrence.key === onsetDefinition.key,
      );
      const names = (onset?.attributes.selectedFacilityNames ?? []) as string[];
      Object.assign(attributes, { demandWh, unservedWh, reliability: served });
      importance = unservedWh > demandWh * 0.001 ? "NOTABLE" : "ROUTINE";
      message = `${names.length ? `${names.join(", ")}: output` : "Plant output"} and oil prices return to normal. The grid met ${percent(served)} of demand during the storm.`;
      break;
    }
  }
  const occurrence: Occurrence = {
    key: event.key,
    definitionId: `${event.source.arcId}:${event.source.phaseId}`,
    startsMinute: event.startMonth * MINUTES_PER_MONTH,
    endsMinute: (event.startMonth + event.durationMonths) * MINUTES_PER_MONTH,
    forecastable: event.visibility === "surprise" ? false : undefined,
    kind: event.source.kind ?? "WORLD_EVENT",
    title: preview ? (event.source.previewTitle ?? event.title) : event.title,
    message: preview ? (event.preview ?? message) : message,
    ...(event.source.concept ? { concept: event.source.concept } : {}),
    ...(importance ? { importance } : {}),
    ...(event.source.actionTarget
      ? { actionTarget: event.source.actionTarget }
      : {}),
    ...(event.source.turningPointPriority === undefined
      ? {}
      : { turningPointPriority: event.source.turningPointPriority }),
    attributes,
    effects,
  };
  if (context?.scenarioId === 999) {
    const changes = scenarioEffectsSummary(occurrence.effects);
    if (!preview)
      occurrence.message = `${context.location.name}: ${changes.length ? changes.join("; ") + "." : "Review your supply and reserves before the upcoming scenario event."}`;
    occurrence.actionTarget = { card: "FACILITIES", view: "FLEET" };
    if (presentation.nativeReview === "nuclearTrip") {
      occurrence.title = selectedNames.length
        ? `${selectedNames[0]} shuts down`
        : "Nuclear shutdown: no operating reactor affected";
      occurrence.message = selectedNames.length
        ? `${selectedNames[0]} is offline for the rest of this event. Replace its output with generation, storage or imports.`
        : "Your grid has no operating nuclear reactor, so this shutdown causes no loss of supply.";
    }
    const eventYear = rules.startingYear + Math.floor(event.startMonth / 12);
    occurrence.title = occurrence.title?.replace(
      /\b(?:19|20)\d{2}\b/g,
      String(eventYear),
    );
  }
  return occurrence;
}
