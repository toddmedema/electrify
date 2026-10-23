import type { ResolvedRuleSelector } from "../data/ScenarioRules";
import type { FuelNameType } from "../Types";
import { randomAt, RANDOM_STREAM } from "./Math";

/** The event resolver supplies these facts at activation, never from an authoring package. */
export interface ScenarioRuleTargetFacility {
  id: number;
  name: string;
  fuel?: FuelNameType;
  ageYears: number;
  peakW: number;
  operational: boolean;
  minuteCreated: number;
  startingAssetId?: string;
}

/** Integer IDs may be reused after a sale; commissioning identity must survive with the target. */
export interface ScenarioRuleTargetBinding {
  id: number;
  minuteCreated: number;
  startingAssetId?: string;
  name: string;
  peakW: number;
}

export interface ScenarioRuleTargetContext {
  seed: number;
  eventKey: string;
  facilities: readonly ScenarioRuleTargetFacility[];
  /** Trusted catalog mapping only, retaining official `story:` RNG addresses. Never authored. */
  officialDrawKey?: string;
}

export interface ScenarioRuleTargetResolution {
  targets: ScenarioRuleTargetBinding[];
  eligiblePeakW: number;
  selectedPeakW: number;
  /** A zero requested share is intentional; it is not a missing eligible facility. */
  noMatch: boolean;
}

// The registered story stream uses this stable FNV address; no array position enters a draw.
function targetAddress(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result | 0;
}

const byIdentity = (
  a: ScenarioRuleTargetFacility,
  b: ScenarioRuleTargetFacility,
) => a.id - b.id || a.minuteCreated - b.minuteCreated;

function binding(
  facility: ScenarioRuleTargetFacility,
): ScenarioRuleTargetBinding {
  return {
    id: facility.id,
    minuteCreated: facility.minuteCreated,
    ...(facility.startingAssetId
      ? { startingAssetId: facility.startingAssetId }
      : {}),
    name: facility.name,
    peakW: facility.peakW,
  };
}

/** Select once at activation. Forecasts and resumed runs consume the persisted bindings. */
export function resolveScenarioRuleTargets(
  selector: ResolvedRuleSelector,
  context: ScenarioRuleTargetContext,
): ScenarioRuleTargetResolution {
  const { facilities, seed, eventKey, officialDrawKey } = context;
  if (selector.selector === "startingAsset") {
    const eligible = facilities
      .filter((facility) => facility.startingAssetId === selector.assetId)
      .sort(byIdentity);
    return {
      targets: eligible.map(binding),
      eligiblePeakW: eligible.reduce(
        (sum, facility) => sum + facility.peakW,
        0,
      ),
      selectedPeakW: eligible.reduce(
        (sum, facility) => sum + facility.peakW,
        0,
      ),
      noMatch: eligible.length === 0,
    };
  }

  let eligible = facilities.filter(
    (facility) =>
      facility.operational &&
      facility.fuel !== undefined &&
      facility.peakW > 0 &&
      (selector.fuel === undefined || facility.fuel === selector.fuel),
  );
  if (selector.selector === "operatingAtLeastAge")
    eligible = eligible.filter(
      (facility) => facility.ageYears >= selector.minAgeYears,
    );
  // An input fleet may be ordered by dispatch priority. That order cannot affect targeting or sums.
  eligible.sort(byIdentity);
  const eligiblePeakW = eligible.reduce(
    (sum, facility) => sum + facility.peakW,
    0,
  );
  let selected: ScenarioRuleTargetFacility[];

  switch (selector.selector) {
    case "largestOperating":
      selected = [...eligible]
        .sort((a, b) => b.peakW - a.peakW || byIdentity(a, b))
        .slice(0, 1);
      break;
    case "oldestOperating":
      selected = [...eligible]
        .sort((a, b) => b.ageYears - a.ageYears || byIdentity(a, b))
        .slice(0, selector.count);
      break;
    case "operatingAtLeastAge":
      selected = eligible;
      break;
    case "seededOperatingCapacityShare": {
      const ranked = eligible
        .map((facility) => ({
          facility,
          score: randomAt(
            seed,
            RANDOM_STREAM.worldEvents,
            targetAddress(
              officialDrawKey
                ? `${officialDrawKey}|facility|${facility.id}`
                : `${eventKey}|targets|${selector.selector}|${selector.fuel ?? "all"}|facility|${facility.id}|${facility.minuteCreated}`,
            ),
          ),
        }))
        .sort(
          (a, b) => a.score - b.score || byIdentity(a.facility, b.facility),
        );
      const requiredPeakW = eligiblePeakW * selector.targetCapacityShare;
      selected = [];
      let selectedPeakW = 0;
      for (const { facility } of ranked) {
        if (selectedPeakW >= requiredPeakW) break;
        selected.push(facility);
        selectedPeakW += facility.peakW;
      }
      break;
    }
  }

  return {
    targets: selected.map(binding),
    eligiblePeakW,
    selectedPeakW: selected.reduce((sum, facility) => sum + facility.peakW, 0),
    noMatch: eligible.length === 0,
  };
}

/** Ignore sold targets and ID-reusing replacements without rerunning the selector. */
export function survivingScenarioRuleTargets(
  targets: readonly ScenarioRuleTargetBinding[],
  facilities: readonly Pick<
    ScenarioRuleTargetFacility,
    "id" | "minuteCreated" | "startingAssetId"
  >[],
): ScenarioRuleTargetBinding[] {
  const owned = new Map(facilities.map((facility) => [facility.id, facility]));
  return targets
    .filter((target) => {
      const facility = owned.get(target.id);
      return (
        facility?.minuteCreated === target.minuteCreated &&
        facility.startingAssetId === target.startingAssetId
      );
    })
    .map((target) => ({ ...target }));
}
