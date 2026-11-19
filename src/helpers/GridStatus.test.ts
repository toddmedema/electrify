import { createGame } from "../testing/Simulator";
import { STORAGE } from "../data/Facilities";
import type { StorageOperatingType } from "../Types";
import { HAIL_DEFINITION_ID } from "./Hazards";
import { getGridHealth, readyStorage } from "./GridStatus";

it("reports current reachable reserve even when the operating sample contains a future shortage", () => {
  const game = createGame({ scenarioId: 101 });
  const now = game.timeline[0];
  now.supplyW = now.demandW;
  now.demandW = 72e6;
  now.supplyW = now.demandW;
  now.reserveW = 12e6;
  game.timeline[1].demandW = game.timeline[1].supplyW + 80e6;
  expect(getGridHealth(game, now)).toMatchObject({
    state: "stable",
    watts: 12e6,
  });
  expect(
    getGridHealth(game, { ...now, supplyW: now.demandW - 4e6 }),
  ).toMatchObject({ state: "blackout", watts: 4e6 });
});

it("counts measured storage energy and discharge while excluding unavailable facilities", () => {
  const game = createGame({ scenarioId: 101 });
  const storage: StorageOperatingType = {
    ...STORAGE(game, 100e6)[0],
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    id: 1,
    currentWh: 40e6,
    currentW: 3e6,
    yearsToBuildLeft: 0,
    minuteCreated: -1,
    lifetimeWh: 0,
    lifetimePotentialWh: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
  };
  game.facilities = [
    storage,
    { ...storage, id: 2, currentWh: 0, currentW: 0 },
    { ...storage, id: 3, paused: true },
    { ...storage, id: 4, yearsToBuildLeft: 1 },
    { ...storage, id: 5, permanentShutdownMonth: 1 },
    { ...storage, id: 6 },
    { ...storage, id: 7 },
  ];
  game.worldEvents.active = [
    {
      key: "hail",
      definitionId: HAIL_DEFINITION_ID,
      startsMinute: 0,
      endsMinute: 100,
      attributes: {},
      effects: { facilityOutputMultipliersById: { "7": 0 } },
    },
    {
      key: "outage",
      definitionId: "outage",
      startsMinute: 0,
      endsMinute: 100,
      attributes: {},
      effects: { facilityOutputMultipliersById: { "6": 0 } },
    },
  ];
  expect(readyStorage(game)).toEqual({ storedWh: 40e6, dischargingW: 3e6 });
  game.facilities = [{ ...storage, paused: true }];
  expect(readyStorage(game)).toEqual({ storedWh: 0, dischargingW: 0 });
});
