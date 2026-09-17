import * as fs from "fs";
import * as path from "path";
import { decodeWeather } from "../data/WeatherBinary";
import { getWindCapacityFactor } from "./Energy";

it("keeps representative city weather proxies within a broad measured fleet benchmark", () => {
  // EIA reported US wind fleet capacity factors of 33.5% in 2023 and 35.9%
  // in 2022: https://www.eia.gov/todayinenergy/detail.php?id=61943
  // These three city records span different wind regimes. Their equal-weight
  // mean is a plausibility check, NOT a regional farm calibration or a prediction:
  // the shipped record is one representative day/month across 1980–2019,
  // while EIA measures an actual capacity-weighted fleet in a different period.
  const factors = ["Austin", "Chicago", "NewYork"].map((id) => {
    const bytes = fs.readFileSync(
      path.resolve(__dirname, "../../public/data/weather", `${id}.bin`),
    );
    const buffer = Uint8Array.from(bytes).buffer;
    return getWindCapacityFactor(
      decodeWeather(buffer).map((row) => row.WIND_KPH),
    );
  });
  factors.forEach((factor) => {
    expect(factor).toBeGreaterThan(0.15);
    expect(factor).toBeLessThan(0.55);
  });
  expect(factors[1]).toBeGreaterThan(factors[0]);
  expect(factors[0]).toBeGreaterThan(factors[2]);
  const mean = factors.reduce((sum, value) => sum + value, 0) / factors.length;
  expect(Math.abs(mean - 0.335)).toBeLessThan(0.08);
});
