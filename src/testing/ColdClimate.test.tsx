import {
  hasSimWeather,
  loadSimData,
  simLocationIds,
  getSimLocation,
} from "./SimData";
import { representativeMinTempC } from "../helpers/Hazards";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  COLD_CLIMATE_BY_LOCATION,
  COLD_CLIMATE_YEARS,
  coldClimateFromAnnualMinima,
} from "../data/ColdClimate";
import {
  coldPackageDesignMinTempC,
  getWeatherHazardProfile,
  regionalColdThresholdC,
  STANDARD_GAS_DESIGN_MIN_TEMP_C,
} from "../data/Hazards";

jest.setTimeout(600000);

const SEED = 101;
const MONTHS = 240;
// Twenty-year runs starting deep in the record, recently, and in the seeded forecast.
const START_YEARS = [1980, 2000, 2020, 2026];
// Regional gas shocks are rare events, not a winter routine.
const MAX_REGIONAL_EVENTS = 3;
// A plant built as the game defaults it (standard in mild climates, packaged in cold ones)
// trips in a handful of months per twenty years at most.
const MAX_DEFAULT_PLANT_DERATE_MONTHS = 8;

const ids = simLocationIds().filter((id) => hasSimWeather(id));

interface Measured {
  table: readonly [number, number];
  months: Record<number, number[]>;
}

const measured: Record<string, Measured> = {};

beforeAll(() => {
  ids.forEach((id) => {
    loadSimData(id);
    const minima: number[] = [];
    for (let y = COLD_CLIMATE_YEARS.first; y <= COLD_CLIMATE_YEARS.last; y++) {
      let min = Infinity;
      for (let m = 0; m < 12; m++) {
        min = Math.min(
          min,
          representativeMinTempC(
            getDateFromMinute(m * MINUTES_PER_MONTH, y),
            SEED,
          ),
        );
      }
      minima.push(min);
    }
    const months: Record<number, number[]> = {};
    START_YEARS.forEach((year) => {
      months[year] = Array.from({ length: MONTHS }, (_, m) =>
        representativeMinTempC(
          getDateFromMinute(m * MINUTES_PER_MONTH, year),
          SEED,
        ),
      );
    });
    measured[id] = { table: coldClimateFromAnnualMinima(minima), months };
  });
});

describe("cold climate across every playable city", () => {
  it("covers the weather index", () => {
    expect(ids.length).toBeGreaterThan(200);
  });

  it("matches the weather record (regenerate COLD_CLIMATE_BY_LOCATION if not)", () => {
    const stale = ids.filter(
      (id) =>
        JSON.stringify(COLD_CLIMATE_BY_LOCATION[id]) !==
        JSON.stringify(measured[id].table),
    );
    const replacement = ids
      .map((id) => `  ${id}: [${measured[id].table.join(", ")}],`)
      .join("\n");
    expect(stale.length ? replacement : "").toBe("");
  });

  it("keeps regional gas shocks to a few per twenty years everywhere", () => {
    const over: string[] = [];
    ids.forEach((id) => {
      const threshold = regionalColdThresholdC(
        getWeatherHazardProfile(getSimLocation(id)!),
      );
      START_YEARS.forEach((year) => {
        const count = measured[id].months[year].filter(
          (t) => t < threshold,
        ).length;
        if (count > MAX_REGIONAL_EVENTS) over.push(`${id} ${year}: ${count}`);
      });
    });
    expect(over).toEqual([]);
  });

  it("keeps default-built gas plants rated for local winters", () => {
    const over: string[] = [];
    ids.forEach((id) => {
      const profile = getWeatherHazardProfile(getSimLocation(id)!);
      const rating = profile.coldClimate
        ? coldPackageDesignMinTempC(profile)
        : STANDARD_GAS_DESIGN_MIN_TEMP_C;
      START_YEARS.forEach((year) => {
        const count = measured[id].months[year].filter(
          (t) => t < rating,
        ).length;
        if (count > MAX_DEFAULT_PLANT_DERATE_MONTHS) {
          over.push(`${id} ${year}: ${count}`);
        }
      });
    });
    expect(over).toEqual([]);
  });
});
