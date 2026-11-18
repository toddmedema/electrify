import { mapWeather } from "./MapWeather";

const dry = { TEMP_C: 12, WIND_KPH: 10, PRECIP_MM: 0, CLOUD_PCT: 12 };
const basin = {
  temperatureC: 12,
  windKph: 10,
  precipitationMm: 0,
  hydroRunoffMm: 0,
  snowpackMm: 0,
};

it("turns the live hourly input into distinct rain, snow, cloud and wind signals", () => {
  const clear = mapWeather(dry);
  const shower = { ...dry, PRECIP_MM: 1.2, CLOUD_PCT: 90, WIND_KPH: 42 };
  const rain = mapWeather(shower);
  const sleet = mapWeather({ ...shower, TEMP_C: 1 });
  const snow = mapWeather({ ...shower, TEMP_C: -5 });

  expect(clear.rain).toBe(0);
  expect(rain.rain).toBeGreaterThan(0);
  expect(rain.snowfall).toBe(0);
  expect(sleet.rain).toBeGreaterThan(0);
  expect(sleet.snowfall).toBeGreaterThan(0);
  expect(snow.snowfall).toBeGreaterThan(sleet.snowfall);
  expect(snow.rain).toBe(0);
  expect(rain.cloud).toBeGreaterThan(clear.cloud);
  expect(rain.wind).toBeGreaterThan(clear.wind);
});

it("keeps accumulated winter snow separate from the water raised by rain and snowmelt", () => {
  const normal = mapWeather(dry, basin);
  const packedSnow = mapWeather(
    { ...dry, TEMP_C: -5, PRECIP_MM: 1 },
    { ...basin, temperatureC: -5, precipitationMm: 70, snowpackMm: 120 },
  );
  const melt = mapWeather(dry, {
    ...basin,
    hydroRunoffMm: 48,
    snowpackMm: 48,
  });
  const rain = mapWeather({ ...dry, PRECIP_MM: 1 }, basin);

  expect(packedSnow.snowpack).toBeGreaterThan(melt.snowpack);
  expect(melt.snowpack).toBeGreaterThan(normal.snowpack);
  expect(packedSnow.waterLevel).toBe(normal.waterLevel);
  expect(melt.waterLevel).toBeGreaterThan(normal.waterLevel);
  expect(rain.waterLevel).toBeGreaterThan(normal.waterLevel);
});

it("uses the tick temperature and keeps extreme weather within the presentation range", () => {
  const weather = mapWeather(
    { ...dry, PRECIP_MM: 90, CLOUD_PCT: 100 },
    {
      ...basin,
      temperatureC: -40,
      windKph: 220,
      hydroRunoffMm: 500,
      snowpackMm: 1000,
    },
  );

  expect(weather.rain).toBe(0);
  expect(weather.snowfall).toBe(1);
  expect(
    Object.values(weather).every((value) => value >= 0 && value <= 1),
  ).toBe(true);
});
