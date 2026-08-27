import { getDateFromMinute } from "../helpers/DateTime";
import { LOCATIONS } from "../Constants";
import { resolveWorldEvent, WorldEventDefinitionType } from "./WorldEvents";

const definition: WorldEventDefinitionType = {
  id: "test-storm",
  probabilityPerMonth: 1,
  durationMonths: 1,
  describe: (_context, random) => {
    const size = Math.round(10 + random("size") * 90);
    return {
      kind: "FUEL_PRICE",
      message: `Test storm ${size}`,
      attributes: { size },
      effects: { demandMultiplier: 1 + size / 1000 },
    };
  },
};

function occurrence(seed: number, location = LOCATIONS.SF, minute = 0) {
  return resolveWorldEvent(definition, {
    seed,
    location,
    date: getDateFromMinute(minute, 2020),
  }).occurrence;
}

describe("deterministic world events", () => {
  it("replays the same occurrence and attributes for the same seed, place and time", () => {
    expect(occurrence(12345)).toEqual(occurrence(12345));
  });

  it("addresses randomness by location, time and seed", () => {
    const baseline = occurrence(12345);
    expect(occurrence(54321)?.attributes).not.toEqual(baseline?.attributes);
    expect(occurrence(12345, LOCATIONS.PIT)?.attributes).not.toEqual(
      baseline?.attributes,
    );
    expect(occurrence(12345, LOCATIONS.SF, 43200)?.attributes).not.toEqual(
      baseline?.attributes,
    );
  });
});
