import { LOCATIONS } from "../Constants";
import {
  getDataCenterPowerMix,
  regionalizeVariableStartingCapacity,
} from "../data/DataCenterPowerMix";
import { DEFAULT_CUSTOM_SCENARIO, getScenario } from "../data/Scenarios";
import { HYDRO_SITES } from "../data/HydroSites";
import { generatorMaxPeakW } from "../data/FacilityCapacity";
import { browseSpec, validBrowseState } from "../multiplayer/Browse";
import { createWorld } from "../multiplayer/World";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  getSimLocation,
  loadSimData,
  simLocationIds,
} from "../testing/SimData";
import { createGame } from "../testing/Simulator";
import { forecastCustomGameYearOne } from "./CustomGameForecast";
import { getDateFromMinute } from "./DateTime";
import {
  regionalStartingFleet,
  withRegionalStartingFleet,
} from "./RegionalStartingFleet";
import { startingFacilitySearch } from "./StartingFacilities";

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

function largeCustomSetup(id: string, startingYear: number) {
  const location = getSimLocation(id)!;
  return withRegionalStartingFleet({
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: location.id,
    location,
    startingYear,
    startingCustomers: 5_000_000,
  });
}

it("starts a large Vienna fleet from the co-op lobby selection", () => {
  const custom = largeCustomSetup("Vienna", 2010);
  const setup = {
    session: "regional-test",
    revision: 1,
    phase: "browsing",
    card: "CUSTOM_GAME",
    difficulty: "Intern",
    custom,
  } as const;
  expect(validBrowseState(setup)).toBe(true);
  const hydroSites = custom.facilities.flatMap(({ hydroSiteId }) =>
    hydroSiteId ? [hydroSiteId] : [],
  );
  expect(hydroSites[0]).toBe("orl-k-cze");
  loadSimData(custom.location!);
  const world = createWorld(browseSpec(setup)!, coopSeats(2), "test", "epoch");
  expect(world.grids.map(({ facilities }) => facilities.length)).toEqual([
    custom.facilities.length,
    custom.facilities.length,
  ]);
});

it("covers constrained opening capacity using local fuels or modeled backup", () => {
  const { facilities: paraguay } = largeCustomSetup("Asuncion", 2020);
  expect(
    paraguay.reduce((total, { peakW }) => total + (peakW ?? 0), 0),
  ).toBeGreaterThan(4.49e9);
  expect(
    paraguay.every(({ fuel }) => fuel === "Oil" || fuel === "Biomass"),
  ).toBe(true);
  const { facilities: laos } = largeCustomSetup("Vientiane", 2010);
  expect(laos).toMatchObject([
    { name: "Natural Gas Peaker", fuel: "Natural Gas", peakW: 2e9 },
    { name: "Natural Gas Peaker", fuel: "Natural Gas", peakW: 2e9 },
    { name: "Natural Gas Peaker", fuel: "Natural Gas", peakW: 0.5e9 },
  ]);
});

it.each([
  ["SF", "Natural Gas Peaker", 2e9],
  ["HNL", "Biomass", 50e6],
])("initializes the capped %s plants at playable sizes", (id, name, capW) => {
  const scenario = largeCustomSetup(id, 1980);
  const game = createGame({ scenarioId: scenario.id, scenario });
  const generators = game.facilities.filter(
    (facility) => facility.name === name,
  );

  expect(game.facilities).toHaveLength(scenario.facilities.length);
  expect(generators.length).toBeGreaterThan(1);
  for (const plant of generators) expect(plant.peakW).toBeLessThanOrEqual(capW);
});

it("opens a nonempty co-op-ready fleet across the selectable location catalogue", () => {
  for (const id of simLocationIds()) {
    for (const year of [1980, 2000, 2010, 2020, 2050, 2100]) {
      const custom = largeCustomSetup(id, year);
      expect(custom.facilities.length).toBeGreaterThan(0);
      const context = {
        scenarioId: custom.id,
        date: getDateFromMinute(0, year),
      };
      for (const facility of custom.facilities) {
        const siteCapW = facility.hydroSiteId
          ? HYDRO_SITES[facility.hydroSiteId].maxPeakW
          : undefined;
        const maximum = generatorMaxPeakW(context, facility.name!, siteCapW);
        expect(facility.peakW).toBeLessThanOrEqual(maximum);
        expect(startingFacilitySearch(facility).peakW).toBeLessThanOrEqual(
          maximum,
        );
      }
      expect(
        validBrowseState({
          session: "regional-test",
          revision: 1,
          phase: "browsing",
          card: "CUSTOM_GAME",
          difficulty: "Intern",
          custom,
        }),
      ).toBe(true);
    }
  }
});
