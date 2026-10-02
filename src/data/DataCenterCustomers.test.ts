import { LOCATIONS } from "../Constants";
import { REGION_ORDER } from "./Cities";
import { getDataCenterCustomerProfile } from "./DataCenterCustomers";

describe("data-center customer source boundaries", () => {
  it("uses electricity accounts instead of population or combined utility accounts", () => {
    expect(getDataCenterCustomerProfile(LOCATIONS.HNL)).toMatchObject({
      customers: 309839,
      sourceYear: 2024,
      basis: "local-utility",
      serviceArea: "Hawaiian Electric, Oahu",
    });
    expect(
      getDataCenterCustomerProfile({ ...LOCATIONS.PIT, id: "Dubai" }).customers,
    ).toBe(1225639);
  });

  it("does not apply a city's utility count to another city in the same state", () => {
    const sanFrancisco = getDataCenterCustomerProfile(LOCATIONS.SF);
    const otherCalifornia = getDataCenterCustomerProfile({
      ...LOCATIONS.SF,
      id: "UnresearchedCaliforniaCity",
      name: "Another California city",
    });
    expect(sanFrancisco.basis).toBe("local-utility");
    expect(otherCalifornia.basis).toBe("reference-utility");
    expect(otherCalifornia.note).toContain(
      "not an estimate for Another California city",
    );
    expect(otherCalifornia.customers).not.toBe(sanFrancisco.customers);
  });

  it.each(REGION_ORDER)(
    "identifies a sourced reference for %s without claiming local research",
    (region) => {
      const profile = getDataCenterCustomerProfile({
        ...LOCATIONS.PIT,
        id: "UnresearchedCity",
        name: "Unresearched city",
        region,
      });
      expect(profile.basis).toBe("reference-utility");
      expect(profile.customers).toBeGreaterThan(0);
      expect(Number.isInteger(profile.customers)).toBe(true);
      expect(profile.sourceUrl).toMatch(/^https:\/\//);
      expect(profile.note).toContain(profile.serviceArea);
      expect(profile.note).toContain("No verified local account count");
    },
  );
});
