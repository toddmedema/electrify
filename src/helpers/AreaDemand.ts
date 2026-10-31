import type { DateType, LocationType } from "../Types";
import { getSunriseSunset } from "./DateTime";
import { temperatureDemandWattsPerCustomer } from "../data/DemandProfiles";
import { pow } from "./Pow";
import { exp } from "./Libm";
/** The shared weather/daily demand curve, also used when fitting authored area targets. */
export function areaBaselineDemand(
  date: DateType,
  location: LocationType,
  temperatureC: number,
  customers: number,
  scale = 1,
  exponent = 1,
) {
  const sun = getSunriseSunset(date, location);
  const darkness =
    sun.daylight === "polar-day"
      ? 1
      : sun.daylight === "polar-night"
        ? -1
        : Math.min(
            date.minuteOfDay - sun.sunrise,
            sun.sunset - date.minuteOfDay,
          ) / 420;
  const morning = Math.abs(date.minuteOfDay - 540) / 120;
  const evening = Math.abs(date.minuteOfDay - 1020) / 240;
  const thermal = temperatureDemandWattsPerCustomer(temperatureC, location);
  const multiple =
    430 +
    thermal -
    40 * (1 / (1 + exp(-morning * 2))) +
    30 * (1 / (1 + exp(-darkness * 6))) -
    65 * (1 / (1 + exp(-evening * 2)));
  return {
    baselineW:
      (exponent === 1 ? multiple : 430 * pow(multiple / 430, exponent)) *
      customers *
      scale,
    weatherShare:
      multiple > 0 ? Math.min(1, Math.max(0, (thermal - 20) / multiple)) : 0,
  };
}
