import {
  adjacentMarketPricePerMWh,
  clearTransmissionMarket,
  transmissionRatingW,
} from "./Transmission";

const line = { corridorId: "california-north", capacityW: 500000000 };

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
      1234,
      600,
      conditions,
    );
    expect(
      adjacentMarketPricePerMWh("california-north", 1234, 600, conditions),
    ).toBe(first);
    expect(first).toBeGreaterThan(0);
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
        reserveMargin: 0.15,
        policy: "BALANCED",
      }),
    ).toEqual({ importedW: 200, exportedW: 0, localAvailableSupplyW: 900 });
  });

  it("exports only above demand plus the reserve margin", () => {
    expect(
      clearTransmissionMarket({
        localSupplyW: 1400,
        demandW: 1000,
        capacityW: 500,
        importLimitW: 500,
        exportLimitW: 500,
        reserveMargin: 0.15,
        policy: "SURPLUS_ONLY",
      }),
    ).toEqual({ importedW: 0, exportedW: 250, localAvailableSupplyW: 1150 });
  });

  it("keeps the line idle when trading is closed", () => {
    expect(
      clearTransmissionMarket({
        localSupplyW: 500,
        demandW: 1000,
        capacityW: 500,
        importLimitW: 500,
        exportLimitW: 500,
        reserveMargin: 0.15,
        policy: "CLOSED",
      }),
    ).toEqual({ importedW: 0, exportedW: 0, localAvailableSupplyW: 500 });
  });
});
