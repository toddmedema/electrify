import { isLegacyEraGame } from "../../../data/LegacyEra";
import { getWeather } from "../../../data/Weather";
import { currentTick } from "../../../helpers/GameSelectors";
import { RUNOFF_COEFFICIENT, snowFraction } from "../../../helpers/Hydro";
import type {
  GameType,
  RawWeatherType,
  TickPresentFutureType,
} from "../../../Types";

/** Normalized presentation inputs. Reading the map cannot change dispatch or hydrology. */
export interface MapWeather {
  rain: number;
  snowfall: number;
  cloud: number;
  wind: number;
  waterLevel: number;
  snowpack: number;
}

type BasinWeather = Pick<
  TickPresentFutureType,
  | "temperatureC"
  | "windKph"
  | "precipitationMm"
  | "hydroRunoffMm"
  | "snowpackMm"
>;

function unit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function mapWeather(
  reading: Pick<
    RawWeatherType,
    "TEMP_C" | "WIND_KPH" | "PRECIP_MM" | "CLOUD_PCT"
  >,
  basin?: BasinWeather | null,
): MapWeather {
  const snow = snowFraction(basin?.temperatureC ?? reading.TEMP_C);
  // A square-root scale keeps light showers and flurries visible.
  const rain = Math.sqrt(unit((reading.PRECIP_MM * (1 - snow)) / 4));
  const snowfall = Math.sqrt(unit((reading.PRECIP_MM * snow) / 2));
  const runoff =
    basin?.hydroRunoffMm ??
    (basin?.precipitationMm ?? 0) * (1 - snow) * RUNOFF_COEFFICIENT;
  // Lakes and rivers keep a base pool. The basin's rain and snowmelt swell it,
  // with a smaller response to the rain currently falling over the map.
  const waterLevel = 0.2 + 0.64 * unit(runoff / 110) + 0.16 * rain;
  return {
    rain,
    snowfall,
    cloud: unit(reading.CLOUD_PCT / 100),
    wind: unit((basin?.windKph ?? reading.WIND_KPH) / 60),
    waterLevel,
    snowpack: unit((basin?.snowpackMm ?? 0) / 160),
  };
}

export function readMapWeather(game: GameType): MapWeather {
  const reading = getWeather(
    game.date,
    game.seed,
    0,
    game.location.id,
    isLegacyEraGame(game),
  );
  return mapWeather(reading, currentTick(game));
}
