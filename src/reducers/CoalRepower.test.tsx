import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES } from "../Constants";
import { parseSave, serializeSave } from "../SaveGame";
import { CoalRepowerType, GameType } from "../Types";
import { coalRepowerQuote } from "../helpers/CoalRepower";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import { validateGameCommand } from "../multiplayer/Commands";
import { createGame } from "../testing/Simulator";
import reducer, {
  cancelRetrofit,
  reprioritizeFacility,
  resume,
  retrofitFacility,
  sellFacility,
  tickState,
} from "./Game";

const findCoal = (game: GameType) =>
  game.facilities.find((f) => f.fuel === "Coal")!;
const scenario = () =>
  createGame({ scenarioId: 100, seed: 4242, difficulty: "Intern" });

function advance(game: GameType, minute: number) {
  for (let next = game.date.minute; next < minute; next += TICK_MINUTES) {
    tickState(game);
  }
  expect(game.date.minute).toBe(minute);
}

it.each<[CoalRepowerType, string, number, number]>([
  ["coalToGasCC", "Natural Gas CC", 0.75, 90],
  ["coalToGasPeaker", "Natural Gas Peaker", 0.85, 10],
])(
  "commissions %s after staged construction and preserves save continuation",
  (upgrade, name, costShare, spinMinutes) => {
    const game = scenario();
    const coal = findCoal(game);
    const quote = coalRepowerQuote(coal, game, upgrade)!;
    expect(quote.cost).toBe(Math.round(quote.target.buildCost * costShare));
    const completion =
      Math.ceil(quote.durationMinutes / MINUTES_PER_MONTH) * MINUTES_PER_MONTH;
    advance(game, completion - quote.durationMinutes);
    const currentQuote = coalRepowerQuote(findCoal(game), game, upgrade)!;
    const before = currentTick(game)!;
    const source = { ...findCoal(game) };
    const sourceIndex = game.facilities.findIndex((f) => f.id === source.id);
    // A pre-existing coal loan continues to amortize while the gas equipment is being built.
    Object.assign(findCoal(game), {
      loanAmountTotal: 20e6,
      loanAmountLeft: 8e6,
      loanMonthlyPayment: 25e3,
    });
    const payload = { facilityId: source.id, upgrade };
    expect(validateGameCommand(game, "retrofitFacility", payload)).toEqual({
      payload,
    });
    const started = reducer(game, retrofitFacility(payload));
    expect(currentTick(started)!.cash).toBe(before.cash - currentQuote.cost);
    expect(currentTick(started)!.netWorth).toBeCloseTo(before.netWorth, 5);
    expect(currentTick(started)!.expensesOM).toBe(before.expensesOM);
    const duplicate = { ...payload, upgrade: "coalToGasCC" as const };
    expect(reducer(started, retrofitFacility(duplicate))).toBe(started);
    expect(
      validateGameCommand(started, "retrofitFacility", duplicate),
    ).toHaveProperty("error");
    expect(reducer(started, sellFacility(source.id))).toBe(started);

    const played = cloneDeep(started);
    advance(played, MINUTES_PER_MONTH);
    expect(played.facilities[sourceIndex]).toMatchObject({
      id: source.id,
      fuel: "Coal",
      currentW: expect.any(Number),
    });
    expect(played.facilities[sourceIndex].currentW).toBeGreaterThan(0);
    expect(played.monthlyHistory[0].constructionKgco2e).toBeGreaterThan(0);
    const inProgress = parseSave(
      JSON.parse(JSON.stringify(serializeSave(played))),
    );
    expect(inProgress).not.toBeNull();
    const restored = cloneDeep(reducer(undefined, resume(inProgress!.game)));

    advance(played, completion);
    advance(restored, completion);
    const gas = played.facilities[sourceIndex];
    expect(gas).toMatchObject({
      id: source.id,
      name,
      fuel: "Natural Gas",
      peakW: source.peakW,
      buildCost: currentQuote.cost,
      minuteOperational: completion,
      spinMinutes,
      loanAmountTotal: 20e6,
    });
    expect(gas.loanAmountLeft).toBeGreaterThan(0);
    expect(gas.loanAmountLeft).toBeLessThan(8e6);
    expect(gas.upgradeInProgress).toBeUndefined();
    expect(restored.facilities).toEqual(played.facilities);
    expect(restored.monthlyHistory).toEqual(played.monthlyHistory);
    const after = parseSave(JSON.parse(JSON.stringify(serializeSave(played))));
    expect(after?.game.facilities[sourceIndex]).toEqual(gas);

    advance(played, completion + MINUTES_PER_MONTH);
    expect(
      played.monthlyHistory.reduce(
        (total, month) => total + (month.constructionKgco2e ?? 0),
        0,
      ),
    ).toBeCloseTo(currentQuote.constructionKgco2eTotal, 5);
  },
  120_000,
);

it("rejects ineligible and unfunded starts and refunds a canceled project once", () => {
  const game = scenario();
  const coal = findCoal(game);
  const upgrade = "coalToGasPeaker";
  const payload = { facilityId: coal.id, upgrade } as const;
  const action = retrofitFacility(payload);
  const cash = currentTick(game)!.cash;
  const started = reducer(game, action);
  const canceled = reducer(started, cancelRetrofit(coal.id));
  expect(currentTick(canceled)!.cash).toBe(cash);
  expect(findCoal(canceled)).toEqual(coal);
  expect(canceled.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  expect(reducer(canceled, cancelRetrofit(coal.id))).toBe(canceled);

  expect(
    coalRepowerQuote({ ...coal, yearsToBuildLeft: 1 }, game, upgrade),
  ).toBeUndefined();
  expect(
    coalRepowerQuote({ ...coal, permanentShutdownMonth: 12 }, game, upgrade),
  ).toBeUndefined();
  const hugeCoal = { ...coal, peakW: 3e9 };
  expect(coalRepowerQuote(hugeCoal, game, upgrade)?.target.peakW).toBe(2e9);
  const earlier = { ...game, date: { ...game.date, year: 1989 } };
  expect(coalRepowerQuote(coal, earlier, "coalToGasCC")).toBeUndefined();
  expect(coalRepowerQuote(coal, earlier, upgrade)).toBeDefined();
  const beforeRollout = { ...game, date: { ...game.date, year: 1965 } };
  expect(coalRepowerQuote(coal, beforeRollout, upgrade)).toBeUndefined();

  const badSave = JSON.parse(JSON.stringify(serializeSave(started)));
  const invalid = badSave.game.facilities.find(
    (f: { id: number }) => f.id === coal.id,
  );
  invalid.upgradeInProgress.constructionKgco2eTotal = -1;
  expect(parseSave(badSave)).toBeNull();
  invalid.upgradeInProgress.constructionKgco2eTotal = 0;
  invalid.fuel = "Oil";
  expect(parseSave(badSave)).toBeNull();

  const unfunded = cloneDeep(game);
  currentTick(unfunded)!.cash = 0;
  expect(reducer(unfunded, action)).toBe(unfunded);
  expect(validateGameCommand(unfunded, "retrofitFacility", payload)).toEqual({
    error: "Not enough cash for this conversion",
  });
});

it("forecasts the replacement fuel and construction emissions without converting the live plant", () => {
  const game = scenario();
  const coal = findCoal(game);
  const upgrade = "coalToGasPeaker";
  const quote = coalRepowerQuote(coal, game, upgrade)!;
  coal.upgradeInProgress = {
    upgrade,
    cost: quote.cost,
    startsMinute: 0,
    completesMinute: 120,
    constructionKgco2eTotal: 800,
  };
  // Put the coal plant first and give it a steady load below either plant's nameplate.
  game.timeline.forEach((t) => {
    t.demandW = coal.peakW * 0.9;
  });
  const forecast = reducer(
    game,
    reprioritizeFacility({ spotInList: 1, delta: -1 }),
  );
  expect(forecast.facilities[0].fuel).toBe("Coal");
  expect(
    forecast.timeline.find((t) => t.minute === 105)?.supplyByFuel.Coal,
  ).toBeGreaterThan(0);
  const after = forecast.timeline.find((t) => t.minute === 240)!;
  expect(after.supplyByFuel.Coal ?? 0).toBe(0);
  expect(after.supplyByFuel["Natural Gas"]).toBeGreaterThan(0);
  expect(
    forecast.timeline.reduce((sum, t) => sum + (t.constructionKgco2e ?? 0), 0),
  ).toBe(800);
});
