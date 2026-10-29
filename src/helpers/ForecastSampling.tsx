import { FuelNameType, TickPresentFutureType } from "../Types";

function sampleTimelineIndices(
  timeline: readonly { minute: number }[],
  intervalMinutes: number,
): number[] {
  const indices: number[] = [];
  timeline.forEach((tick, index) => {
    if (
      index === 0 ||
      index === timeline.length - 1 ||
      Math.floor(tick.minute / intervalMinutes) !==
        Math.floor(timeline[index - 1].minute / intervalMinutes)
    ) {
      indices.push(index);
    }
  });
  return indices;
}

/**
 * Keeps the first point in each occupied time bucket and both endpoints, once each.
 * Crossing a bucket boundary works for offset hourly forecasts and sparse recorded months;
 * testing minute % interval against a tick-sized window can miss every interior point.
 */
export function sampleTimeline<T extends { minute: number }>(
  timeline: readonly T[],
  intervalMinutes: number,
): T[] {
  return sampleTimelineIndices(timeline, intervalMinutes).map(
    (index) => timeline[index],
  );
}

/**
 * Keeps regularly spaced forecast points plus the fuel-mix point that differs most from a
 * straight line between each pair. A periodic-only sample can completely skip a short event even
 * though the simulation modeled it. One extra point per interval preserves those meaningful
 * shapes without handing every chart the full forecast timeline.
 */
export function sampleForecastTimeline(
  timeline: TickPresentFutureType[],
  intervalMinutes: number,
): TickPresentFutureType[] {
  if (timeline.length <= 2) {
    return [...timeline];
  }

  const included = new Set(sampleTimelineIndices(timeline, intervalMinutes));

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
