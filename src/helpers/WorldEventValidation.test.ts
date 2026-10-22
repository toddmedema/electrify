import { validWorldEvent } from "./WorldEventValidation";

function solarEvent(multiplier: unknown, byHour?: unknown) {
  return {
    key: "smoke:test",
    definitionId: "smoke",
    startsMinute: 0,
    endsMinute: 1440,
    attributes: {},
    effects: {
      solarIrradianceMultiplier: multiplier,
      ...(byHour === undefined
        ? {}
        : { solarIrradianceMultipliersByHour: byHour }),
    },
  };
}

describe("solar resource effect validation", () => {
  it.each([0, 0.75, 1])("accepts a retained sunlight share of %s", (value) => {
    expect(validWorldEvent(solarEvent(value))).toBe(true);
  });

  it.each([-0.01, 1.01, NaN, Infinity, "0.75", null])(
    "rejects an invalid retained sunlight share of %s",
    (value) => {
      expect(validWorldEvent(solarEvent(value))).toBe(false);
    },
  );

  it("accepts a bounded attenuation map at both hour boundaries", () => {
    expect(validWorldEvent(solarEvent(1, { "0": 0, "12": 0.8, "23": 1 }))).toBe(
      true,
    );
    expect(validWorldEvent(solarEvent(1, {}))).toBe(true);
  });

  it.each([
    { "-1": 0.8 },
    { "24": 0.8 },
    { "1.5": 0.8 },
    { "01": 0.8 },
    { noon: 0.8 },
    { "12": -0.01 },
    { "12": 1.01 },
    { "12": NaN },
    { "12": Infinity },
    { "12": "0.8" },
    [0.8],
    null,
  ])("rejects an invalid hourly sunlight map %p", (value) => {
    expect(validWorldEvent(solarEvent(1, value))).toBe(false);
  });
});
