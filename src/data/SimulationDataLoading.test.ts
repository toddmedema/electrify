import { hasEconomy, initEconomy } from "./Economy";
import { hasFuelPrices, initFuelPrices } from "./FuelPrices";

// Both CSV loaders must finish their callback on success, HTTP failure and network failure.
describe.each([
  {
    name: "economy",
    init: initEconomy,
    loaded: hasEconomy,
    record: "economic record",
    csv: "month,year,prime,inflation\n12,2019,4.75,0.0180",
  },
  {
    name: "fuel prices",
    init: initFuelPrices,
    loaded: hasFuelPrices,
    record: "fuel price record",
    csv: "month,year,biomass,coal,naturalgas,uranium,oil\n12,2019,2.28,2.9,1.09,0.0011,9.76",
  },
])("$name CSV download", ({ init, loaded, record, csv }) => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("loads the record and calls back without a failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(csv),
    });
    const failure = await new Promise((resolve) => init(resolve));
    expect(failure).toBeUndefined();
    expect(loaded()).toBe(true);
  });

  it.each(["HTTP", "network"] as const)(
    "reports a %s failure through the callback",
    async (transport) => {
      global.fetch =
        transport === "HTTP"
          ? jest.fn().mockResolvedValue({ ok: false, status: 404 })
          : jest.fn().mockRejectedValue(new Error("offline"));
      const failure = await new Promise((resolve) => init(resolve));
      expect(failure).toContain(record);
      expect(failure).toContain(transport === "HTTP" ? "404" : "offline");
    },
  );
});
