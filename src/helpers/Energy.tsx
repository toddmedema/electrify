import { OUTSKIRTS_WIND_MULTIPLIER } from "../Constants";

export function getWindOutputFactor(windKph: number) {
  // Wind gradient, assuming 10m weather station, 100m wind turbine, neutral air above human habitation - https://en.wikipedia.org/wiki/Wind_gradient
  // Divide by 5 to convert from kph to m/s
  const turbineWindMS =
    (OUTSKIRTS_WIND_MULTIPLIER * (windKph * Math.pow(100 / 10, 0.34))) / 5;

  // Production output is sloped from 3-14m/s, capped on zero and peak at both ends, and cut off >25m/s - http://www.wind-power-program.com/turbine_characteristics.htm
  const windOutputFactor =
    turbineWindMS < 3 || turbineWindMS > 25
      ? 0
      : Math.max(0, Math.min(1, (turbineWindMS - 3) / 11));

  return windOutputFactor;
}

// Sunlight percent is a proxy for time of year and lat/long
// Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
// TODO what about rain and snow, esp panels covered in snow?
export function getSolarOutputFactor(
  sunlightPercent: number,
  temepratureC: number
) {
  return sunlightPercent * Math.max(1, 1 - (temepratureC - 10) / 100);
}
