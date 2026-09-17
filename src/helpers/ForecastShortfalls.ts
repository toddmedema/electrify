import { GAME_TO_REAL_YEARS } from "../Constants";

interface PowerSample {
  minute: number;
  supplyW: number;
  demandW: number;
}

interface Shortfall {
  wh: number;
  peakW: number;
  start: number;
  end: number;
}

/** Monthly-equivalent energy, not the duration of a real continuous outage. */
export function forecastShortfalls(
  timeline: readonly PowerSample[],
  stepMinutes: number,
  domainMax: number,
) {
  let blackoutTotalWh = 0;
  let active: Shortfall | undefined;
  let largestBlackout: Shortfall = { wh: 0, peakW: 0, start: 0, end: 0 };
  const blackouts: { minute: number; value: number }[] = [];
  for (const tick of timeline) {
    const shortageW = Math.max(0, tick.demandW - tick.supplyW);
    if (shortageW > 0) {
      if (!active) {
        active = { wh: 0, peakW: 0, start: tick.minute, end: tick.minute };
        blackouts.push({ minute: tick.minute, value: 0 });
        blackouts.push({ minute: tick.minute, value: domainMax });
      }
      const wh = shortageW * (stepMinutes / 60) * GAME_TO_REAL_YEARS;
      blackoutTotalWh += wh;
      active.wh += wh;
      active.peakW = Math.max(active.peakW, shortageW);
      active.end = tick.minute + stepMinutes;
    } else if (active) {
      blackouts.push({ minute: tick.minute, value: domainMax });
      blackouts.push({ minute: tick.minute, value: 0 });
      if (active.wh > largestBlackout.wh) largestBlackout = active;
      active = undefined;
    }
  }
  if (active) {
    blackouts.push({ minute: active.end, value: domainMax });
    if (active.wh > largestBlackout.wh) largestBlackout = active;
  }
  return { blackouts, blackoutTotalWh, largestBlackout };
}
