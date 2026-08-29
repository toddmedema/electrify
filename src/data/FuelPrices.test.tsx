import {
  getFuelEscalation,
  hasFuelPrices,
  initFuelPrices,
  getFuelPricesPerMBTU,
  initFuelPricesFromCsv,
  LATEST_DATA_YEAR,
  TREND_ESCALATION_YEARLY,
} from "./FuelPrices";
import { getDateFromMinute } from "../helpers/DateTime";
import { FuelPricesType } from "../Types";

const FIXTURE_STARTING_YEAR = 2000;
const FIXTURE_YEARS = 20;
const FIXTURE_ENDING_YEAR = FIXTURE_STARTING_YEAR + FIXTURE_YEARS - 1;
const SEED = 1;

// What each fuel costs in the fixture's first month, and how far it wobbles around its own trend
// across the record, in log terms. Deliberately different per fuel: the projection measures each
// fuel's spread from its own history rather than sharing one number, the way the real coal series
// sits within 20% of its trend while oil swings by half again.
interface FixtureFuelType {
  column: string;
  name: string;
  base: number;
  trendYearly: number;
  swing: number;
}
const FIXTURE_FUELS: FixtureFuelType[] = [
  {
    column: "biomass",
    name: "Biomass",
    base: 1.5,
    trendYearly: 0.025,
    swing: 0.15,
  },
  { column: "coal", name: "Coal", base: 2, trendYearly: 0.03, swing: 0.2 },
  {
    column: "naturalgas",
    name: "Natural Gas",
    base: 3,
    trendYearly: 0.02,
    swing: 0.25,
  },
  {
    column: "uranium",
    name: "Uranium",
    base: 0.7,
    trendYearly: 0.02,
    swing: 0.5,
  },
  { column: "oil", name: "Oil", base: 10, trendYearly: 0.035, swing: 0.45 },
];
const COAL = FIXTURE_FUELS.find((fuel) => fuel.name === "Coal")!;
const NATURAL_GAS = FIXTURE_FUELS.find((fuel) => fuel.name === "Natural Gas")!;

// A trend with a slow cycle riding on it, which is the shape a fuel price actually has -- and,
// unlike the flat series this fixture used to be, something the projection can measure a spread
// and a reversion speed from. Five year period, so twenty years holds four full cycles.
const CYCLE_MONTHS = 60;
function fixturePrice(fuel: FixtureFuelType, monthsIn: number): number {
  return (
    fuel.base *
    Math.pow(1 + fuel.trendYearly, monthsIn / 12) *
    Math.exp(fuel.swing * Math.sin((2 * Math.PI * monthsIn) / CYCLE_MONTHS))
  );
}

function fixtureCsv(): string {
  const rows = ["year,month,biomass,naturalgas,coal,uranium,oil"];
  for (let year = FIXTURE_STARTING_YEAR; year <= FIXTURE_ENDING_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      const monthsIn = (year - FIXTURE_STARTING_YEAR) * 12 + (month - 1);
      const by = (column: string) =>
        fixturePrice(
          FIXTURE_FUELS.find((f: FixtureFuelType) => f.column === column)!,
          monthsIn,
        ).toFixed(6);
      rows.push(
        [
          year,
          month,
          by("biomass"),
          by("naturalgas"),
          by("coal"),
          by("uranium"),
          by("oil"),
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

// A flat record, for the degenerate case: a fuel that never moved has no spread to reproduce
function flatCsv(): string {
  const rows = ["year,month,biomass,naturalgas,coal,uranium,oil"];
  for (let year = FIXTURE_STARTING_YEAR; year <= FIXTURE_ENDING_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      rows.push([year, month, 1.5, 3, 2, 0.7, 10].join(","));
    }
  }
  return rows.join("\n");
}

// The game asks for prices by date, and a date is minutes since the start of the scenario
function dateIn(year: number, month: number) {
  const minute = ((year - FIXTURE_STARTING_YEAR) * 12 + (month - 1)) * 1440;
  return getDateFromMinute(minute, FIXTURE_STARTING_YEAR);
}

function pricesIn(year: number, month: number, seed = SEED): FuelPricesType {
  return getFuelPricesPerMBTU(dateIn(year, month), seed);
}

/**
 * The level the projection ties a fuel to in a given year: the last recorded year's average,
 * escalated from there. Worked out from the fixture rather than read back out of the module, so
 * that these tests would notice the module changing its mind about either half of it.
 */
function trendPriceIn(fuel: FixtureFuelType, year: number): number {
  let recorded = 0;
  for (let month = 0; month < 12; month++) {
    recorded += fixturePrice(fuel, (FIXTURE_YEARS - 1) * 12 + month);
  }
  return (
    (recorded / 12) *
    Math.pow(1 + TREND_ESCALATION_YEARLY, year - FIXTURE_ENDING_YEAR)
  );
}

describe("getFuelPricesPerMBTU", () => {
  beforeEach(() => {
    initFuelPricesFromCsv(fixtureCsv());
  });

  it("returns the loaded prices for a year the data covers", () => {
    const prices = pricesIn(FIXTURE_STARTING_YEAR, 6);
    FIXTURE_FUELS.forEach((fuel: FixtureFuelType) => {
      expect(prices[fuel.name]).toBeCloseTo(fixturePrice(fuel, 5), 5);
    });
  });

  it("fills biomass from EIA's annual history when the legacy CSV has no column", () => {
    initFuelPricesFromCsv(
      "year,month,naturalgas,coal,uranium,oil\n2018,1,3,2,0.7,10",
    );
    expect(getFuelPricesPerMBTU(dateIn(2018, 1), SEED).Biomass).toBe(2.15);
  });

  it("keeps the US history but applies regional fuel-price levels", () => {
    const date = dateIn(FIXTURE_STARTING_YEAR, 6);
    const us = getFuelPricesPerMBTU(date, SEED);
    const europe = getFuelPricesPerMBTU(date, SEED, {
      id: "Paris",
      name: "Paris",
      lat: 48.8566,
      long: 2.3522,
      region: "Europe",
      country: "France",
    });
    expect(europe["Natural Gas"]).toBeCloseTo(us["Natural Gas"] * 3);
    expect(europe.Coal).toBeCloseTo(us.Coal * 1.5);
    expect(Object.isFrozen(europe)).toBe(true);
  });

  it("makes coal cheaper in Australia and Indonesia", () => {
    const date = dateIn(FIXTURE_STARTING_YEAR, 6);
    const us = getFuelPricesPerMBTU(date, SEED);
    const australia = getFuelPricesPerMBTU(date, SEED, {
      id: "Sydney",
      name: "Sydney",
      lat: -33.8688,
      long: 151.2093,
      region: "Oceania",
      country: "Australia",
    });
    expect(australia.Coal).toBeCloseTo(us.Coal * 0.6);
  });

  it("projects prices past the end of the data", () => {
    const projected = pricesIn(FIXTURE_ENDING_YEAR + 3, 6);
    Object.values(projected).forEach((price: number) => {
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    });
  });

  // The bug this replaced: a cold cache jumped straight from the last loaded year to the year
  // asked for, skipping the compounding in between, so a game loaded years past the data picked
  // up prices nowhere near the ones it was saved with
  it("projects the same prices cold as it does warm", () => {
    const target = FIXTURE_ENDING_YEAR + 20;
    for (let year = FIXTURE_ENDING_YEAR + 1; year <= target; year++) {
      pricesIn(year, 12); // Walk there a year at a time, the way a played game does
    }
    const walked = { ...pricesIn(target, 6) };

    initFuelPricesFromCsv(fixtureCsv()); // Back to a cache holding only the loaded data
    expect(pricesIn(target, 6)).toEqual(walked);
  });

  it("projects different prices for a different seed", () => {
    const first = { ...pricesIn(FIXTURE_ENDING_YEAR + 1, 6) };
    initFuelPricesFromCsv(fixtureCsv());
    expect(pricesIn(FIXTURE_ENDING_YEAR + 1, 6, SEED + 1)).not.toEqual(first);
  });

  // FuelPricesRaw.csv happens not to end in a newline, which is the only reason the trailing
  // blank row the old reader handed back never landed in the table as year NaN. Adding one to the
  // file should stay a whitespace change.
  it("reads a file ending in a newline the same as one that does not", () => {
    const withNewline = { ...pricesIn(FIXTURE_STARTING_YEAR, 6) };
    initFuelPricesFromCsv(fixtureCsv() + "\n");
    expect(pricesIn(FIXTURE_STARTING_YEAR, 6)).toEqual(withNewline);
  });

  it("explains itself rather than hanging when nothing has been loaded", () => {
    initFuelPricesFromCsv("year,month,biomass,naturalgas,coal,uranium,oil");
    expect(() => pricesIn(FIXTURE_STARTING_YEAR, 1)).toThrow(
      /No fuel prices loaded/,
    );
  });

  // Handed out by reference rather than copied per tick, so a caller that wrote to one would be
  // rewriting the record for every read after it
  it("hands back prices nothing can write to", () => {
    const prices = pricesIn(FIXTURE_STARTING_YEAR, 6);
    expect(() => {
      (prices as FuelPricesType).Coal = 999;
    }).toThrow();
  });

  // The same, for a month the projection invented rather than one the record carried
  it("hands back projected prices nothing can write to", () => {
    const prices = pricesIn(FIXTURE_ENDING_YEAR + 5, 6);
    expect(() => {
      (prices as FuelPricesType).Coal = 999;
    }).toThrow();
  });

  // The projection carries the last recorded month's departure from trend forward rather than
  // restarting at the trend, so the handoff out of the data is a month's move, not a step change
  it("picks up where the record left off rather than jumping", () => {
    const last = pricesIn(FIXTURE_ENDING_YEAR, 12);
    const first = pricesIn(FIXTURE_ENDING_YEAR + 1, 1);
    FIXTURE_FUELS.forEach((fuel: FixtureFuelType) => {
      expect(first[fuel.name] / last[fuel.name]).toBeGreaterThan(0.75);
      expect(first[fuel.name] / last[fuel.name]).toBeLessThan(1.35);
    });
  });

  /**
   * The reason any of this exists. The projection used to be an unbounded multiplicative random
   * walk, so its spread grew with the square root of the horizon: tolerable over the twenty years
   * a game could once cover, and nonsense over the two hundred it now can, where one seed left
   * natural gas at three cents per MBTU -- free fuel -- for the rest of the run. Tied to a trend,
   * the spread settles instead of growing.
   */
  describe("mean reversion", () => {
    const SEEDS = Array.from(
      { length: 40 },
      (_v: unknown, i: number) => i * 7919 + 3,
    );

    it("holds every fuel near its trend two centuries out", () => {
      SEEDS.slice(0, 12).forEach((seed: number) => {
        initFuelPricesFromCsv(fixtureCsv());
        const year = FIXTURE_ENDING_YEAR + 200;
        const prices = pricesIn(year, 6, seed);
        FIXTURE_FUELS.forEach((fuel: FixtureFuelType) => {
          // Clamped at three standard deviations of each fuel's own recorded spread, so how far
          // a fuel may ever sit from its trend is a property of its history rather than a
          // constant, and a calm fuel stays calm
          const ratio = prices[fuel.name] / trendPriceIn(fuel, year);
          expect(ratio).toBeGreaterThan(Math.exp(-3 * fuel.swing));
          expect(ratio).toBeLessThan(Math.exp(3 * fuel.swing));
        });
      });
    });

    it("does not widen as the horizon grows, the way a random walk does", () => {
      const spreadAt = (year: number) => {
        const departures = SEEDS.map((seed: number) => {
          initFuelPricesFromCsv(fixtureCsv());
          return Math.log(
            pricesIn(year, 6, seed)[NATURAL_GAS.name] /
              trendPriceIn(NATURAL_GAS, year),
          );
        });
        const mean = departures.reduce((a, b) => a + b, 0) / departures.length;
        return Math.sqrt(
          departures.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
            departures.length,
        );
      };

      // A random walk's spread would grow like the square root of the horizon -- nearly
      // threefold across this gap. Settling means the far one is no wider than the near one.
      const near = spreadAt(FIXTURE_ENDING_YEAR + 25);
      const far = spreadAt(FIXTURE_ENDING_YEAR + 200);
      expect(far).toBeLessThan(near * 1.6);
      expect(far).toBeLessThan(2 * NATURAL_GAS.swing);
    });

    it("escalates the trend it reverts to by TREND_ESCALATION_YEARLY", () => {
      const years = 60;
      const year = FIXTURE_ENDING_YEAR + years;
      // Averaged across seeds the departure comes out at zero, which leaves the escalation alone
      const departures = SEEDS.map((seed: number) => {
        initFuelPricesFromCsv(fixtureCsv());
        return Math.log(
          pricesIn(year, 6, seed)[COAL.name] / trendPriceIn(COAL, year),
        );
      });
      const meanDeparture =
        departures.reduce((a, b) => a + b, 0) / departures.length;
      const impliedYearly =
        Math.exp(
          Math.log(1 + TREND_ESCALATION_YEARLY) + meanDeparture / years,
        ) - 1;
      expect(impliedYearly).toBeCloseTo(TREND_ESCALATION_YEARLY, 2);
    });

    // Documents the degenerate case rather than leaving it to be found: a fuel whose record never
    // moves has no spread to reproduce, so it rides its trend exactly
    it("holds a fuel with no recorded variation on its trend", () => {
      initFuelPricesFromCsv(flatCsv());
      const year = FIXTURE_ENDING_YEAR + 30;
      expect(pricesIn(year, 12)[COAL.name]).toBeCloseTo(
        2 * Math.pow(1 + TREND_ESCALATION_YEARLY, year - FIXTURE_ENDING_YEAR),
        4,
      );
    });
  });
});

/**
 * What the custom game screen re-quotes its rates and fees with. Fuel is the only price the game
 * reads at face value for the year it is in -- build costs and O&M are anchored on whatever year
 * a game starts -- so without this a game started deep in the projection is unwinnable before the
 * player touches anything.
 */
describe("getFuelEscalation", () => {
  it("is flat across the years the data actually covers", () => {
    expect(getFuelEscalation(LATEST_DATA_YEAR)).toBe(1);
    expect(getFuelEscalation(1980)).toBe(1);
  });

  it("compounds at TREND_ESCALATION_YEARLY past the end of the data", () => {
    expect(getFuelEscalation(LATEST_DATA_YEAR + 1)).toBeCloseTo(
      1 + TREND_ESCALATION_YEARLY,
      10,
    );
    expect(getFuelEscalation(LATEST_DATA_YEAR + 50)).toBeCloseTo(
      Math.pow(1 + TREND_ESCALATION_YEARLY, 50),
      10,
    );
  });

  // The number the rate picker leans on: a game starting sixty years past the record is played
  // against fuel an order of magnitude dearer, so its rates have to be an order of magnitude up
  it("puts a 2080 start an order of magnitude above the record", () => {
    expect(getFuelEscalation(2080)).toBeGreaterThan(9);
    expect(getFuelEscalation(2080)).toBeLessThan(12);
  });
});

// The download path, which the loading screen is the only caller of. What is pinned here is that a
// failed fetch reports the reason rather than leaving that screen waiting on a callback that never
// comes -- there is no partial record to carry on with, so the game cannot start either way.
describe("initFuelPrices", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("loads the record and calls back with no failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          "month,year,biomass,coal,naturalgas,uranium,oil\n12,2019,2.28,2.9,1.09,0.0011,9.76",
        ),
    }) as unknown as typeof fetch;
    const failure = await new Promise((resolve) => initFuelPrices(resolve));
    expect(failure).toBeUndefined();
    expect(hasFuelPrices()).toBe(true);
  });

  it("calls back with the status when the file cannot be fetched", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const failure = await new Promise((resolve) => initFuelPrices(resolve));
    expect(failure).toMatch(/fuel price record/);
    expect(failure).toMatch(/404/);
  });

  it("calls back with the reason when the network is down", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    const failure = await new Promise((resolve) => initFuelPrices(resolve));
    expect(failure).toMatch(/offline/);
  });
});
