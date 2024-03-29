import Redux from 'redux';
import numbro from 'numbro';
import {getDateFromMinute, getTimeFromTimeline, summarizeHistory, summarizeTimeline} from '../helpers/DateTime';
import {customersFromMarketingSpend, facilityCashBack, getMonthlyPayment, getPaymentInterest} from '../helpers/Financials';
import {formatMoneyConcise, formatWatts} from '../helpers/Format';
import {getFuelPricesPerMBTU} from '../schema/FuelPrices';
import {getRawSunlightPercent, getWeather} from '../schema/Weather';
import {openDialog, openSnackbar} from '../actions/UI';
import {DIFFICULTIES, DOWNPAYMENT_PERCENT, FUELS, GAME_TO_REAL_YEARS, GENERATOR_SELL_MULTIPLIER, INTEREST_RATE_YEARLY, LOAN_MONTHS, ORGANIC_GROWTH_MAX_ANNUAL, RESERVE_MARGIN, TICK_MINUTES, TICK_MS, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MONTH, TICKS_PER_YEAR, YEARS_PER_TICK} from '../Constants';
import {GENERATORS, STORAGE} from '../Facilities';
import {logEvent} from '../Globals';
import {getStorageJson, setStorageKeyValue} from '../LocalStorage';
import {SCENARIOS} from '../Scenarios';
import {store} from '../Store';
import {BuildFacilityAction, DateType, FacilityOperatingType, FacilityShoppingType, GameStateType, GeneratorOperatingType, LocalStoragePlayedType, MonthlyHistoryType, NewGameAction, QuitGameAction, ReprioritizeFacilityAction, ScenarioType, ScoreType, SellFacilityAction, SetSpeedAction, SpeedType, StartGameAction, StorageOperatingType, TickPresentFutureType, UserType} from '../Types';
const cloneDeep = require('lodash.clonedeep');

let previousSpeed = 'PAUSED' as SpeedType;
const initialGameState: GameStateType = {
  scenarioId: 100,
  location: {
    id: 'SF',
    name: 'SF',
  },
  difficulty: 'Employee',
  speed: 'PAUSED',
  inGame: false,
  feePerKgCO2e: 0, // Start on easy mode
  monthlyMarketingSpend: 0,
  tutorialStep: -1, // Not set to 0 until after card transition, so that the target element exists
  facilities: [] as FacilityOperatingType[],
  startingYear: 2020,
  date: getDateFromMinute(0, 2020),
  timeline: [] as TickPresentFutureType[],
  monthlyHistory: [] as MonthlyHistoryType[],
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

export function quitGame(): QuitGameAction {
  return { type: 'GAME_EXIT' };
}

// Simplified customer forecast, assumes no blackouts since supply calculation depends on demand (circular depedency)
function getDemandW(date: DateType, gameState: GameStateType, prev: TickPresentFutureType, now: TickPresentFutureType) {
  const marketingGrowth = customersFromMarketingSpend(gameState.monthlyMarketingSpend) / TICKS_PER_MONTH;
  now.customers = Math.round(prev.customers * (1 + ORGANIC_GROWTH_MAX_ANNUAL / TICKS_PER_YEAR) + marketingGrowth);

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized = 0.0035 * Math.pow(now.temperatureC, 2) - 0.035 * now.temperatureC;
  const minutesFromDarkNormalized = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay) / 420;
  const minutesFromDarkLogistics = 1 / (1 + Math.pow(Math.E, -minutesFromDarkNormalized * 6));
  const minutesFrom9amNormalized = Math.abs(date.minuteOfDay - 540) / 120;
  const minutesFrom9amLogistics = 1 / (1 + Math.pow(Math.E, -minutesFrom9amNormalized * 2));
  const minutesFrom5pmNormalized = Math.abs(date.minuteOfDay - 1020) / 240;
  const minutesFrom5pmLogistics = 1 / (1 + Math.pow(Math.E, -minutesFrom5pmNormalized * 2));
  const demandMultiple = 430 + 70 * temperatureNormalized - 40 * minutesFrom9amLogistics + 30 * minutesFromDarkLogistics - 65 * minutesFrom5pmLogistics;
  return demandMultiple * now.customers;
}

function reforecastWeatherAndPrices(state: GameStateType): TickPresentFutureType[] {
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = getWeather(date);
      const fuelPrices = getFuelPricesPerMBTU(date);
      return {
        ...t,
        ...fuelPrices,
        sunlight: getRawSunlightPercent(date) * (weather.CLOUD_PCT / 100),
        windKph: weather.WIND_KPH,
        temperatureC: weather.TEMP_C,
      };
    }
    return t;
  });
}

function reforecastDemand(state: GameStateType): TickPresentFutureType[] {
  let prev = state.timeline[0];
  return state.timeline.map((t: TickPresentFutureType, i: number) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      t.demandW = getDemandW(date, state, prev, t);
      prev = t;
      return t;
    }
    return t;
  });
}

// Updates game state and now in place
function updateSupplyFacilitiesFinances(state: GameStateType, prev: TickPresentFutureType, now: TickPresentFutureType, simulated?: boolean) {
  const {facilities, date} = state;
  const difficulty = DIFFICULTIES[state.difficulty];

  // Update facility construction status
  facilities.forEach((g: FacilityOperatingType) => {
    if (g.yearsToBuildLeft > 0) {
      g.yearsToBuildLeft = Math.max(0, g.yearsToBuildLeft - YEARS_PER_TICK);
      if (g.yearsToBuildLeft === 0 && !simulated) {
        setTimeout(() => {
          store.dispatch(openSnackbar(`Construction complete: ${g.name} ${g.peakWh ? formatWatts(g.peakWh) + 'h' : formatWatts(g.peakW)}`));
        }, 0);
      }
    }
  });

  const turbineWindMS = now.windKph * Math.pow(100 / 10, 0.34) / 5; // 5kph = 1m/s
    // Wind gradient, assuming 10m weather station, 100m wind turbine, neutral air above human habitation - https://en.wikipedia.org/wiki/Wind_gradient
  const windOutputFactor = (turbineWindMS < 3 || turbineWindMS > 25) ? 0 : Math.max(0, Math.min(1, (turbineWindMS - 3) / 11));
    // Production output is sloped from 3-14m/s, capped on zero and peak at both ends, and cut off >25m/s - http://www.wind-power-program.com/turbine_characteristics.htm
  const solarOutputFactor = now.sunlight * Math.max(1, 1 - (now.temperatureC - 10) / 100);
    // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
    // TODO what about rain and snow, esp panels covered in snow?

  // Pre-check how much extra supply we'll need to charge batteries
  let indexOfLastUnchargedBattery = -1;
  let totalChargeNeeded = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.peakWh && g.currentWh < g.peakWh && g.yearsToBuildLeft === 0) {
      indexOfLastUnchargedBattery = i;
      totalChargeNeeded += Math.min(g.peakW, (g.peakWh - g.currentWh) * TICKS_PER_HOUR);
    }
  });

  // Update supply and facility outputs
  let supply = 0;
  let charge = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.yearsToBuildLeft === 0) {
      if (g.fuel) { // Capable of generating electricity
        const targetW = Math.max(0, now.demandW * (1 + RESERVE_MARGIN) - supply);
        switch (g.fuel) {
          case 'Sun':
            g.currentW = g.peakW * solarOutputFactor;
            break;
          case 'Wind':
            g.currentW = g.peakW * windOutputFactor;
            break;
          default: // on-demand produces up to demand + reserve margin
            if (targetW > g.currentW || i < indexOfLastUnchargedBattery) { // spinning up
              // If there's a battery to charge after me, output as much as possible to charge it beyond demand
              if (indexOfLastUnchargedBattery >= 0 && i < indexOfLastUnchargedBattery) {
                g.currentW = Math.min(now.demandW + totalChargeNeeded - charge, g.peakW, g.currentW + g.peakW * TICK_MINUTES / g.spinMinutes);
              } else { // Otherwise just try to fulfill demand + reserve margin
                g.currentW = Math.min(g.peakW, targetW, g.currentW + g.peakW * TICK_MINUTES / g.spinMinutes);
              }
            } else {
              g.currentW = Math.max(0, targetW, g.currentW - g.peakW * TICK_MINUTES / g.spinMinutes);
            }
            break;
        }
        supply += g.currentW;
      }
      if (g.peakWh) { // Capable of storing electricity
        const targetW = Math.max(0, now.demandW - supply);
        if (g.currentWh > 0 && targetW > 0) { // If there's a need and we have charge, discharge
          g.currentW = Math.min(g.peakW, targetW, g.currentWh * TICKS_PER_HOUR);
          g.currentWh = Math.max(0, g.currentWh - g.currentW / TICKS_PER_HOUR);
          supply += g.currentW;
        } else if (g.currentWh < g.peakWh && supply - charge > now.demandW) { // If there's spare capacity, charge
          g.currentW = -Math.min(g.peakW, supply - now.demandW - charge, (g.peakWh - g.currentWh) * TICKS_PER_HOUR);
          g.currentWh = Math.min(g.peakWh, g.currentWh - g.currentW / TICKS_PER_HOUR);
          charge -= g.currentW / g.roundTripEfficiency;
        } else { // Otherwise, don't charge or discharge: reset to 0
          g.currentW = 0;
        }
      }
    }
  });
  now.supplyW = supply;

  // Update finances
  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh = Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const demandWh = now.demandW / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const revenue = supplyWh * dollarsPerWh;

  // Facilities expenses
  let kgco2e = 0;
  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  facilities.forEach((g: FacilityShoppingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerWh || 0) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        expensesFuel += fuelBtu * getFuelPricesPerMBTU(date)[g.fuel] / 1000000;
        kgco2e += fuelBtu * FUELS[g.fuel].kgCO2ePerBtu;
      }
      if (g.loanAmountLeft > 0) {
        const paymentInterest = getPaymentInterest(g.loanAmountLeft, INTEREST_RATE_YEARLY, g.loanMonthlyPayment);
        const paymentPrincipal = g.loanMonthlyPayment - paymentInterest;
        expensesInterest += paymentInterest / TICKS_PER_MONTH;
        principalRepayment += paymentPrincipal / TICKS_PER_MONTH;
        g.loanAmountLeft -= paymentPrincipal / TICKS_PER_MONTH;
      }
    } else {
      expensesInterest += getPaymentInterest(g.loanAmountLeft, INTEREST_RATE_YEARLY, g.loanMonthlyPayment) / TICKS_PER_MONTH;
    }
  });
  const expensesCarbonFee = state.feePerKgCO2e * kgco2e;
  const expensesMarketing = state.monthlyMarketingSpend / TICKS_PER_MONTH;

  // Customers
  const percentDemandUnfulfilled = (demandWh - supplyWh) / demandWh;
  const organicGrowthRate = ORGANIC_GROWTH_MAX_ANNUAL - difficulty.blackoutPenalty * percentDemandUnfulfilled;
  const marketingGrowth = customersFromMarketingSpend(state.monthlyMarketingSpend) / TICKS_PER_MONTH;

  // Save new financial info
  now.customers = Math.round(prev.customers * (1 + organicGrowthRate / TICKS_PER_YEAR) + marketingGrowth);
  now.cash = Math.round(prev.cash + revenue - expensesOM - expensesFuel - expensesCarbonFee - expensesInterest - expensesMarketing - principalRepayment);
  now.netWorth = getNetWorth(facilities, now.cash);
  now.revenue = revenue;
  now.expensesOM = expensesOM;
  now.expensesFuel = expensesFuel;
  now.expensesCarbonFee = expensesCarbonFee;
  now.expensesInterest = expensesInterest;
  now.expensesMarketing = expensesMarketing;
  now.kgco2e = kgco2e;

  return now;
}

function reforecastSupply(state: GameStateType, simulated?: boolean): TickPresentFutureType[] {
  // Make temporary deep copy so that it can be revised in place
  const newState = {...state};
  let prev = newState.timeline[0];
  return newState.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      t = updateSupplyFacilitiesFinances(newState, prev, {...t}, simulated);
    }
    prev = t;
    return t;
  });
}

export function generateNewTimeline(readOnlyState: GameStateType, cash: number, customers: number, ticks = TICKS_PER_DAY): TickPresentFutureType[] {
  // TODO performance optimization, figure out how to deep clone everything EXCEPT timeline, since I'm about to overwrite it
  const state = cloneDeep(readOnlyState);
  state.timeline = new Array(ticks) as TickPresentFutureType[];
  for (let i = 0; i < ticks; i++) {
    state.timeline[i] = {
      minute: state.date.minute + i * TICK_MINUTES,
      supplyW: 0,
      demandW: 0,
      sunlight: 0,
      windKph: 0,
      temperatureC: 0,
      cash,
      customers,
      netWorth: getNetWorth(state.facilities, cash),
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesMarketing: 0,
      kgco2e: 0,
    };
  }
  state.timeline = reforecastWeatherAndPrices(state);
  state.timeline = reforecastDemand(state);
  state.timeline = reforecastSupply(state, true);
  return state.timeline;
}

/**
 * Edits the state in place to handle all of the one-off consequences of building
 * (not including reforecasting, which should be done once after multiple builds)
 * @param state
 * @param g
 * @param financed
 * @param newGame
 * @returns
 */
function buildFacility(state: GameStateType, g: FacilityShoppingType, financed: boolean, newGame= false): GameStateType {
  const now = getTimeFromTimeline(state.date.minute, state.timeline);

  if (now) {
    let financing = {
      loanAmountTotal: 0,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
    };
    if (newGame) {
      // Don't charge anything for initial builds
    } else if (financed) {
      const downpayment = g.buildCost * DOWNPAYMENT_PERCENT;
      now.cash -= downpayment;
      const loanAmount = g.buildCost - downpayment;
      financing = {
        loanAmountTotal: loanAmount,
        loanAmountLeft: loanAmount,
        loanMonthlyPayment: getMonthlyPayment(loanAmount, INTEREST_RATE_YEARLY, LOAN_MONTHS),
      };
    } else { // purchased in cash
      now.cash -= g.buildCost;
    }
    const facility = {
      ...g,
      ...financing,
      id: state.facilities.reduce((max: number, f: FacilityOperatingType) => max > f.id ? max : f.id, 0) + 1,
      currentW: newGame && g.peakWh === undefined ? g.peakW : 0,
      yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
      minuteCreated: state.date.minute,
    } as FacilityOperatingType;
    if (g.peakWh) {
      facility.currentWh = 0;
      state.facilities.push(facility); // add storage to bottom so that it's on by default
    } else {
      state.facilities.unshift(facility); // add generators to top so that they produce by default
    }
  }

  return state;
}

// TODO account for generator current value better - get rid of SELL_MULTIPLIER everywhere and depreciate buildCost over time
function getNetWorth(facilities: FacilityOperatingType[], cash: number): number {
  let netWorth = cash;
  facilities.forEach((g: FacilityOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      netWorth += g.buildCost * GENERATOR_SELL_MULTIPLIER - g.loanAmountLeft;
    } else {
      netWorth += g.buildCost * DOWNPAYMENT_PERCENT;
    }
  });
  return netWorth;
}

// https://stackoverflow.com/questions/5306680/move-an-array-element-from-one-array-position-to-another
function arrayMove(arr: any[], oldIndex: number, newIndex: number) {
  if (newIndex >= arr.length) {
    let k = newIndex - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(newIndex, 0, arr.splice(oldIndex, 1)[0]);
}

export function gameState(state: GameStateType = cloneDeep(initialGameState), action: Redux.Action): GameStateType {
  // If statements instead of switch here b/c compiler was complaining about newState + const a being redeclared in block-scope
  if (action.type === 'GAME_TICK') { // Game tick first because it's called the most by far, shortens lookup

    if (state.inGame && state.speed !== 'PAUSED') {
      const newState = {
        ...state,
        date: getDateFromMinute(state.date.minute + TICK_MINUTES, state.startingYear),
      };
      const now = getTimeFromTimeline(newState.date.minute, newState.timeline);
      const prev = getTimeFromTimeline(newState.date.minute - TICK_MINUTES, newState.timeline);
      if (now && prev) {
        updateSupplyFacilitiesFinances(newState, prev, now);

        if (newState.date.sunrise !== state.date.sunrise) { // If it's a new day / month
          const history = newState.monthlyHistory;
          const {cash, customers} = now;

          // Record final history for the month, then generate the new timeline
          history.unshift(summarizeTimeline(newState.timeline, newState.startingYear));
          newState.timeline = generateNewTimeline(newState, cash, customers);

          // Pre-roll a few frames to compensate for temperature / demand jumps across months
          updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
          updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
          updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
          updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);

          // ===== TRIGGERS ======
          // Failure: Bankrupt
          if (now.cash < 0) {
            logEvent('scenario_end', {id: state.scenarioId, type: 'bankrupt', difficulty: state.difficulty});
            const summary = summarizeHistory(history);
            setTimeout(() => store.dispatch(openDialog({
              title: 'Bankrupt!',
              message: `You've run out of money.
                You survived for ${newState.date.year - newState.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${numbro(summary.kgco2e / 1000).format({thousandSeparated: true, mantissa: 0})} tons of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: 'Try again',
              action: () => store.dispatch(quitGame()),
            })), 1);
          }

          // Failure: Too many blackouts
          if (history[1] && history[2] && history[3] && history[1].supplyWh < history[1].demandWh * .9 && history[2].supplyWh < history[2].demandWh * .9 && history[3].supplyWh < history[3].demandWh * .9) {
            logEvent('scenario_end', {id: state.scenarioId, type: 'blackouts', difficulty: state.difficulty});
            const summary = summarizeHistory(history);
            setTimeout(() => store.dispatch(openDialog({
              title: 'Fired!',
              message: `You've allowed chronic blackouts for 3 months, causing shareholders to remove you from office.
                You survived for ${newState.date.year - newState.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${numbro(summary.kgco2e / 1000).format({thousandSeparated: true, mantissa: 0})} tons of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: 'Try again',
              action: () => store.dispatch(quitGame()),
            })), 1);
          }

          // Success: Survived duration
          const scenario = SCENARIOS.find((s) => s.id === newState.scenarioId) || {
            durationMonths: 12 * 20,
            endTitle: `You've retired!`,
          } as ScenarioType;
          if (newState.date.monthsEllapsed === scenario.durationMonths) {
            const localStoragePlayed = (getStorageJson('plays', {plays: []}) as any).plays as LocalStoragePlayedType[];
            setStorageKeyValue('plays', {plays: [...localStoragePlayed, {
              scenarioId: state.scenarioId,
              date: (new Date()).toString(),
            } as LocalStoragePlayedType]});

            // Calculate score - This is also described in the manual; if I update the algorithm, update the manual too!
            const summary = summarizeHistory(history);
            const blackoutsTWh = Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
            const score = {
              supply: Math.round(summary.supplyWh / 1000000000000),
              netWorth: Math.round(40 * summary.netWorth / 1000000000),
              customers: Math.round(2 * summary.customers / 100000),
              emissions: Math.round(-2 * summary.kgco2e / 1000000000),
              blackouts: Math.round(-8 * blackoutsTWh),
            };
            const finalScore = Object.values(score).reduce((a: number, b: number) => a + b);

            // TODO Submit score to highscores
            // {(!user || !user.uid) && <p>Your score was not submitted because you were not logged in!</p>}
            logEvent('scenario_end', {id: state.scenarioId, type: 'win', difficulty: state.difficulty, score: finalScore});
            setTimeout(() => store.dispatch(openDialog({
              title: scenario.endTitle || `You've retired!`,
              message: scenario.endMessage || <div>Your final score is {finalScore}:<br/><br/>
                +{score.supply} pts from electricity supplied<br/>
                +{score.netWorth} pts from final net worth<br/>
                +{score.customers} pts from final customers<br/>
                -{score.emissions} pts from emissions<br/>
                -{score.blackouts} pts from blackouts<br/>
              </div>,
              open: true,
              closeText: 'Keep playing',
              actionLabel: 'Return to menu',
              action: () => store.dispatch(quitGame()),
            })), 1);
          }
        }
      }

      if (newState.inGame) {
        setTimeout(() => store.dispatch({type: 'GAME_TICK'}), TICK_MS[state.speed]);
      }
      return newState;
    } else {
      if (state.inGame) {
        setTimeout(() => store.dispatch({type: 'GAME_TICK'}), TICK_MS.PAUSED);
      }
    }
    return state;

  } else if (action.type === 'GAMESTATE_DELTA') {

    return {...state, ...(action as any).delta};

  } else if (action.type === 'GAME_START') {

    return {...state, ...(action as StartGameAction).delta};

  } else if (action.type === 'BUILD_FACILITY') {

    const a = action as BuildFacilityAction;
    const newState = buildFacility({...state}, a.facility, a.financed);
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'SELL_FACILITY') {

    const newState = {...state};
    const id = (action as SellFacilityAction).id;
    // in one loop, refund cash from selling + remove from list
    newState.facilities = newState.facilities.filter((g: GeneratorOperatingType | StorageOperatingType) => {
      if (g.id === id) {
        const now = getTimeFromTimeline(newState.date.minute, newState.timeline);
        if (now) {
          now.cash += facilityCashBack(g);
        }
        return false;
      }
      return true;
    });
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'REPRIORITIZE_FACILITY') {

    const a = action as ReprioritizeFacilityAction;
    const newState = {...state};
    arrayMove(newState.facilities, a.spotInList, a.spotInList + a.delta);
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'NEW_GAME') {

    const a = action as NewGameAction;
    const scenario = SCENARIOS.find((s) => s.id === state.scenarioId) || SCENARIOS[0];
    let newState = {
      ...state,
      timeline: [] as TickPresentFutureType[],
      date: getDateFromMinute(0, scenario.startingYear),
      startingYear: scenario.startingYear,
      feePerKgCO2e: scenario.feePerKgCO2e,
      location: a.location,
    };
    newState.timeline = generateNewTimeline(newState, a.cash, a.customers);

    // TODO also search STORAGE
    a.facilities.forEach((search: Partial<FacilityShoppingType>) => {
      const generator = GENERATORS(newState, search.peakW || 1000000).find((g: FacilityShoppingType) => {
        for (const property in search) {
          if (g[property] !== search[property]) {
            return false;
          }
        }
        return true;
      });
      if (generator) {
        newState = buildFacility(newState, generator, false, true);
      } else {
        const storage = STORAGE(newState, search.peakWh || 1000000).find((g: FacilityShoppingType) => {
          for (const property in search) {
            if (g[property] !== search[property]) {
              return false;
            }
          }
          return true;
        });
        if (storage) {
          newState = buildFacility(newState, storage, false, true);
        }
      }
    });

    // Pre-roll a few frames once we have weather and demand info so generators and batteries start in a more accurate state
    updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
    updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
    updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
    updateSupplyFacilitiesFinances(newState, newState.timeline[0], newState.timeline[0], true);
    newState.timeline = reforecastSupply(newState);

    return newState;

  } else if (action.type === 'GAME_LOADED') {

    // Start ticking in game
    setTimeout(() => store.dispatch({type: 'GAME_TICK'}), TICK_MS.PAUSED);
    return {...state, inGame: true};

  } else if (action.type === 'SET_SPEED') {

    return {...state, speed: (action as SetSpeedAction).speed};

  } else if (action.type === 'DIALOG_OPEN') {

    previousSpeed = state.speed;
    return {...state, speed: 'PAUSED'};

  } else if (action.type === 'DIALOG_CLOSE') {

    return {...state, speed: previousSpeed};

  } else if (action.type === 'GAME_EXIT') {

    return cloneDeep(initialGameState);

  }
  return state;
}
