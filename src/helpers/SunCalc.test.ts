import { getSunAltitude, getSunriseSunsetTimes } from "./SunCalc";

describe("SunCalc", () => {
  const date = new Date(Date.UTC(2031, 5, 1, 12));

  // suncalc 2.0.1's own answers on x86-64
  it.each([
    [49.28, -123.12, 1938082300695, 1938139780317, -1.8612545897812003],
    [-33.87, 151.21, 1938027078605, 1938063265610, -62.0332516065144],
  ])(
    "times sunrise and sunset at %p, %p as suncalc does",
    (lat, lng, sunrise, sunset, altitude) => {
      const times = getSunriseSunsetTimes(date, lat, lng);
      expect(times.sunrise?.getTime()).toBe(sunrise);
      expect(times.sunset?.getTime()).toBe(sunset);
      expect(getSunAltitude(date, lat, lng)).toBe(altitude);
    },
  );

  it("reports no sunrise or sunset under the midnight sun", () => {
    expect(getSunriseSunsetTimes(date, 69.65, 18.96)).toEqual({
      sunrise: null,
      sunset: null,
    });
    expect(getSunAltitude(date, 69.65, 18.96)).toBe(41.014804020652356);
  });
});
