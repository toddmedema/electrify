import {
  getInflationIndex,
  getInflationRate,
  getPrimeRate,
  initEconomyFromCsv,
} from "./Economy";
import { getDateFromMinute } from "../helpers/DateTime";

const FIXTURE_STARTING_YEAR = 2000;
const FIXTURE_ENDING_YEAR = 2019;
const FIXTURE_PRIME = 4.75;
const FIXTURE_INFLATION = 0.018;
const SEED = 1;

function fixtureCsv(): string {
  const rows = ["month,year,prime,inflation"];
  for (let year = FIXTURE_STARTING_YEAR; year <= FIXTURE_ENDING_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      rows.push([month, year, FIXTURE_PRIME, FIXTURE_INFLATION].join(","));
    }
  }
  return rows.join("\n");
}

// The game asks for rates by date, and a date is minutes since the start of the scenario
function dateIn(year: number, month: number) {
  const minute = ((year - FIXTURE_STARTING_YEAR) * 12 + (month - 1)) * 1440;
  return getDateFromMinute(minute, FIXTURE_STARTING_YEAR);
}

function primeIn(year: number, month: number, seed = SEED) {
  return getPrimeRate(dateIn(year, month), seed);
}

function inflationIn(year: number, month: number, seed = SEED) {
  return getInflationRate(dateIn(year, month), seed);
}

// Every month of prime from the first projected one onwards, which most of the shape assertions
// below are measured against
function projectedPrimes(years: number, seed = SEED): number[] {
  const series = [];
  for (
    let year = FIXTURE_ENDING_YEAR + 1;
    year <= FIXTURE_ENDING_YEAR + years;
    year++
  ) {
    for (let month = 1; month <= 12; month++) {
      series.push(primeIn(year, month, seed));
    }
  }
  return series;
}

describe("Economy", () => {
  beforeEach(() => {
    initEconomyFromCsv(fixtureCsv());
  });

  it("throws rather than inventing a rate when nothing has been loaded", () => {
    initEconomyFromCsv("month,year,prime,inflation");
    expect(() => primeIn(2005, 6)).toThrow(/No economic data loaded/);
  });

  describe("historic data", () => {
    it("returns the loaded rate for a month the data covers", () => {
      expect(primeIn(2005, 6)).toBeCloseTo(FIXTURE_PRIME / 100, 10);
      expect(inflationIn(2005, 6)).toBeCloseTo(FIXTURE_INFLATION, 10);
    });

    it("reads prime as a fraction, not the percent the CSV stores", () => {
      expect(primeIn(2005, 6)).toBeLessThan(1);
    });
  });

  describe("projection", () => {
    it("picks up where the record leaves off rather than jumping", () => {
      // The seam is the tell: a model that ignores the last observation lands wherever its
      // cycle happens to start, which for a 4.75% record could be anywhere from 3.25% to 15%
      const seam = primeIn(FIXTURE_ENDING_YEAR, 12);
      expect(primeIn(FIXTURE_ENDING_YEAR + 1, 1)).toBeCloseTo(seam, 2);
    });

    it("stays inside the range the economy is allowed to reach", () => {
      projectedPrimes(100).forEach((prime: number) => {
        expect(prime).toBeGreaterThanOrEqual(0.0325);
        expect(prime).toBeLessThanOrEqual(0.15);
      });
    });

    it("rests near its base rather than at its extremes", () => {
      // "Biased towards 5%": most of a century should be spent nearer the resting rate than
      // the ceiling, which is what the cubed amplitude draw buys
      const series = projectedPrimes(100);
      const nearBase = series.filter((p: number) => p < 0.08).length;
      expect(nearBase / series.length).toBeGreaterThan(0.5);
    });

    it("moves in swings that last years, not months", () => {
      // Measured on a year's moving average, so that the quarter point of month to month wobble
      // doesn't get counted as a turn of the cycle. A random walk would wander across its own
      // base line freely; a cycle crosses it twice a turn, so a century of 8-12 year cycles
      // lands somewhere around twenty crossings.
      const series = projectedPrimes(100);
      const smoothed = series
        .slice(11)
        .map((_, i) => series.slice(i, i + 12).reduce((a, b) => a + b, 0) / 12);
      let crossings = 0;
      for (let i = 1; i < smoothed.length; i++) {
        const wasBelow = smoothed[i - 1] < 0.05;
        const isBelow = smoothed[i] < 0.05;
        if (wasBelow !== isBelow) {
          crossings++;
        }
      }
      expect(crossings).toBeGreaterThan(8);
      expect(crossings).toBeLessThan(40);
    });

    it("does not lurch from one month to the next", () => {
      // The counterpart to the cycle test: whatever the shape is, it has to be something a
      // player can plan around. Prime moves in quarter points, not in whole ones.
      const series = projectedPrimes(100);
      for (let i = 1; i < series.length; i++) {
        expect(Math.abs(series[i] - series[i - 1])).toBeLessThan(0.01);
      }
    });

    it("is a pure function of its seed", () => {
      const first = projectedPrimes(20);
      initEconomyFromCsv(fixtureCsv());
      expect(projectedPrimes(20)).toEqual(first);
    });

    it("gives a different economy to a different seed", () => {
      const first = projectedPrimes(20, SEED);
      initEconomyFromCsv(fixtureCsv());
      expect(projectedPrimes(20, SEED + 1)).not.toEqual(first);
    });

    it("projects the same rate cold as it does warm", () => {
      // The cycle chain is built by walking forwards from the seam, so a game resumed years
      // past the data has to land on the same cycle a played one walked into
      const target = FIXTURE_ENDING_YEAR + 30;
      const cold = primeIn(target, 6);
      initEconomyFromCsv(fixtureCsv());
      projectedPrimes(30);
      expect(primeIn(target, 6)).toBeCloseTo(cold, 10);
    });

    it("moves inflation with rates, ahead of them", () => {
      // Inflation leads: the rate response is chasing it. Correlating the two series against
      // each other with inflation shifted forwards should beat correlating them in step.
      const primes = projectedPrimes(60);
      const inflations = [];
      for (
        let year = FIXTURE_ENDING_YEAR + 1;
        year <= FIXTURE_ENDING_YEAR + 60;
        year++
      ) {
        for (let month = 1; month <= 12; month++) {
          inflations.push(inflationIn(year, month));
        }
      }
      // Inflation 18 months ago should track prime today more closely than today's does
      let inStep = 0;
      let lagged = 0;
      for (let i = 18; i < primes.length; i++) {
        inStep += Math.abs(primes[i] - 0.05 - (inflations[i] - 0.025));
        lagged += Math.abs(primes[i] - 0.05 - (inflations[i - 18] - 0.025));
      }
      expect(lagged).toBeLessThan(inStep);
    });
  });

  describe("getInflationIndex", () => {
    it("is exactly 1 on the opening day of a run", () => {
      expect(
        getInflationIndex(
          dateIn(FIXTURE_STARTING_YEAR, 1),
          FIXTURE_STARTING_YEAR,
          SEED,
        ),
      ).toEqual(1);
    });

    it("compounds the record's inflation over the years it covers", () => {
      // Ten years of a flat 1.8% compounds to about 19.6%
      const index = getInflationIndex(
        dateIn(FIXTURE_STARTING_YEAR + 10, 1),
        FIXTURE_STARTING_YEAR,
        SEED,
      );
      expect(index).toBeCloseTo(Math.pow(1 + FIXTURE_INFLATION / 12, 120), 6);
    });

    it("anchors on the game rather than on a fixed year", () => {
      // A run starting in 2010 opens at 1, exactly like one starting in 2000 does
      expect(getInflationIndex(dateIn(2010, 1), 2010, SEED)).toEqual(1);
    });

    it("returns the same index cold as it does warm", () => {
      const target = dateIn(FIXTURE_ENDING_YEAR + 10, 6);
      const cold = getInflationIndex(target, FIXTURE_STARTING_YEAR, SEED);
      initEconomyFromCsv(fixtureCsv());
      for (
        let year = FIXTURE_STARTING_YEAR;
        year <= FIXTURE_ENDING_YEAR + 10;
        year++
      ) {
        getInflationIndex(dateIn(year, 1), FIXTURE_STARTING_YEAR, SEED);
      }
      expect(
        getInflationIndex(target, FIXTURE_STARTING_YEAR, SEED),
      ).toBeCloseTo(cold, 10);
    });
  });
});
