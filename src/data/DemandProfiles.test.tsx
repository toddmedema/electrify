import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { LocationType } from "../Types";
import {
  dataCenterLoadShare,
  DEMAND_TYPES,
  demandByTypeAt,
} from "./DemandProfiles";

const location = (
  admin: string,
  id = admin,
): LocationType & { admin: string } => ({
  id,
  name: id,
  lat: 0,
  long: 0,
  country: "United States",
  region: "North America",
  admin,
});

function total(values: ReturnType<typeof demandByTypeAt>) {
  return DEMAND_TYPES.reduce((sum, type) => sum + values[type], 0);
}

describe("demand profiles", () => {
  it("preserves an authored scenario's opening demand while exposing five components", () => {
    const date = getDateFromMinute(0, 2019);
    const breakdown = demandByTypeAt(1_000_000, date, 2019, location("CA"));

    expect(Object.keys(breakdown)).toEqual(DEMAND_TYPES);
    expect(total(breakdown)).toBeCloseTo(1_000_000);
    DEMAND_TYPES.forEach((type) => expect(breakdown[type]).toBeGreaterThan(0));
  });

  it("introduces data centers around 2000 and accelerates them after 2025", () => {
    const california = location("CA");
    expect(dataCenterLoadShare(1999, california)).toBe(0);
    expect(dataCenterLoadShare(2000, california)).toBeGreaterThan(0);
    expect(
      dataCenterLoadShare(2028, california) -
        dataCenterLoadShare(2025, california),
    ).toBeGreaterThan(
      dataCenterLoadShare(2025, california) -
        dataCenterLoadShare(2022, california),
    );
  });

  it("makes the leading data-center states materially different", () => {
    expect(dataCenterLoadShare(2028, location("VA"))).toBeGreaterThan(
      dataCenterLoadShare(2028, location("CA")),
    );
    expect(dataCenterLoadShare(2028, location("CA"))).toBeGreaterThan(
      dataCenterLoadShare(2028, location("PA")),
    );
  });

  it("allows declining industrial load in the Midwest and growth in Texas", () => {
    const date = getDateFromMinute(10 * 12 * MINUTES_PER_MONTH, 2020);
    const ohio = demandByTypeAt(1_000_000, date, 2020, location("OH"));
    const texas = demandByTypeAt(1_000_000, date, 2020, location("TX"));

    expect(ohio.Industrial).toBeLessThan(
      demandByTypeAt(
        1_000_000,
        getDateFromMinute(0, 2020),
        2020,
        location("OH"),
      ).Industrial,
    );
    expect(texas.Industrial).toBeGreaterThan(ohio.Industrial);
    expect(total(texas)).toBeGreaterThan(total(ohio));
  });

  it("shows residential evenings and commercial middays without changing the opening total", () => {
    const midday = getDateFromMinute(12 * 60, 2020);
    const evening = getDateFromMinute(19 * 60, 2020);
    const city = location("PA");
    const day = demandByTypeAt(1_000_000, midday, 2020, city);
    const night = demandByTypeAt(1_000_000, evening, 2020, city);

    expect(day.Commercial).toBeGreaterThan(night.Commercial);
    expect(night.Residential).toBeGreaterThan(day.Residential);
    expect(Math.abs(total(day) - 1_000_000) / 1_000_000).toBeLessThan(0.001);
    expect(Math.abs(total(night) - 1_000_000) / 1_000_000).toBeLessThan(0.001);
  });
});
