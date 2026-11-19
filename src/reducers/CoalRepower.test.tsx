import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES } from "../Constants";
import { parseSave, serializeSave } from "../SaveGame";
import { CoalRepowerType, GameType } from "../Types";
import { LEGACY_CAMPAIGN_ID } from "../data/LegacyCampaign";
import {
  coalRepowerPurchaseTerms,
  coalRepowerQuote,
  completeCoalRepower,
} from "../helpers/CoalRepower";
import {
  copyCommitmentMetadata,
  serializeCommitmentMetadata,
} from "../helpers/Commitment";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { facilityLoanBalance } from "../helpers/Financials";
import { currentTick } from "../helpers/GameSelectors";
import { validateGameCommand } from "../multiplayer/Commands";
import { createGame } from "../testing/Simulator";
import reducer, {
  cancelRetrofit,
  generateNewTimeline,
  previewCoalRepowerImpact,
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

function mutableCopy(game: GameType): GameType {
  const copy = cloneDeep(game);
  game.timeline.forEach((tick, index) =>
    copyCommitmentMetadata(tick, copy.timeline[index]),
  );
  return copy;
}

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
    // A pre-existing coal loan continues to amortize while the gas equipment is being built.
    Object.assign(coal, {
      loanAmountTotal: 20e6,
      loanAmountLeft: 8e6,
      loanMonthlyPayment: 25e3,
    });
    advance(game, completion - quote.durationMinutes);
    const currentQuote = coalRepowerQuote(findCoal(game), game, upgrade)!;
    const before = currentTick(game)!;
    const source = { ...findCoal(game) };
    const sourceIndex = game.facilities.findIndex((f) => f.id === source.id);
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

    const played = mutableCopy(started);
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
    const restored = mutableCopy(reducer(undefined, resume(inProgress!.game)));
    const forecast = serializeCommitmentMetadata(played.timeline);
    expect(forecast?.some((tick) => tick !== null)).toBe(true);
    expect(serializeCommitmentMetadata(restored.timeline)).toEqual(forecast);

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
    expect(gas.loanAmountLeft).toBeLessThan(source.loanAmountLeft);
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
  invalid.fuel = "Coal";
  invalid.peakWh = 1;
  expect(parseSave(badSave)).toBeNull();
  delete invalid.peakWh;
  const project = invalid.upgradeInProgress;
  project.targetPeakW += 1e6;
  expect(parseSave(badSave)).toBeNull();
  project.targetPeakW = coal.peakW;
  project.startsMinute += TICK_MINUTES;
  project.completesMinute += TICK_MINUTES;
  expect(parseSave(badSave)).toBeNull();
  project.startsMinute -= TICK_MINUTES;
  project.completesMinute -= TICK_MINUTES;
  badSave.game.date = getDateFromMinute(
    project.completesMinute,
    game.startingYear,
  );
  expect(parseSave(badSave)).toBeNull();

  const unfunded = cloneDeep(game);
  currentTick(unfunded)!.cash = 0;
  expect(reducer(unfunded, action)).toBe(unfunded);
  expect(validateGameCommand(unfunded, "retrofitFacility", payload)).toEqual({
    error: "Not enough cash for this conversion",
  });
});

it("retires aging coal bindings in live ticks and forecasts while retaining other targets", () => {
  const game = createGame({
    scenarioId: 102,
    seed: 4242,
    difficulty: "Manager",
  });
  currentTick(game)!.cash = 1e10;
  // Both inherited units qualify, so replacing one must retain the other's binding.
  game.facilities[1].minuteOperational = game.facilities[0].minuteOperational;
  advance(game, 73 * MINUTES_PER_MONTH + 4 * TICK_MINUTES);
  const coal = findCoal(game);
  const other = { ...game.facilities[1] };
  const aging = game.worldEvents.active.find((event) =>
    event.key.endsWith(":aging-derate"),
  )!;
  expect(aging).toBeDefined();
  expect(aging.effects.facilityOutputMultipliersById).toEqual({
    [coal.id]: 0.85,
    [other.id]: 0.85,
  });
  Object.assign(coal, {
    loanAmountTotal: 20e6,
    loanAmountLeft: 8e6,
    loanMonthlyPayment: 25e3,
  });
  const upgrade = "coalToGasPeaker";
  const quote = coalRepowerQuote(coal, game, upgrade)!;
  const completion = game.date.minute + quote.durationMinutes;
  expect(completion).toBeLessThan(96 * MINUTES_PER_MONTH);
  const played = mutableCopy(
    reducer(game, retrofitFacility({ facilityId: coal.id, upgrade })),
  );
  advance(played, completion - 3 * TICK_MINUTES);
  const before = { ...played.facilities[0] };
  const occurrences = cloneDeep(played.worldEvents.occurrences);
  const withoutLimit = mutableCopy(played);
  withoutLimit.worldEvents.active = withoutLimit.worldEvents.active.filter(
    (event) => event.key !== aging.key,
  );
  withoutLimit.storyEffectsDisabled = true;
  // A large load requests full output from both units, exposing either stale equipment cap.
  const forecast = generateNewTimeline(played, 1e10, 1e8, 8);
  const reference = generateNewTimeline(withoutLimit, 1e10, 1e8, 8);
  const after = forecast.filter((tick) => tick.minute >= completion);
  const referenceAfter = reference.filter((tick) => tick.minute >= completion);
  expect(after).not.toHaveLength(0);
  expect(after[0].supplyByFuel["Natural Gas"]).toBeGreaterThan(0);
  expect(after.map((tick) => tick.supplyByFuel["Natural Gas"])).toEqual(
    referenceAfter.map((tick) => tick.supplyByFuel["Natural Gas"]),
  );
  after.forEach((tick, index) => {
    expect(tick.supplyByFuel.Coal).toBeGreaterThan(0);
    expect(tick.supplyByFuel.Coal).toBeLessThanOrEqual(other.peakW * 0.85);
    expect(tick.supplyByFuel.Coal).toBeLessThan(
      referenceAfter[index].supplyByFuel.Coal!,
    );
  });
  expect(played.facilities[0]).toEqual(before);
  expect(played.worldEvents.occurrences).toEqual(occurrences);

  played.timeline.forEach((tick) => {
    tick.demandW = 1e9;
  });
  advance(played, completion + TICK_MINUTES);
  const gas = played.facilities[0];
  expect(gas).toMatchObject({
    id: before.id,
    fuel: "Natural Gas",
    minuteCreated: completion,
    minuteOperational: completion,
    loanAmountTotal: before.loanAmountTotal,
  });
  expect(gas.startingAssetId).toBeUndefined();
  expect(gas.currentW).toBeGreaterThan(gas.peakW * 0.85);
  expect(gas.lifetimeWh).toBeGreaterThanOrEqual(before.lifetimeWh);
  expect(gas.loanAmountLeft).toBeGreaterThan(0);
  expect(gas.loanAmountLeft).toBeLessThan(before.loanAmountLeft);
  expect(played.facilities[1]).toMatchObject({
    id: other.id,
    fuel: "Coal",
    minuteCreated: other.minuteCreated,
    startingAssetId: other.startingAssetId,
  });
  expect(played.worldEvents.occurrences).toEqual(occurrences);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(played)))),
  ).not.toBeNull();
}, 120_000);

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
    targetPeakW: coal.peakW,
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

it("keeps quoted peaker capacity and operating characteristics across a catalog vintage change", () => {
  const game = scenario();
  game.scenarioId = LEGACY_CAMPAIGN_ID + 4;
  game.startingYear = 1981;
  const startsMinute = 11 * MINUTES_PER_MONTH;
  game.date = getDateFromMinute(startsMinute, game.startingYear);
  const coal = { ...findCoal(game), peakW: 300e6 };
  const upgrade = "coalToGasPeaker";
  const quote = coalRepowerQuote(coal, game, upgrade)!;
  expect(quote.target.peakW).toBe(30e6);
  expect(quote.target.btuPerWh).toBe(13.5);
  const completesMinute = startsMinute + quote.durationMinutes;
  game.date = getDateFromMinute(completesMinute, game.startingYear);
  expect(game.date.year).toBe(1982);
  expect(
    completeCoalRepower(coal, game, {
      upgrade,
      cost: quote.cost,
      startsMinute,
      completesMinute,
      constructionKgco2eTotal: quote.constructionKgco2eTotal,
      targetPeakW: quote.target.peakW,
    }),
  ).toBe(true);
  expect(coal.peakW).toBe(30e6);
  expect(coal.btuPerWh).toBe(13.5);
  expect(coal.assumedStartsPerYear).toBeUndefined();
});

it("commissions the replacement in the exclusive month-end agreement forecast", () => {
  const game = scenario();
  const end = MINUTES_PER_MONTH;
  advance(game, end - 3 * TICK_MINUTES);
  const coal = findCoal(game);
  coal.peakW = 3e9;
  const upgrade = "coalToGasPeaker";
  coal.upgradeInProgress = {
    upgrade,
    cost: 1,
    startsMinute: game.date.minute,
    completesMinute: end,
    targetPeakW: 2e9,
    constructionKgco2eTotal: 800,
  };
  // An existing v3 meter activates the extra closing settlement on the final frame.
  game.transmission!.agreementAccounts = [
    {
      agreementId: "test-meter",
      termsVersion: 3,
      accountingStartMinute: 0,
      accountedThroughMinute: game.date.minute,
      months: [],
    },
  ];
  game.timeline.forEach((tick) => {
    tick.demandW = coal.peakW * 0.9;
  });
  const forecast = reducer(
    game,
    reprioritizeFacility({ spotInList: 1, delta: -1 }),
  );
  expect(findCoal(forecast).id).toBe(coal.id);
  expect(forecast.timeline.at(-2)?.supplyByFuel.Coal).toBeGreaterThan(0);
  expect(forecast.timeline.at(-1)?.supplyByFuel.Coal ?? 0).toBe(0);
  expect(forecast.timeline.at(-1)?.supplyByFuel["Natural Gas"]).toBeGreaterThan(
    0,
  );
  expect(
    serializeCommitmentMetadata(forecast.timeline)?.at(-1)?.dispatchTargets[
      coal.id
    ],
  ).toBe(coal.peakW * 0.9);
  expect(
    forecast.timeline.reduce(
      (sum, tick) => sum + (tick.constructionKgco2e ?? 0),
      0,
    ),
  ).toBeCloseTo(800);
});

it("finances the replacement separately and refunds its paid equity on cancellation", () => {
  const game = scenario();
  const coal = findCoal(game);
  const originalRate = 0.04;
  Object.assign(coal, {
    loanAmountTotal: 20e6,
    loanAmountLeft: 8e6,
    loanMonthlyPayment: 32e3,
    interestRate: originalRate,
  });
  advance(game, TICK_MINUTES);
  const before = currentTick(game)!;
  const upgrade = "coalToGasPeaker";
  const quote = coalRepowerQuote(coal, game, upgrade)!;
  const terms = coalRepowerPurchaseTerms(quote, true, game.interestRate);
  const payload = { facilityId: coal.id, upgrade, financed: true } as const;
  const loanOnly = cloneDeep(game);
  currentTick(loanOnly)!.cash = terms.amountDue;
  expect(
    reducer(
      cloneDeep(loanOnly),
      retrofitFacility({ ...payload, financed: false }),
    ),
  ).toEqual(loanOnly);
  expect(validateGameCommand(loanOnly, "retrofitFacility", payload)).toEqual({
    payload,
  });
  expect(
    currentTick(reducer(cloneDeep(loanOnly), retrofitFacility(payload)))!.cash,
  ).toBe(0);
  currentTick(loanOnly)!.cash -= 1;
  expect(reducer(loanOnly, retrofitFacility(payload))).toBe(loanOnly);
  expect(
    validateGameCommand(loanOnly, "retrofitFacility", payload),
  ).toHaveProperty("error");

  const started = reducer(game, retrofitFacility(payload));
  expect(currentTick(started)!.cash).toBe(before.cash - terms.downpayment);
  expect(currentTick(started)!.netWorth).toBeCloseTo(before.netWorth);
  expect(findCoal(started)).toMatchObject({
    interestRate: originalRate,
    loanAmountLeft: coal.loanAmountLeft,
    repowerLoan: {
      loanAmountTotal: terms.loanAmount,
      loanAmountLeft: terms.loanAmount,
      loanMonthlyPayment: terms.monthlyPayment,
      interestRate: game.interestRate,
    },
  });
  const played = mutableCopy(started);
  advance(played, MINUTES_PER_MONTH);
  const outstanding = findCoal(played).repowerLoan!.loanAmountLeft;
  expect(outstanding).toBeLessThan(terms.loanAmount);
  const saved = JSON.parse(JSON.stringify(serializeSave(played)));
  expect(parseSave(saved)).not.toBeNull();
  const facilityInSave = saved.game.facilities.find(
    ({ id }: { id: number }) => id === coal.id,
  );
  facilityInSave.repowerLoan.loanAmountLeft = terms.loanAmount + 1;
  expect(parseSave(saved)).toBeNull();

  const cancelCash = currentTick(played)!.cash;
  const canceled = reducer(cloneDeep(played), cancelRetrofit(coal.id));
  expect(currentTick(canceled)!.cash).toBeCloseTo(
    cancelCash + (quote.cost - outstanding),
  );
  expect(findCoal(canceled).repowerLoan).toBeUndefined();
  expect(findCoal(canceled).loanAmountLeft).toBe(
    findCoal(played).loanAmountLeft,
  );
  expect(findCoal(canceled).interestRate).toBe(originalRate);

  advance(played, game.date.minute + quote.durationMinutes);
  const gas = played.facilities.find(({ id }) => id === coal.id)!;
  expect(gas.fuel).toBe("Natural Gas");
  expect(gas.repowerLoan!.loanAmountLeft).toBeLessThan(outstanding);
  expect(facilityLoanBalance(gas)).toBe(
    gas.loanAmountLeft + gas.repowerLoan!.loanAmountLeft,
  );
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(played)))),
  ).not.toBeNull();
});

it("estimates the margin effect of the replacement's dispatch at equal capacity", () => {
  const game = scenario();
  const coal = findCoal(game);
  const kind = "coalToGasPeaker";
  expect(coalRepowerQuote(coal, game, kind)?.target.peakW).toBe(coal.peakW);
  const impact = previewCoalRepowerImpact(game, coal.id, kind);
  expect(impact?.months).toHaveLength(12);
  expect(impact?.startsMinute).toBe(
    game.date.minute + coalRepowerQuote(coal, game, kind)!.durationMinutes,
  );
  expect(impact?.before.monthlyMarginW).toHaveLength(12);
  expect(impact?.after.monthlyMarginW).toHaveLength(12);
  expect(impact!.beforeW).toBe(Math.min(...impact!.before.monthlyMarginW));
  expect(impact!.afterW).toBe(Math.min(...impact!.after.monthlyMarginW));
  expect(impact!.afterW).toBeGreaterThan(impact!.beforeW);
  expect(findCoal(game)).toBe(coal);
  expect(coal.upgradeInProgress).toBeUndefined();

  coal.paused = true;
  const paused = previewCoalRepowerImpact(game, coal.id, kind);
  expect(paused?.after.monthlyMarginW).toEqual(paused?.before.monthlyMarginW);
});
