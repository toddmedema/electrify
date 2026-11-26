import { FUELS, WEATHER_DEPENDENT_FUELS } from "../../Constants";
import {
  isStorage,
  type FacilityShoppingType,
  type GeneratorShoppingType,
} from "../../Types";
import type { ExpectedOutputShape } from "../../helpers/ExpectedOutput";

export function typicalCapacityFactor(
  generator: GeneratorShoppingType,
  shape?: ExpectedOutputShape,
): number {
  // Hydro generation is limited by forecast inflow, which can fall below design capacity.
  return shape?.kind === "water-inflow" ? shape.mean : generator.capacityFactor;
}

export function directEmissionsPerMWh(generator: GeneratorShoppingType) {
  return Math.round(
    1e6 * generator.btuPerWh * (FUELS[generator.fuel]?.kgCO2ePerBtu ?? 0),
  );
}

export function generatorOutputPending(
  generator: GeneratorShoppingType,
  forecastPending: boolean,
) {
  return (
    forecastPending &&
    (generator.fuel === "Hydro" ||
      WEATHER_DEPENDENT_FUELS.includes(generator.fuel))
  );
}

const preferences = {
  buildCost: "lower",
  buildTime: "lower",
  lifetimeCost: "lower",
  capacityFactor: "neutral",
  directEmissions: "lower",
  dischargePower: "neutral",
  duration: "neutral",
  efficiency: "higher",
} as const;

type Metric = keyof typeof preferences;
export type BuildPreviewMarker = {
  tone: "good" | "bad" | "neutral";
  text: string;
};
type Markers = Partial<Record<Metric, BuildPreviewMarker>>;

export type BuildPreviewComparison = {
  caption: string;
  markers: Markers;
};

function readouts(
  facility: FacilityShoppingType,
  forecastPending: boolean,
  capacityFactor: (generator: GeneratorShoppingType) => number,
): Partial<Record<Metric, number>> {
  const construction = {
    buildCost: facility.buildCost,
    buildTime: Math.round(facility.yearsToBuild * 12),
  };
  if (isStorage(facility)) {
    return {
      ...construction,
      dischargePower: facility.peakW,
      duration: facility.peakWh / facility.peakW,
      efficiency: Math.round(facility.roundTripEfficiency * 100),
    };
  }
  const outputPending = generatorOutputPending(facility, forecastPending);
  return {
    ...construction,
    lifetimeCost: outputPending ? undefined : facility.lcWh,
    capacityFactor: outputPending ? undefined : capacityFactor(facility),
    directEmissions: directEmissionsPerMWh(facility),
  };
}

export function compareBuildPreview(
  facility: FacilityShoppingType,
  peers: FacilityShoppingType[],
  forecastPending: boolean,
  capacityFactor: (generator: GeneratorShoppingType) => number,
): Markers {
  const comparison: Markers = {};
  const peerReadouts = peers.map((peer) =>
    readouts(peer, forecastPending, capacityFactor),
  );
  const current = readouts(facility, forecastPending, capacityFactor);

  for (const metric of Object.keys(preferences) as Metric[]) {
    const value = current[metric];
    if (value === undefined || !Number.isFinite(value)) continue;
    const values = peerReadouts
      .map((readout) => readout[metric])
      .filter(
        (peer): peer is number => peer !== undefined && Number.isFinite(peer),
      )
      .sort((a, b) => a - b);
    if (values.length < 2) continue;
    const middle = Math.floor(values.length / 2);
    const median =
      (values[Math.floor((values.length - 1) / 2)] + values[middle]) / 2;
    // Compact formatting rounds costs. Keep near ties quiet at that precision.
    const tolerance =
      metric === "buildCost" || metric === "lifetimeCost" ? median * 0.02 : 0;
    if (Math.abs(value - median) <= tolerance) {
      comparison[metric] = { tone: "neutral", text: "Typical" };
      continue;
    }
    const direction = value < median ? "lower" : "higher";
    const preference = preferences[metric];
    comparison[metric] = {
      tone:
        preference === "neutral"
          ? "neutral"
          : preference === direction
            ? "good"
            : "bad",
      text:
        metric === "buildTime" || metric === "duration"
          ? direction === "lower"
            ? "Shorter"
            : "Longer"
          : direction === "lower"
            ? "Lower"
            : "Higher",
    };
  }
  return comparison;
}

export function BuildComparisonMarker({
  marker,
}: {
  marker: BuildPreviewMarker;
}) {
  const sign = { good: "+", bad: "−", neutral: "" }[marker.tone];
  return (
    <span className="buildComparisonMarker" data-tone={marker.tone}>
      {sign && <span aria-hidden="true">{sign} </span>}
      {marker.text}
    </span>
  );
}
