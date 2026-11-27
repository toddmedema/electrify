import { LOCATIONS } from "../Constants";
import {
  getDataCenterPowerMix,
  regionalizeVariableStartingCapacity,
} from "../data/DataCenterPowerMix";
import { DEFAULT_CUSTOM_SCENARIO, getScenario } from "../data/Scenarios";
import { HYDRO_SITES } from "../data/HydroSites";
import { getSimLocation, loadSimData } from "../testing/SimData";
import { forecastCustomGameYearOne } from "./CustomGameForecast";
import {
  regionalStartingFleet,
  withRegionalStartingFleet,
} from "./RegionalStartingFleet";

it("generates a regional fleet for custom setups without admitting later technologies", () => {
  const recent = withRegionalStartingFleet(DEFAULT_CUSTOM_SCENARIO);
  const early = withRegionalStartingFleet({ ...recent, startingYear: 1980 });
  expect(recent.startingFleetSource).toBe("regional");
  expect(recent.facilities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "Solar" }),
      expect.objectContaining({ name: "Natural Gas CC" }),
    ]),
  );
  expect(
    early.facilities.some(
      ({ name }) => name === "Solar" || name === "Natural Gas CC",
    ),
  ).toBe(false);
  expect(
    early.facilities.some(({ name }) => name === "Natural Gas Peaker"),
  ).toBe(true);

  const oahu = regionalStartingFleet(LOCATIONS.HNL, 2020, 500e6);
  expect(oahu.some(({ fuel }) => fuel === "Oil")).toBe(true);
  expect(oahu.some(({ fuel }) => fuel === "Geothermal")).toBe(false);
});

it("applies the observed wind and solar shares only inside the renewable budget", () => {
  const scenario = getScenario(110)!;
  const reactor = scenario.facilities[0];
  const oldFleet = [
    reactor,
    { fuel: "Sun", peakW: 200e6 },
    { fuel: "Wind", peakW: 250e6 },
  ] as const;
  const { shares } = getDataCenterPowerMix(
    scenario.location!,
    scenario.startingYear,
  );
  const [retained, solar, wind] = regionalizeVariableStartingCapacity(
    scenario.location!,
    scenario.startingYear,
    [...oldFleet],
  );
  expect(retained).toBe(reactor);
  expect(solar.peakW! + wind.peakW!).toBe(450e6);
  expect(solar.peakW! / wind.peakW!).toBeCloseTo(shares.Sun! / shares.Wind!, 5);
  expect(scenario.facilities.find(({ fuel }) => fuel === "Sun")?.peakW).toBe(
    solar.peakW,
  );
  expect(
    regionalizeVariableStartingCapacity(scenario.location!, 1980, [
      ...oldFleet,
    ]),
  ).toEqual(oldFleet);
});

it("keeps the default custom opening supplied in the production outlook", () => {
  loadSimData(LOCATIONS.SF);
  const outlook = forecastCustomGameYearOne(
    withRegionalStartingFleet(DEFAULT_CUSTOM_SCENARIO),
    "Intern",
    1234,
  );
  expect(outlook.worstShortfallW).toBe(0);
});

it("uses the available resources of hydro-heavy and hydro-constrained locations", () => {
  const switzerland = getSimLocation("Zurich")!;
  const { shares } = getDataCenterPowerMix(switzerland, 2020);
  expect(shares.Hydro).toBeGreaterThan(0.5);
  const zurichFleet = regionalStartingFleet(switzerland, 2020, 900e6);
  expect(zurichFleet.length).toBeGreaterThan(0);
  expect(zurichFleet.every(({ fuel }) => fuel && shares[fuel])).toBe(true);

  const madrid = getScenario(108)!.location!;
  const madridHydro = regionalStartingFleet(madrid, 2023, 4e9).filter(
    ({ fuel }) => fuel === "Hydro",
  );
  expect(madridHydro.length).toBeGreaterThan(0);
  for (const { hydroSiteId, peakW } of madridHydro) {
    expect(peakW).toBeLessThanOrEqual(HYDRO_SITES[hydroSiteId!].maxPeakW);
  }
  const paris = getScenario(110)!.location!;
  expect(getDataCenterPowerMix(paris, 2023).shares.Hydro).toBeGreaterThan(0);
  expect(
    regionalStartingFleet(paris, 2023, 900e6).some(
      ({ fuel }) => fuel === "Hydro",
    ),
  ).toBe(false);
});
