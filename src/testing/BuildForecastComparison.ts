import { TICKS_PER_YEAR } from "../Constants";
import type { BuildForecast } from "../components/base/OutlookForecast";
import { generateForecastTimeline } from "../reducers/Game";
import { currentTick } from "../helpers/GameSelectors";
import type { GameType } from "../Types";

/** The pre-optimization catalog calculation, retained as the parity/benchmark control. */
export function fullBuildForecast(game: GameType): BuildForecast | undefined {
  const now = currentTick(game);
  if (!now) return undefined;
  const timeline = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_YEAR * 3,
  );
  return {
    timeline: timeline.map(
      ({
        minute,
        windKph,
        windOffshoreKph,
        windAirborneKph,
        solarIrradianceWM2,
        hydroRunoffMm,
        renewableCapacityFactors,
      }) => ({
        minute,
        windKph,
        windOffshoreKph,
        windAirborneKph,
        solarIrradianceWM2,
        hydroRunoffMm,
        renewableCapacityFactors,
      }),
    ),
    windSpeeds: timeline.map((tick) => tick.windKph),
    offshoreWindSpeeds: timeline.flatMap((tick) =>
      tick.windOffshoreKph === undefined ? [] : [tick.windOffshoreKph],
    ),
    airborneWindSpeeds: timeline.map((tick) => tick.windAirborneKph),
    solarIrradiances: timeline.map((tick) => tick.solarIrradianceWM2),
  };
}
