import { STORAGE } from "../../data/Facilities";
import cloneDeep from "lodash.clonedeep";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  territoryTileViews,
  TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import {
  FacilityOperatingType,
  isStorage,
  StorageOperatingType,
} from "../../Types";
import {
  facilityMapStatus,
  facilityOperatingStatus,
  needsSubmergedCable,
} from "./FacilityMapStatus";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const view = territoryTileViews(game).find((view) => view.operatingFacility)!;
  const facility = view.operatingFacility!;
  facility.yearsToBuildLeft = 0;
  facility.currentW = 20e6;
  facility.paused = false;
  return { game, view, facility };
}

function storage(): StorageOperatingType {
  const { game } = ready();
  game.date.year = 2025;
  const quote = STORAGE(game, 100e6).find((quote) => quote.name === "Battery")!;
  return {
    ...quote,
    id: 500,
    currentW: 0,
    currentWh: 50e6,
    yearsToBuildLeft: 0,
    minuteCreated: 0,
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    lifetimeWh: 0,
    lifetimePotentialWh: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
  };
}

it("keeps cables buried on wet construction sites until switchgear is fitted", () => {
  const { view, facility } = ready();
  const tile = { ...view.tile, terrain: "lake" as const };
  const unbuilt = { ...facility, yearsToBuild: 1, yearsToBuildLeft: 1 };
  expect(needsSubmergedCable({ tile })).toBe(true);
  expect(needsSubmergedCable({ tile, facility: unbuilt })).toBe(true);
  expect(
    needsSubmergedCable({
      tile,
      facility: { ...unbuilt, yearsToBuildLeft: 0.5 },
    }),
  ).toBe(true);
  expect(
    needsSubmergedCable({
      tile,
      facility: { ...unbuilt, yearsToBuildLeft: 0.25 },
    }),
  ).toBe(false);
  expect(needsSubmergedCable({ tile, facility })).toBe(false);
  expect(
    needsSubmergedCable({
      tile: { ...tile, terrain: "plains" },
      facility: unbuilt,
    }),
  ).toBe(false);
});

it("prioritizes construction over operation pause and retained output", () => {
  const { view, facility } = ready();
  facility.yearsToBuildLeft = 0.25;
  expect(facilityMapStatus(view, 0)).toEqual({
    kind: "construction",
    label: "Under construction",
  });
  facility.paused = true;
  expect(facilityMapStatus(view, 0)).toEqual({
    kind: "construction",
    label: "Under construction; operation paused",
  });
});

it("shows added-capacity construction without classifying the operating base as offline", () => {
  const { view, facility } = ready();
  facility.expansionSequence = 1;
  facility.expansionInProgress = {
    projectSequence: 1,
    targetSize: facility.peakW + 1e6,
    targetPeakW: facility.peakW + 1e6,
    cost: 1e6,
    annualOperatingCostDelta: 0,
    costPerStartDelta: 0,
    startsMinute: 0,
    yearsToBuild: 0.25,
    yearsToBuildLeft: 0.25,
    quoteKey: "status-only-fixture",
  };
  expect(facilityOperatingStatus(facility, 0)).toEqual({
    kind: "producing",
    label: "Generating; capacity upgrade in progress",
  });
  expect(facilityMapStatus(view, 0)).toEqual({
    kind: "construction",
    label: "Generating; capacity upgrade in progress",
  });
  facility.paused = true;
  expect(facilityOperatingStatus(facility, 0).kind).toBe("paused");
  expect(facilityMapStatus(view, 0)).toEqual({
    kind: "construction",
    label: "Operation paused; capacity upgrade in progress",
  });
});

it.each(["producing", "charging", "paused"] as const)(
  "retains %s base state when the expansion construction layer is hidden",
  (kind) => {
    const { view } = ready();
    const facility = kind === "charging" ? storage() : view.operatingFacility!;
    facility.currentW = kind === "charging" ? -20e6 : 20e6;
    facility.paused = kind === "paused";
    facility.expansionInProgress = {
      projectSequence: 1,
      targetSize: (facility.peakWh ?? facility.peakW) + 1e6,
      targetPeakW: facility.peakW + 1e6,
      cost: 1e6,
      annualOperatingCostDelta: 0,
      costPerStartDelta: 0,
      startsMinute: 0,
      yearsToBuild: 1,
      yearsToBuildLeft: 1,
      quoteKey: "status-only-fixture",
    };
    const expanding = { ...view, facility, operatingFacility: facility };
    expect(facilityMapStatus(expanding, 0)?.kind).toBe("construction");
    expect(facilityMapStatus(expanding, 0, false)?.kind).toBe(kind);
    expect(facilityOperatingStatus(facility, 0).kind).toBe(kind);
  },
);

it("keeps construction progressing when only facility operation is paused", () => {
  const { game, facility } = ready();
  facility.yearsToBuildLeft = 0.25;
  facility.paused = true;
  tickState(game);
  const view = territoryTileViews(game).find(
    (view) => view.operatingFacility?.id === facility.id,
  )!;
  expect(view.facility!.yearsToBuildLeft).toBeLessThan(0.25);
  expect(facilityMapStatus(view, game.date.minute)).toEqual({
    kind: "construction",
    label: "Under construction; operation paused",
  });
});

it("shows operation pause while a plant still has measured output", () => {
  const { view, facility } = ready();
  facility.paused = true;
  expect(facilityMapStatus(view, 0)).toEqual({
    kind: "paused",
    label: "Operation paused",
  });
  expect(facility.currentW).toBe(20e6);
});

it.each([
  [20e6, "producing", "Generating"],
  [0, "idle", "Idle"],
])("uses a generator's measured %i W", (watts, kind, label) => {
  const { view, facility } = ready();
  facility.currentW = watts;
  expect(facilityMapStatus(view, 0)).toEqual({ kind, label });
});

it.each([
  [-20e6, "charging", "Charging"],
  [0, "idle", "Idle"],
  [20e6, "producing", "Discharging"],
])("uses storage's signed measured %i W", (watts, kind, label) => {
  const facility = storage();
  facility.currentW = watts;
  const view: TerritoryTileView = {
    ...ready().view,
    facility,
    operatingFacility: facility,
  };
  expect(facilityMapStatus(view, 0)).toEqual({ kind, label });
});

it("recognizes only an active offline retrofit as construction", () => {
  const { view, facility } = ready();
  if (isStorage(facility)) throw new Error("Expected a starting generator");
  facility.upgradeInProgress = {
    upgrade: "combinedCycle",
    cost: 1e6,
    startsMinute: 0,
    completesMinute: 100,
  };
  expect(facilityMapStatus(view, 99)).toEqual({
    kind: "construction",
    label: "Retrofitting",
  });
  facility.paused = true;
  expect(facilityMapStatus(view, 99)?.label).toBe(
    "Retrofitting; operation paused",
  );
  facility.paused = false;
  expect(facilityMapStatus(view, 100)).toEqual({
    kind: "producing",
    label: "Generating",
  });
});

it.each([
  [20e6, false, "producing", "Generating; retrofit in progress"],
  [0, false, "idle", "Idle; retrofit in progress"],
  [20e6, true, "paused", "Operation paused; retrofit in progress"],
])(
  "preserves actual staged-retrofit state at %i W, paused %s",
  (watts, paused, kind, label) => {
    const { view, facility } = ready();
    if (isStorage(facility)) throw new Error("Expected a starting generator");
    facility.currentW = watts;
    facility.paused = paused;
    facility.upgradeInProgress = {
      upgrade: "coldWeatherPackage",
      cost: 1e6,
      startsMinute: 0,
      completesMinute: 100,
    };
    expect(facilityMapStatus(view, 50)).toEqual({ kind, label });
  },
);

it("does not mistake global clock pause for facility pause", () => {
  const { game, facility } = ready();
  game.speed = "PAUSED";
  const view = territoryTileViews(game).find(
    (view) => view.operatingFacility?.id === facility.id,
  )!;
  expect(facilityMapStatus(view, game.date.minute)).toEqual({
    kind: "producing",
    label: "Generating",
  });
});

it("keeps a scheduled permanent shutdown truthful in both status consumers", () => {
  const { view, facility } = ready();
  facility.permanentShutdownMonth = 2;
  facility.currentW = 0;
  expect(facilityMapStatus(view, 0)?.label).toBe("Idle");
  expect(facilityMapStatus(view, MINUTES_PER_MONTH)).toEqual({
    kind: "idle",
    label: "Permanently shut down",
  });
});

it.each([0, 1])(
  "reports only known peer construction progress %i",
  (yearsToBuildLeft) => {
    const { view } = ready();
    const foreign: TerritoryTileView = {
      ...view,
      owned: false,
      ownerKey: "peer:other",
      ownerName: "Other utility",
      operatingFacility: undefined,
      facility: { ...view.facility!, yearsToBuildLeft },
    };
    expect(facilityMapStatus(foreign, 0)).toEqual(
      yearsToBuildLeft > 0
        ? { kind: "construction", label: "Under construction" }
        : { kind: "unknown", label: "Operating status unavailable" },
    );
  },
);

it("does not put a facility marker on a city or transmission tower", () => {
  const { game } = ready();
  const city = territoryTileViews(game).find(({ tile }) => tile.city)!;
  const tower = territoryTileViews(game).find(
    ({ facility, tile }) => !facility && !tile.city,
  )!;
  expect(facilityMapStatus(city, 0)).toBeUndefined();
  expect(facilityMapStatus(tower, 0)).toBeUndefined();
});

it("does not mutate a facility while deriving its display status", () => {
  const { facility } = ready();
  const before: FacilityOperatingType = cloneDeep(facility);
  facilityOperatingStatus(facility, 0);
  expect(facility).toEqual(before);
});
