import { EQUATOR_RADIANCE, OUTSKIRTS_WIND_MULTIPLIER } from "../Constants";

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

// Since solar panel nameplate wattages are usually rated at peak output at equator noon, we use that as baseline
// Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
// TODO what about rain and snow, esp panels covered in snow? We should update irradianceWM2 based on weather when it's originally calculated...
// but that still means we'd need to track some additional historic value of "even though it's not currently snowing, they're still covered in snow"
export function getSolarOutputFactor(
  irradianceWM2: number,
  temepratureC: number
) {
  return (
    (irradianceWM2 * Math.min(1, 1 - (temepratureC - 10) / 100)) /
    EQUATOR_RADIANCE
  );
}

// Takes in an array of wind speeds and returns the average of all outputFactors
export function getWindCapacityFactor(windSpeedsKph: number[]) {
  if (windSpeedsKph.length === 0) {
    return 0;
  }
  return (
    windSpeedsKph.reduce((acc, curr) => acc + getWindOutputFactor(curr), 0) /
    windSpeedsKph.length
  );
}

// Takes in an array of irradiances and returns the average of all outputFactors
// For simplicty, assumes a constant temperature across all readings
export function getSolarCapacityFactor(irradiancesWM2: number[]) {
  if (irradiancesWM2.length === 0) {
    return 0;
  }
  return (
    irradiancesWM2.reduce(
      (acc, curr) => acc + getSolarOutputFactor(curr, 20),
      0
    ) / irradiancesWM2.length
  );
}
