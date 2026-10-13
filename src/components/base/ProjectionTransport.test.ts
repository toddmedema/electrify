import { GAME_TO_REAL_YEARS } from "../../Constants";
import {
  selectProjection,
  ProjectionView,
  monthMinute,
} from "../../helpers/Projection";
import {
  GameType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../../Types";
import { createGame } from "../../testing/Simulator";
import reducer from "../../reducers/Game";
import { schedulePolicy } from "../../reducers/GameActions";
import { packProjection, projectionDecoder } from "./ProjectionTransport";

function fixture() {
  const forecast = [
    {
      minute: 0,
      supplyW: 20,
      demandW: 10,
      cash: 100,
      storedWh: 0,
      hydroReservoirCapacityWh: 0,
      demandByType: { Residential: 10, Commercial: undefined },
      supplyByFuel: { Coal: 20 },
      renewableCapacityFactors: { a: 0.2, b: NaN },
      availableSupplyW: undefined,
      deferredResidential: [
        { energyWh: 12, recoveryStartMinute: 60, recoveryEndMinute: 240 },
      ],
      deferredResidentialStart: [],
    },
    {
      minute: 60,
      supplyW: Infinity,
      demandW: -0,
      cash: -10,
      demandByType: {},
      supplyByFuel: { Coal: 20, Gas: 4 },
      renewableCapacityFactors: undefined,
      deferredResidential: undefined,
    },
    {
      minute: 120,
      supplyW: 4,
      demandW: 10,
      cash: 5,
      demandByType: { Residential: 10 },
      supplyByFuel: {},
      deferredResidentialStart: [
        { energyWh: 9, recoveryStartMinute: 120, recoveryEndMinute: 360 },
      ],
    },
  ] as unknown as TickPresentFutureType[];
  forecast[1].deferredResidentialStart = forecast[0].deferredResidential;
  forecast[2].deferredResidential = [forecast[0].deferredResidential![0]];
  const monthlyHistory = [
    {
      year: 2000,
      month: 1,
      supplyWh: 72e9,
      demandWh: 144e9,
      chartAverage: {
        ...forecast[0],
        storedWh: 800,
        hydroReservoirCapacityWh: 1000,
      },
    },
  ] as MonthlyHistoryType[];
  const game = {
    monthlyHistory,
    startingYear: 2000,
    timeline: forecast,
  } as GameType;
  const now = forecast[0];
  const historicalChart = { ...monthlyHistory[0].chartAverage!, minute: 0 };
  const historySupply = {
    ...now,
    minute: monthMinute(monthlyHistory[0], game.startingYear),
    supplyW: monthlyHistory[0].supplyWh / (24 * GAME_TO_REAL_YEARS),
    demandW: monthlyHistory[0].demandWh / (24 * GAME_TO_REAL_YEARS),
  };
  const financeProjected = [
    { cash: 100 },
    { cash: 200 },
  ] as MonthlyHistoryType[];
  const projection: ProjectionView = {
    forecast,
    timeline: [historicalChart, ...forecast],
    sampled: [historicalChart, forecast[0], forecast[2]],
    supplyDemandTimeline: [historySupply, ...forecast],
    domain: { x: [0, 120], y: [0, historySupply.demandW] },
    blackouts: [{ minute: 120, value: 10 }],
    hasStorage: true,
    hasHydro: true,
    financePast: monthlyHistory,
    financeProjected,
    cashProjected: financeProjected.slice(0, 1),
    cashBaseline: game.timeline,
    startingCash: 100,
    startingCustomers: 5,
    projectionStepMinutes: 60,
  };
  return { game, now, projection };
}

it("preserves exact numeric, dictionary and queue values and original historical references", () => {
  const { game, now, projection } = fixture();
  const { transport, transfers } = packProjection(projection);
  const decoded = projectionDecoder(transport, game, now)(Infinity)!;
  expect(decoded).toStrictEqual(projection);
  expect(Object.is(decoded.forecast[1].demandW, -0)).toBe(true);
  expect(decoded.financePast).toBe(game.monthlyHistory);
  expect(decoded.cashBaseline).toBe(game.timeline);
  expect(decoded.timeline[1]).toBe(decoded.forecast[0]);
  expect(decoded.sampled[2]).toBe(decoded.forecast[2]);
  expect(decoded.sampled[0]).toBe(decoded.timeline[0]);
  expect(decoded.supplyDemandTimeline[1]).toBe(decoded.forecast[0]);
  expect(decoded.cashProjected[0]).toBe(decoded.financeProjected[0]);
  expect(decoded.forecast[1].deferredResidentialStart).toBe(
    decoded.forecast[0].deferredResidential,
  );
  expect(decoded.forecast[2].deferredResidential![0]).toBe(
    decoded.forecast[0].deferredResidential![0],
  );
  expect(new Set(transfers).size).toBe(transfers.length);
  expect(transfers.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
});

it("yields after its time budget and eventually reconstructs every tick and historical row", () => {
  const { game, now, projection } = fixture();
  const decode = projectionDecoder(
    packProjection(projection).transport,
    game,
    now,
  );
  const clock = jest.spyOn(performance, "now").mockReturnValue(10);
  try {
    // Each call exhausts its budget after one row and leaves no partial view to publish.
    expect(decode(10)).toBeUndefined();
    expect(decode(10)).toBeUndefined();
    expect(decode(10)).toBeUndefined();
    expect(decode(10)).toBeUndefined();
    expect(decode(10)).toStrictEqual(projection);
  } finally {
    clock.mockRestore();
  }
});

it("round-trips the full twenty-year hydro/intertie forecast with time-of-use recovery queues", () => {
  const game = reducer(
    createGame({ scenarioId: 108, seed: 17 }),
    schedulePolicy({ id: "timeOfUse", tier: "On", month: 1 }),
  );
  const now = game.timeline[0];
  const projection = selectProjection(game, now);
  expect(projection.forecast).toHaveLength(5760);
  expect(
    projection.forecast.some((tick) => tick.deferredResidential?.length),
  ).toBe(true);
  const decoded = projectionDecoder(
    packProjection(projection).transport,
    game,
    now,
  )(Infinity);
  expect(decoded).toStrictEqual(projection);
});
