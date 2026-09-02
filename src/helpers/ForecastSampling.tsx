import { FuelNameType, TickPresentFutureType } from "../Types";

/**
 * Keeps regularly spaced forecast points plus the fuel-mix point that differs most from a
 * straight line between each pair. A periodic-only sample can completely skip a short event even
 * though the simulation modeled it. One extra point per interval preserves those meaningful
 * shapes without handing every chart the full forecast timeline.
 */
export function sampleForecastTimeline(
  timeline: TickPresentFutureType[],
  intervalMinutes: number,
  projectionStepMinutes: number,
): TickPresentFutureType[] {
  if (timeline.length <= 2) {
    return [...timeline];
  }

  const included = new Set<number>([0, timeline.length - 1]);
  timeline.forEach((tick, index) => {
    if (tick.minute % intervalMinutes < projectionStepMinutes) {
      included.add(index);
    }
  });

  const anchors = [...included].sort((a, b) => a - b);
  for (let anchor = 1; anchor < anchors.length; anchor++) {
    const startIndex = anchors[anchor - 1];
    const endIndex = anchors[anchor];
    if (endIndex <= startIndex + 1) {
      continue;
    }

    const start = timeline[startIndex];
    const end = timeline[endIndex];
    const duration = end.minute - start.minute;
    let greatestDeviation = 0;
    let significantIndex = -1;

    for (let index = startIndex + 1; index < endIndex; index++) {
      const tick = timeline[index];
      const progress = duration ? (tick.minute - start.minute) / duration : 0;
      const fuels = new Set<FuelNameType>([
        ...(Object.keys(start.supplyByFuel) as FuelNameType[]),
        ...(Object.keys(tick.supplyByFuel) as FuelNameType[]),
        ...(Object.keys(end.supplyByFuel) as FuelNameType[]),
      ]);
      let deviation = 0;
      fuels.forEach((fuel) => {
        const startW = start.supplyByFuel[fuel] || 0;
        const endW = end.supplyByFuel[fuel] || 0;
        const expectedW = startW + (endW - startW) * progress;
        deviation += Math.abs((tick.supplyByFuel[fuel] || 0) - expectedW);
      });
      if (deviation > greatestDeviation) {
        greatestDeviation = deviation;
        significantIndex = index;
      }
    }

    if (significantIndex >= 0) {
      included.add(significantIndex);
    }
  }

  return [...included].sort((a, b) => a - b).map((index) => timeline[index]);
}
