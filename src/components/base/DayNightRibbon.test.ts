import {
  dayNightSegments,
  daylightDescription,
  describeDayNight,
} from "./DayNightRibbon";
import * as DateTime from "../../helpers/DateTime";
import { LOCATIONS } from "../../Constants";

afterEach(() => jest.restoreAllMocks());

it("places transitions at their exact minutes and covers the complete plotted day", () => {
  jest.spyOn(DateTime, "getSunriseSunset").mockReturnValue({
    sunrise: 365,
    sunset: 1087,
    daylight: "normal",
  });
  expect(dayNightSegments([0, 1440], 2020, LOCATIONS.SF)).toEqual([
    { start: 0, end: 365, day: false },
    { start: 365, end: 1087, day: true },
    { start: 1087, end: 1440, day: false },
  ]);
});

it("clips a rolling window and uses the next day's sun times without a false midnight boundary", () => {
  jest.spyOn(DateTime, "getSunriseSunset").mockImplementation((date) => ({
    sunrise: date.minute < 1440 ? 360 : 420,
    sunset: date.minute < 1440 ? 1080 : 1020,
    daylight: "normal",
  }));
  expect(dayNightSegments([900, 2160], 2020, LOCATIONS.SF)).toEqual([
    { start: 900, end: 1080, day: true },
    { start: 1080, end: 1860, day: false },
    { start: 1860, end: 2160, day: true },
  ]);
});

it("handles daylight crossing local midnight", () => {
  const sun: DateTime.SunriseSunsetType = {
    sunrise: 1200,
    sunset: 240,
    daylight: "normal",
  };
  jest.spyOn(DateTime, "getSunriseSunset").mockReturnValue(sun);
  expect(dayNightSegments([0, 1440], 2020, LOCATIONS.SF)).toEqual([
    { start: 0, end: 240, day: true },
    { start: 240, end: 1200, day: false },
    { start: 1200, end: 1440, day: true },
  ]);
  expect(daylightDescription(sun)).toBe(
    "Sunrise: 8:00 PM\nSolar noon: 12:00 AM\nSunset: 4:00 AM",
  );
});

it.each(["polar-day", "polar-night"] as const)(
  "shows continuous %s without invented transitions",
  (daylight) => {
    const sun: DateTime.SunriseSunsetType = {
      sunrise: 0,
      sunset: daylight === "polar-day" ? 1440 : 0,
      daylight,
    };
    jest.spyOn(DateTime, "getSunriseSunset").mockReturnValue(sun);
    expect(dayNightSegments([900, 2160], 2020, LOCATIONS.SF)).toEqual([
      { start: 900, end: 2160, day: daylight === "polar-day" },
    ]);
    expect(daylightDescription(sun)).toMatch(/all day/);
    expect(daylightDescription(sun)).not.toMatch(/Sunrise|Sunset|Solar noon/);
  },
);

it("keeps minute precision in inspection and accessible descriptions", () => {
  expect(
    daylightDescription({ sunrise: 365, sunset: 1087, daylight: "normal" }),
  ).toBe("Sunrise: 6:05 AM\nSolar noon: 12:06 PM\nSunset: 6:07 PM");
});

it("omits intervals when there is no plotted duration", () => {
  expect(dayNightSegments([900, 900], 2020, LOCATIONS.SF)).toEqual([]);
});

it("describes the visible intervals rather than solar events outside a rolling window", () => {
  expect(
    describeDayNight([
      { start: 1200, end: 1860, day: false },
      { start: 1860, end: 2160, day: true },
    ]),
  ).toBe("Night from 8:00 PM to 7:00 AM. Daylight from 7:00 AM to 12:00 PM");
  expect(describeDayNight([{ start: 900, end: 2160, day: true }])).toBe(
    "Daylight throughout the displayed period",
  );
});
