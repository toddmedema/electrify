import { EQUATOR_RADIANCE, OUTSKIRTS_WIND_MULTIPLIER } from "../Constants";
import { FacilityOperatingType, GeneratorOperatingType } from "../Types";

const KPH_PER_MS = 3.6;

export function getWindOutputFactor(windKph: number) {
  // Wind gradient, assuming 10m weather station, 100m wind turbine, neutral air above human habitation - https://en.wikipedia.org/wiki/Wind_gradient
  // The 5 was labelled as the kph to m/s conversion, but it never was one: the CSVs this was
  // tuned against stored metres per second under a WIND_KPH heading, so it is really the derate
  // that made a 10m reading behave like a turbine. The ERA5 files that replaced them are honestly
  // in kph, so the conversion is now done properly alongside it, and the derate is left exactly
  // as it was - the point of the change is the data source, not a rebalanced wind fleet.
  const turbineWindMS =
    (OUTSKIRTS_WIND_MULTIPLIER *
      ((windKph / KPH_PER_MS) * Math.pow(100 / 10, 0.34))) /
    5;

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
  temepratureC: number,
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
      0,
    ) / irradiancesWM2.length
  );
}

// Sun and Wind aren't dispatchable - they generate whatever the weather allows regardless of
// where the player drags them - so a dispatch stack puts them on the bottom as must-run supply,
// the same convention EIA and ISO generation stacks use.
const MUST_RUN_FUELS = ["Sun", "Wind"];

/**
 * The fuels present in a fleet, ordered the way a dispatch stack is drawn: must-run renewables
 * first, then the dispatchable fuels in the player's own merit order (their facility list order).
 */
export function getDispatchOrderedFuels(
  facilities: Array<Partial<FacilityOperatingType>>,
): string[] {
  const mustRun: string[] = [];
  const dispatchable: string[] = [];
  facilities.forEach((facility) => {
    const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
    if (!fuel) {
      return; // storage, which the stack tracks separately
    }
    const bucket = MUST_RUN_FUELS.indexOf(fuel) > -1 ? mustRun : dispatchable;
    if (bucket.indexOf(fuel) === -1) {
      bucket.push(fuel);
    }
  });
  // Keep Sun below Wind for a stable stack rather than whichever the player happened to build first
  mustRun.sort((a, b) => MUST_RUN_FUELS.indexOf(a) - MUST_RUN_FUELS.indexOf(b));
  return [...mustRun, ...dispatchable];
}
