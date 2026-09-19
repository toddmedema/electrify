import { DAYS_PER_MONTH, DAYS_PER_YEAR, DIFFICULTIES } from "../Constants";
import {
  ADJACENT_MARKETS,
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import {
  INTERTIE_ARCHETYPES,
  INTERTIE_ARCHETYPE_IDS,
  IntertieArchetypeIdType,
} from "../data/IntertieArchetypes";
import {
  adjacentMarketPricePerMWh,
  allocateIntertieFlows,
  archetypeMonth,
  clearTransmissionMarket,
  gridStress,
  importAvailabilityFraction,
  IntertieContext,
  intertieContextForGame,
  loadStress,
  neighbourLullFactor,
  neighbourYearFactor,
  transmissionRatingW,
} from "./Transmission";

const line = { corridorId: "california-north", capacityW: 500000000 };

const MINUTES_PER_MONTH = DAYS_PER_MONTH * 1440;
const MINUTES_PER_YEAR = DAYS_PER_YEAR * 1440;
const MILD = { temperatureC: 20 };

/** Game minute for a zero-based month and hour of a zero-based game year */
function minuteAt(month: number, hour: number, year = 0): number {
  return year * MINUTES_PER_YEAR + month * MINUTES_PER_MONTH + hour * 60;
}

function context(overrides: Partial<IntertieContext> = {}): IntertieContext {
  return {
    seed: 1234,
    southernHemisphere: false,
    peakSharingImportLoss: DIFFICULTIES.CEO.peakSharingImportLoss,
    ...overrides,
  };
}

// Picked from the data rather than by name, so reassigning a market's archetype keeps these valid
function corridorFor(archetype: IntertieArchetypeIdType): string {
  const corridor = TRANSMISSION_CORRIDORS.find(
    ({ id }) => adjacentMarketForCorridor(id)?.archetype === archetype,
  );
  if (!corridor) {
    throw new Error(`No intertie corridor reaches a ${archetype} neighbour`);
  }
  return corridor.id;
}

function marketsWith(
  predicate: (archetype: IntertieArchetypeIdType) => boolean,
) {
  return ADJACENT_MARKETS.filter(({ archetype }) => predicate(archetype));
}

describe("transmission ratings", () => {
  it("uses full nameplate in cool shade and derates in hot sun", () => {
    expect(
      transmissionRatingW(line, {
        temperatureC: 20,
        solarIrradianceWM2: 0,
      }),
    ).toBe(500000000);
    expect(
      transmissionRatingW(line, {
        temperatureC: 42,
        solarIrradianceWM2: 1000,
      }),
    ).toBe(408000000);
  });

  it("produces a deterministic offline market price", () => {
    const conditions = { temperatureC: 35, solarIrradianceWM2: 700 };
    const first = adjacentMarketPricePerMWh(
      "california-north",
      context(),
      600,
      conditions,
    );
    expect(
      adjacentMarketPricePerMWh("california-north", context(), 600, conditions),
    ).toBe(first);
    expect(first).toBeGreaterThan(0);
  });
});

describe("intertie context", () => {
  it("reads hemisphere from latitude and the peak-sharing loss from difficulty", () => {
    const north = intertieContextForGame({
      seed: 7,
      location: { lat: 37 } as never,
      difficulty: "Intern",
    });
    const south = intertieContextForGame({
      seed: 7,
      location: { lat: -33 } as never,
      difficulty: "CEO",
    });
    expect(north).toEqual({
      seed: 7,
      southernHemisphere: false,
      peakSharingImportLoss: DIFFICULTIES.Intern.peakSharingImportLoss,
    });
    expect(south.southernHemisphere).toBe(true);
    expect(south.peakSharingImportLoss).toBe(
      DIFFICULTIES.CEO.peakSharingImportLoss,
    );
  });

  it("makes the peak-sharing loss harsher with every difficulty step", () => {
    const losses = (
      ["Intern", "Employee", "Manager", "VP", "CEO"] as const
    ).map((difficulty) => DIFFICULTIES[difficulty].peakSharingImportLoss);
    expect(losses[0]).toBe(0.25);
    expect(losses[4]).toBe(0.5);
    losses
      .slice(1)
      .forEach((loss, i) => expect(loss).toBeGreaterThan(losses[i]));
  });
});

describe("grid stress", () => {
  it("is zero in mild weather", () => {
    expect(gridStress(20)).toEqual({ heat: 0, cold: 0 });
    expect(gridStress(30)).toEqual({ heat: 0, cold: 0 });
    expect(gridStress(-5)).toEqual({ heat: 0, cold: 0 });
  });

  it("ramps linearly to full heat at 38C and full cold at -20C, then clamps", () => {
    expect(gridStress(34).heat).toBeCloseTo(0.5);
    expect(gridStress(38).heat).toBe(1);
    expect(gridStress(50).heat).toBe(1);
    expect(gridStress(-12.5).cold).toBeCloseTo(0.5);
    expect(gridStress(-20).cold).toBe(1);
    expect(gridStress(-45).cold).toBe(1);
  });

  it("never reports heat and cold together", () => {
    for (let t = -50; t <= 55; t += 0.5) {
      const { heat, cold } = gridStress(t);
      expect(heat * cold).toBe(0);
      expect(heat).toBeGreaterThanOrEqual(0);
      expect(cold).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("load stress", () => {
  it("is zero inside the comfort band", () => {
    for (const t of [8, 15, 20, 24]) {
      expect(loadStress(t)).toEqual({ heat: 0, cold: 0 });
    }
  });

  it("ramps linearly to full heat at 34C and full cold at -7C, then clamps", () => {
    expect(loadStress(29).heat).toBeCloseTo(0.5);
    expect(loadStress(34).heat).toBe(1);
    expect(loadStress(45).heat).toBe(1);
    expect(loadStress(0.5).cold).toBeCloseTo(0.5);
    expect(loadStress(-7).cold).toBe(1);
    expect(loadStress(-30).cold).toBe(1);
  });

  it("starts well before extreme-weather grid stress and never reports heat and cold together", () => {
    for (let t = -50; t <= 55; t += 0.5) {
      const load = loadStress(t);
      const grid = gridStress(t);
      expect(load.heat * load.cold).toBe(0);
      expect(load.heat).toBeGreaterThanOrEqual(grid.heat);
      expect(load.cold).toBeGreaterThanOrEqual(grid.cold);
    }
    // A hot temperate summer afternoon or a cold winter evening already registers
    expect(loadStress(30).heat).toBeGreaterThan(0.5);
    expect(gridStress(30).heat).toBe(0);
    expect(loadStress(-3).cold).toBeGreaterThan(0.5);
    expect(gridStress(-3).cold).toBe(0);
  });
});

describe("archetype month", () => {
  it("follows the game calendar in the north", () => {
    expect(archetypeMonth(0, false)).toBe(0);
    expect(archetypeMonth(MINUTES_PER_MONTH - 1, false)).toBe(0);
    expect(archetypeMonth(MINUTES_PER_MONTH, false)).toBe(1);
    expect(archetypeMonth(minuteAt(11, 23), false)).toBe(11);
    // Wraps into the next game year
    expect(archetypeMonth(minuteAt(0, 0, 1), false)).toBe(0);
    expect(archetypeMonth(minuteAt(4, 12, 7), false)).toBe(4);
  });

  it("shifts six months in the south", () => {
    for (let month = 0; month < 12; month++) {
      expect(archetypeMonth(minuteAt(month, 12), true)).toBe((month + 6) % 12);
    }
  });
});

describe("neighbour year factor", () => {
  const variable = marketsWith(
    (id) => INTERTIE_ARCHETYPES[id].yearlyVariability > 0,
  );
  const steady = marketsWith(
    (id) => INTERTIE_ARCHETYPES[id].yearlyVariability === 0,
  );

  it("is 1 for neighbours without wet and dry years", () => {
    expect(steady.length).toBeGreaterThan(0);
    steady.forEach((market) => {
      for (let year = 0; year < 5; year++) {
        expect(neighbourYearFactor(market, 99, minuteAt(3, 3, year))).toBe(1);
      }
    });
  });

  it("is deterministic, bounded and fixed for the whole game year", () => {
    expect(variable.length).toBeGreaterThan(0);
    variable.forEach((market) => {
      for (let year = 0; year < 30; year++) {
        const start = neighbourYearFactor(market, 42, minuteAt(0, 0, year));
        expect(neighbourYearFactor(market, 42, minuteAt(0, 0, year))).toBe(
          start,
        );
        expect(
          neighbourYearFactor(market, 42, (year + 1) * MINUTES_PER_YEAR - 1),
        ).toBe(start);
        expect(start).toBeGreaterThanOrEqual(0.6);
        expect(start).toBeLessThanOrEqual(1.15);
      }
    });
  });

  it("varies across years, seeds and markets", () => {
    const market = variable[0];
    const years = Array.from({ length: 20 }, (_, year) =>
      neighbourYearFactor(market, 42, minuteAt(0, 0, year)),
    );
    expect(new Set(years).size).toBeGreaterThan(10);
    expect(years.some((factor) => factor < 1)).toBe(true);
    expect(years.some((factor) => factor > 1)).toBe(true);
    const otherSeed = years.map((_, year) =>
      neighbourYearFactor(market, 43, minuteAt(0, 0, year)),
    );
    expect(otherSeed).not.toEqual(years);
    expect(variable.length).toBeGreaterThan(1);
    const otherMarket = years.map((_, year) =>
      neighbourYearFactor(variable[1], 42, minuteAt(0, 0, year)),
    );
    expect(otherMarket).not.toEqual(years);
  });
});

describe("neighbour lull factor", () => {
  const gusty = marketsWith((id) => INTERTIE_ARCHETYPES[id].lullChance > 0);
  const steady = marketsWith((id) => INTERTIE_ARCHETYPES[id].lullChance === 0);

  it("is 1 for neighbours without calm spells", () => {
    steady.forEach((market) => {
      for (let day = 0; day < 24; day++) {
        expect(neighbourLullFactor(market, 5, day * 1440)).toBe(1);
      }
    });
  });

  it("holds for a whole simulated day and lands near the authored chance", () => {
    expect(gusty.length).toBeGreaterThan(0);
    gusty.forEach((market) => {
      const archetype = INTERTIE_ARCHETYPES[market.archetype];
      const days = 3000;
      let lulls = 0;
      for (let day = 0; day < days; day++) {
        const start = neighbourLullFactor(market, 5, day * 1440);
        if (start !== 1 && start !== archetype.lullAvailability) {
          throw new Error(`Unexpected lull factor ${start}`);
        }
        if (neighbourLullFactor(market, 5, day * 1440 + 1439) !== start) {
          throw new Error(`Lull changed within day ${day}`);
        }
        if (start < 1) lulls++;
      }
      expect(lulls / days).toBeGreaterThan(archetype.lullChance - 0.04);
      expect(lulls / days).toBeLessThan(archetype.lullChance + 0.04);
    });
  });

  it("gives each seed its own calm days", () => {
    const market = gusty[0];
    const run = (seed: number) =>
      Array.from({ length: 200 }, (_, day) =>
        neighbourLullFactor(market, seed, day * 1440),
      );
    expect(run(5)).toEqual(run(5));
    expect(run(6)).not.toEqual(run(5));
  });
});

describe("import availability", () => {
  it("stays within 0..1 for every corridor, season, hour and temperature", () => {
    for (const { id } of TRANSMISSION_CORRIDORS) {
      for (const southernHemisphere of [false, true]) {
        for (let month = 0; month < 12; month += 3) {
          for (const hour of [3, 12, 19]) {
            for (const temperatureC of [-30, -10, 20, 34, 45]) {
              const fraction = importAvailabilityFraction(
                id,
                context({ southernHemisphere }),
                minuteAt(month, hour, 2),
                { temperatureC },
              );
              expect(fraction).toBeGreaterThanOrEqual(0);
              expect(fraction).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it("is zero for an unknown corridor", () => {
    expect(importAvailabilityFraction("nowhere", context(), 0, MILD)).toBe(0);
  });

  it("follows each archetype's seasonal and daily shape before luck", () => {
    INTERTIE_ARCHETYPE_IDS.forEach((archetypeId) => {
      const archetype = INTERTIE_ARCHETYPES[archetypeId];
      const corridorId = corridorFor(archetypeId);
      const market = adjacentMarketForCorridor(corridorId)!;
      for (const [month, hour] of [
        [0, 3],
        [4, 12],
        [8, 19],
      ]) {
        const minute = minuteAt(month, hour, 1);
        const luck =
          neighbourYearFactor(market, 1234, minute) *
          neighbourLullFactor(market, 1234, minute);
        expect(
          importAvailabilityFraction(corridorId, context(), minute, MILD),
        ).toBeCloseTo(
          Math.min(
            1,
            archetype.monthlyAvailability[month] *
              archetype.hourlyAvailability[hour] *
              luck,
          ),
          10,
        );
      }
    });
  });

  it("leaves a solar neighbour less to spare in the evening than at midday", () => {
    const corridorId = corridorFor("SOLAR_HEAVY");
    for (let seed = 1; seed <= 20; seed++) {
      for (let month = 0; month < 12; month++) {
        const midday = importAvailabilityFraction(
          corridorId,
          context({ seed }),
          minuteAt(month, 12),
          MILD,
        );
        const evening = importAvailabilityFraction(
          corridorId,
          context({ seed }),
          minuteAt(month, 19),
          MILD,
        );
        expect(evening).toBeLessThan(midday);
      }
    }
  });

  it("gives seasonal hydro less in September than during May snowmelt, flipped in the south", () => {
    const corridorId = corridorFor("SEASONAL_HYDRO");
    for (let seed = 1; seed <= 20; seed++) {
      const at = (month: number, southernHemisphere: boolean) =>
        importAvailabilityFraction(
          corridorId,
          context({ seed, southernHemisphere }),
          minuteAt(month, 12),
          MILD,
        );
      expect(at(8, false)).toBeLessThan(at(4, false));
      // Southern September is northern March; southern May is northern November
      expect(at(8, true)).toBeGreaterThan(at(4, true));
    }
  });

  it("cuts a peak-sharing neighbour by exactly the difficulty's share at full heat or cold", () => {
    const corridorId = corridorFor("PEAK_SHARING");
    const minute = minuteAt(6, 18, 1);
    for (const difficulty of ["Intern", "CEO"] as const) {
      const loss = DIFFICULTIES[difficulty].peakSharingImportLoss;
      const ctx = context({ peakSharingImportLoss: loss });
      const unstressed = importAvailabilityFraction(
        corridorId,
        ctx,
        minute,
        MILD,
      );
      expect(unstressed).toBeGreaterThan(0);
      // A peak-sharing neighbour follows load stress, which is full from 34C and from -7C
      for (const temperatureC of [34, 45, -7, -30]) {
        expect(
          importAvailabilityFraction(corridorId, ctx, minute, {
            temperatureC,
          }),
        ).toBeCloseTo(unstressed * (1 - loss), 10);
      }
      // Half stress costs half the share
      for (const temperatureC of [29, 0.5]) {
        expect(
          importAvailabilityFraction(corridorId, ctx, minute, {
            temperatureC,
          }),
        ).toBeCloseTo(unstressed * (1 - loss / 2), 10);
      }
      // Inside the comfort band it keeps its full share
      expect(
        importAvailabilityFraction(corridorId, ctx, minute, {
          temperatureC: 24,
        }),
      ).toBeCloseTo(unstressed, 10);
    }
    const intern = importAvailabilityFraction(
      corridorId,
      context({
        peakSharingImportLoss: DIFFICULTIES.Intern.peakSharingImportLoss,
      }),
      minute,
      { temperatureC: 40 },
    );
    const ceo = importAvailabilityFraction(
      corridorId,
      context({
        peakSharingImportLoss: DIFFICULTIES.CEO.peakSharingImportLoss,
      }),
      minute,
      { temperatureC: 40 },
    );
    expect(ceo / intern).toBeCloseTo((1 - 0.5) / (1 - 0.25), 10);
  });

  it("applies each other archetype's own stress loss regardless of difficulty", () => {
    INTERTIE_ARCHETYPE_IDS.filter((id) => id !== "PEAK_SHARING").forEach(
      (archetypeId) => {
        const archetype = INTERTIE_ARCHETYPES[archetypeId];
        const corridorId = corridorFor(archetypeId);
        const minute = minuteAt(2, 11, 1);
        const unstressed = importAvailabilityFraction(
          corridorId,
          context(),
          minute,
          MILD,
        );
        for (const loss of [0.25, 0.5]) {
          const ctx = context({ peakSharingImportLoss: loss });
          expect(
            importAvailabilityFraction(corridorId, ctx, minute, {
              temperatureC: 40,
            }),
          ).toBeCloseTo(unstressed * (1 - archetype.heatStressLoss!), 10);
          expect(
            importAvailabilityFraction(corridorId, ctx, minute, {
              temperatureC: -25,
            }),
          ).toBeCloseTo(unstressed * (1 - archetype.coldStressLoss!), 10);
        }
      },
    );
  });
});

describe("adjacent market prices", () => {
  it("is zero for an unknown corridor", () => {
    expect(adjacentMarketPricePerMWh("nowhere", context(), 0, MILD)).toBe(0);
  });

  it("never drops below the $5 floor and rounds to 10 cents", () => {
    for (const { id } of TRANSMISSION_CORRIDORS) {
      for (let hour = 0; hour < 24; hour += 5) {
        const price = adjacentMarketPricePerMWh(
          id,
          context(),
          minuteAt(hour % 12, hour, 3),
          MILD,
        );
        expect(price).toBeGreaterThanOrEqual(5);
        expect(Math.round(price * 10)).toBeCloseTo(price * 10, 8);
      }
    }
  });

  it("makes solar-surplus power cheap at midday and dear in the evening", () => {
    const corridorId = corridorFor("SOLAR_HEAVY");
    for (let seed = 1; seed <= 20; seed++) {
      for (const month of [0, 6]) {
        expect(
          adjacentMarketPricePerMWh(
            corridorId,
            context({ seed }),
            minuteAt(month, 12),
            MILD,
          ),
        ).toBeLessThan(
          adjacentMarketPricePerMWh(
            corridorId,
            context({ seed }),
            minuteAt(month, 19),
            MILD,
          ),
        );
      }
    }
  });

  it("adds each archetype's heat and cold premium at full stress", () => {
    INTERTIE_ARCHETYPE_IDS.forEach((archetypeId) => {
      const archetype = INTERTIE_ARCHETYPES[archetypeId];
      const corridorId = corridorFor(archetypeId);
      const minute = minuteAt(3, 12, 1);
      const calm = adjacentMarketPricePerMWh(
        corridorId,
        context(),
        minute,
        MILD,
      );
      const hot = adjacentMarketPricePerMWh(corridorId, context(), minute, {
        temperatureC: 40,
      });
      const cold = adjacentMarketPricePerMWh(corridorId, context(), minute, {
        temperatureC: -25,
      });
      // Both rounded to 10 cents from the same noise draw
      expect(Math.abs(hot - calm - archetype.heatStressPremium)).toBeLessThan(
        0.11,
      );
      expect(Math.abs(cold - calm - archetype.coldStressPremium)).toBeLessThan(
        0.11,
      );
    });
  });

  it("shifts monthly price shapes six months in the south", () => {
    INTERTIE_ARCHETYPE_IDS.forEach((archetypeId) => {
      const offsets = INTERTIE_ARCHETYPES[archetypeId].monthlyPriceOffset;
      const corridorId = corridorFor(archetypeId);
      for (const month of [0, 4, 8]) {
        const minute = minuteAt(month, 12, 1);
        const north = adjacentMarketPricePerMWh(
          corridorId,
          context(),
          minute,
          MILD,
        );
        const south = adjacentMarketPricePerMWh(
          corridorId,
          context({ southernHemisphere: true }),
          minute,
          MILD,
        );
        expect(
          Math.abs(
            south - north - (offsets[(month + 6) % 12] - offsets[month]),
          ),
        ).toBeLessThan(0.11);
      }
    });
  });
});

describe("intertie merit order", () => {
  const offer = (
    pricePerMWh: number,
    importLimitW = 100,
    exportLimitW = 100,
  ) => ({
    pricePerMWh,
    importLimitW,
    exportLimitW,
  });

  it("imports from the cheapest neighbour first", () => {
    expect(
      allocateIntertieFlows([offer(50), offer(30), offer(40)], 150, 0),
    ).toEqual({ importedW: [0, 100, 50], exportedW: [0, 0, 0] });
  });

  it("respects each line's import limit and never invents flow", () => {
    const offers = [offer(20, 40), offer(30, 100), offer(10, 0)];
    expect(allocateIntertieFlows(offers, 120, 0).importedW).toEqual([
      40, 80, 0,
    ]);
    const capped = allocateIntertieFlows(offers, 1000, 0).importedW;
    expect(capped).toEqual([40, 100, 0]);
  });

  it("sells exports to the best-paying neighbour first", () => {
    expect(
      allocateIntertieFlows(
        [offer(50), offer(30, 100, 500), offer(70, 100, 60)],
        0,
        150,
      ),
    ).toEqual({ importedW: [0, 0, 0], exportedW: [90, 0, 60] });
  });

  it("breaks price ties by line order in both directions", () => {
    const tied = [offer(40), offer(40), offer(40)];
    expect(allocateIntertieFlows(tied, 150, 0).importedW).toEqual([100, 50, 0]);
    expect(allocateIntertieFlows(tied, 0, 150).exportedW).toEqual([100, 50, 0]);
  });

  it("allocates nothing when nothing clears", () => {
    expect(allocateIntertieFlows([offer(40), offer(60)], 0, 0)).toEqual({
      importedW: [0, 0],
      exportedW: [0, 0],
    });
    expect(allocateIntertieFlows([], 100, 100)).toEqual({
      importedW: [],
      exportedW: [],
    });
  });

  it("splits exactly the cleared total when the lines can carry it", () => {
    const offers = [offer(33.3, 123.4), offer(12.1, 56.7), offer(80, 999)];
    const { importedW } = allocateIntertieFlows(offers, 700.5, 0);
    expect(importedW.reduce((a, b) => a + b, 0)).toBeCloseTo(700.5, 9);
    importedW.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(offers[i].importLimitW);
    });
  });
});

describe("market clearing", () => {
  it("imports only the shortage and respects line capacity", () => {
    expect(
      clearTransmissionMarket({
        localSupplyW: 700,
        demandW: 1000,
        capacityW: 200,
        importLimitW: 500,
        exportLimitW: 500,
        policy: "BALANCED",
      }),
    ).toEqual({ importedW: 200, exportedW: 0, localAvailableSupplyW: 900 });
  });

  it("exports actual surplus without burning an energy reserve", () => {
    expect(
      clearTransmissionMarket({
        localSupplyW: 1400,
        demandW: 1000,
        capacityW: 500,
        importLimitW: 500,
        exportLimitW: 500,
        policy: "SURPLUS_ONLY",
      }),
    ).toEqual({ importedW: 0, exportedW: 400, localAvailableSupplyW: 1000 });
  });

  it("keeps the line idle when trading is closed", () => {
    expect(
      clearTransmissionMarket({
        localSupplyW: 500,
        demandW: 1000,
        capacityW: 500,
        importLimitW: 500,
        exportLimitW: 500,
        policy: "CLOSED",
      }),
    ).toEqual({ importedW: 0, exportedW: 0, localAvailableSupplyW: 500 });
  });
  it("covers the exact demand when fractional imports completely fill a shortage", () => {
    const request = {
      localSupplyW: 27297688.384615093,
      demandW: 355728534.5312337,
      capacityW: 500000000,
      importLimitW: 500000000,
      exportLimitW: 500000000,
      policy: "RELIABILITY_FIRST" as const,
    };
    expect(clearTransmissionMarket(request).localAvailableSupplyW).toBe(
      request.demandW,
    );
    const capped = clearTransmissionMarket({
      ...request,
      importLimitW: 300000000,
    });
    expect(capped.localAvailableSupplyW).toBe(request.localSupplyW + 300000000);
    expect(capped.localAvailableSupplyW).toBeLessThan(request.demandW);
  });
});
