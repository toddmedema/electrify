import Redux from 'redux';
import {getDateFromMinute, getTimeFromTimeline} from 'shared/helpers/DateTime';
import {customersFromMarketingSpend, facilityCashBack, getMonthlyPayment, getPaymentInterest, summarizeHistory, summarizeTimeline} from 'shared/helpers/Financials';
import {formatMoneyConcise} from 'shared/helpers/Format';
import {getFuelPricesPerMBTU} from 'shared/schema/FuelPrices';
import {getRawSunlightPercent, getWeather} from 'shared/schema/Weather';
import {openDialog} from '../actions/UI';
import {DIFFICULTIES, DOWNPAYMENT_PERCENT, FUELS, GAME_TO_REAL_YEARS, GENERATOR_SELL_MULTIPLIER, INTEREST_RATE_YEARLY, LOAN_MONTHS, ORGANIC_GROWTH_MAX_ANNUAL, RESERVE_MARGIN, TICK_MINUTES, TICK_MS, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MONTH, TICKS_PER_YEAR, YEARS_PER_TICK} from '../Constants';
import {GENERATORS, STORAGE} from '../Facilities';
import {getStorageJson, setStorageKeyValue} from '../LocalStorage';
import {SCENARIOS} from '../Scenarios';
import {getStore} from '../Store';
import {BuildFacilityAction, DateType, FacilityOperatingType, FacilityShoppingType, GameStateType, GeneratorOperatingType, MonthlyHistoryType, NewGameAction, QuitGameAction, ReprioritizeFacilityAction, ScoresContainerType, ScoreType, SellFacilityAction, SetSpeedAction, SpeedType, StartGameAction, TickPresentFutureType} from '../Types';

// const seedrandom = require('seedrandom');
const numbro = require('numbro');
const cloneDeep = require('lodash.clonedeep');

let previousSpeed = 'PAUSED' as SpeedType;
const initialGameState: GameStateType = {
  scenarioId: 100,
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
  seedPrefix: Math.random(),
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

export function quitGame(): QuitGameAction {
  return { type: 'GAME_EXIT' };
}

function getDemandW(date: DateType, gameState: GameStateType, prev: TickPresentFutureType, now: TickPresentFutureType) {
  // Simplified customer forecast, assumes no blackouts since supply calculation depends on demand (circular depedency)
  const marketingGrowth = customersFromMarketingSpend(gameState.monthlyMarketingSpend) / TICKS_PER_MONTH;
  now.customers = Math.round(prev.customers * (1 + ORGANIC_GROWTH_MAX_ANNUAL / TICKS_PER_YEAR) + marketingGrowth);

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized = (now.temperatureC + 2) / 21;
  const minutesFromDarkNormalized = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay) / 420;
  const minutesFromDarkLogistics = 1 / (1 + Math.pow(Math.E, -minutesFromDarkNormalized * 6));
  const minutesFrom9amNormalized = Math.abs(date.minuteOfDay - 540) / 120;
  const minutesFrom9amLogistics = 1 / (1 + Math.pow(Math.E, -minutesFrom9amNormalized * 2));
  const minutesFrom5pmNormalized = Math.abs(date.minuteOfDay - 1020) / 240;
  const minutesFrom5pmLogistics = 1 / (1 + Math.pow(Math.E, -minutesFrom5pmNormalized * 2));
  const demandMultiple = 430 + 70 * temperatureNormalized - 40 * minutesFrom9amLogistics + 30 * minutesFromDarkLogistics - 65 * minutesFrom5pmLogistics;
      // + 192.12 * (Weekday variable)
  return demandMultiple * now.customers;
}

function updateFinances(gameState: GameStateType, prev: TickPresentFutureType, now: TickPresentFutureType) {
  const difficulty = DIFFICULTIES[gameState.difficulty];

  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh = Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const demandWh = now.demandW / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const revenue = supplyWh * dollarsPerWh;

  // Facilities
  let kgco2e = 0;
  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  gameState.facilities.forEach((g: FacilityShoppingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerWh || 0) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        expensesFuel += fuelBtu * getFuelPricesPerMBTU(gameState.date)[g.fuel] / 1000000;
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
  const expensesCarbonFee = gameState.feePerKgCO2e * kgco2e;
  const expensesMarketing = gameState.monthlyMarketingSpend / TICKS_PER_MONTH;

  // Customers
  const percentDemandUnfulfilled = (demandWh - supplyWh) / demandWh;
  const organicGrowthRate = ORGANIC_GROWTH_MAX_ANNUAL - difficulty.blackoutPenalty * percentDemandUnfulfilled;
  const marketingGrowth = customersFromMarketingSpend(gameState.monthlyMarketingSpend) / TICKS_PER_MONTH;

  now.customers = Math.round(prev.customers * (1 + organicGrowthRate / TICKS_PER_YEAR) + marketingGrowth);
  now.cash = Math.round(prev.cash + revenue - expensesOM - expensesFuel - expensesCarbonFee - expensesInterest - expensesMarketing - principalRepayment),
  now.revenue = revenue;
  now.expensesOM = expensesOM;
  now.expensesFuel = expensesFuel;
  now.expensesCarbonFee = expensesCarbonFee;
  now.expensesInterest = expensesInterest;
  now.expensesMarketing = expensesMarketing;
  now.kgco2e = kgco2e;
}

function reforecastWeatherAndPrices(state: GameStateType): TickPresentFutureType[] {
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = getWeather('SF', date.hourOfFullYear);
      const fuelPrices = getFuelPricesPerMBTU(date);
      return {
        ...t,
        ...fuelPrices,
        sunlight: getRawSunlightPercent(date) * (weather.CLOUD_PCT_NO + weather.CLOUD_PCT_FEW * .5 + weather.CLOUD_PCT_ALL * .2),
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

// Updates construction status
// then calculates how much is needed to be supplied to meet demandW
// and changes generator / storage status (in place)
// (doesn't count storage charging against supply created)
function getSupplyWAndUpdateFacilities(facilities: FacilityOperatingType[], t: TickPresentFutureType) {
  // UPDATE CONSTRUCTION STATUS
  facilities.forEach((g: FacilityOperatingType) => {
    if (g.yearsToBuildLeft > 0) {
      g.yearsToBuildLeft = Math.max(0, g.yearsToBuildLeft - YEARS_PER_TICK);
    }
  });

  let supply = 0;
  let charge = 0;
  const turbineWindMS = t.windKph * Math.pow(100 / 10, 0.34) / 5; // 5kph = 1m/s
    // Wind gradient, assuming 10m weather station, 100m wind turbine, neutral air above human habitation - https://en.wikipedia.org/wiki/Wind_gradient

  let indexOfLastUnchargedBattery = -1;
  let totalChargeNeeded = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.currentWh < g.peakWh && g.yearsToBuildLeft === 0) {
      indexOfLastUnchargedBattery = i;
      totalChargeNeeded += Math.min(g.peakW, (g.peakWh - g.currentWh) * TICKS_PER_HOUR);
    }
  });

  // Renewables produce what they will; on-demand produces up to demand + reserve margin
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.yearsToBuildLeft === 0) {
      if (g.fuel) { // Capable of generating electricity
        const targetW = Math.max(0, t.demandW * (1 + RESERVE_MARGIN) - supply);
        switch (g.fuel) {
          case 'Sun':
            // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
            // TODO what about rain and snow, esp panels covered in snow?
            g.currentW = g.peakW * t.sunlight * Math.max(1, 1 - (t.temperatureC - 10) / 100);
            break;
          case 'Wind':
            // Production output is sloped from 3-14m/s, capped on zero and peak at both ends, and cut off >25m/s - http://www.wind-power-program.com/turbine_characteristics.htm
            if (turbineWindMS < 3 || turbineWindMS > 25) {
              g.currentW = 0;
            } else {
              const outputFactor = Math.max(0, Math.min(1, (turbineWindMS - 3) / 11));
              g.currentW = g.peakW * outputFactor;
            }
            break;
          default:
            if (targetW > g.currentW || i < indexOfLastUnchargedBattery) { // spinning up
              // If there's a battery to charge after me, output as much as possible to charge it beyond demand
              if (indexOfLastUnchargedBattery >= 0 && i < indexOfLastUnchargedBattery) {
                g.currentW = Math.min(t.demandW + totalChargeNeeded - charge, g.peakW, g.currentW + g.peakW * TICK_MINUTES / g.spinMinutes);
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
        const targetW = Math.max(0, t.demandW - supply);
        if (g.currentWh > 0 && targetW > 0) { // If there's a need and we have charge, discharge
          g.currentW = Math.min(g.peakW, targetW, g.currentWh * TICKS_PER_HOUR);
          g.currentWh = Math.max(0, g.currentWh - g.currentW / TICKS_PER_HOUR);
          supply += g.currentW;
        } else if (g.currentWh < g.peakWh && supply - charge > t.demandW) { // If there's spare capacity, charge
          g.currentW = -Math.min(g.peakW, supply - t.demandW - charge, (g.peakWh - g.currentWh) * TICKS_PER_HOUR);
          g.currentWh = Math.min(g.peakWh, g.currentWh - g.currentW / TICKS_PER_HOUR);
          charge -= g.currentW / g.roundTripEfficiency;
        } else {
          g.currentW = 0;
        }
      }
    }
  });

  return supply;
}

function reforecastSupply(state: GameStateType): TickPresentFutureType[] {
  // Make temporary deep copy so that it can be revised in place
  const facilities = state.facilities.map((g: FacilityOperatingType) => ({...g}));
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      return {
        ...t,
        supplyW: getSupplyWAndUpdateFacilities(facilities, t),
      };
    }
    return t;
  });
}

// edits in place
export function generateNewTimeline(state: GameStateType, cash: number, customers: number, ticks = TICKS_PER_DAY) {
  const timeline = new Array(ticks) as TickPresentFutureType[];
  for (let i = 0; i < ticks; i++) {
    timeline[i] = {
      minute: state.date.minute + i * TICK_MINUTES,
      supplyW: 0,
      demandW: 0,
      sunlight: 0,
      windKph: 0,
      temperatureC: 0,
      cash,
      customers,
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesMarketing: 0,
      kgco2e: 0,
    };
  }
  state.timeline = timeline;
  state.timeline = reforecastWeatherAndPrices(state);
  state.timeline = reforecastDemand(state);
  state.timeline = reforecastSupply(state);
}

// Edits the state in place to handle all of the one-off consequences of building, not including reforecasting
// which should be done once after multiple builds
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
    }
    state.facilities.unshift(facility);
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
function array_move(arr: any[], oldIndex: number, newIndex: number) {
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
        getSupplyWAndUpdateFacilities(newState.facilities, now);
        updateFinances(state, prev, now);
        const {cash, customers} = now;

        if (newState.date.sunrise !== state.date.sunrise) { // If it's a new day / month
          const history = newState.monthlyHistory;

          // Record final history for the month, then generate the new timeline
          history.unshift(summarizeTimeline(newState.timeline, newState.startingYear));
          history[0].netWorth = getNetWorth(newState.facilities, cash);
          generateNewTimeline(newState, cash, customers);

          // ===== TRIGGERS ======
          if (now.cash < 0) {
            const summary = summarizeHistory(history);
            setTimeout(() => getStore().dispatch(openDialog({
              title: 'Bankrupt!',
              message: `You've run out of money.
                You survived for ${newState.date.year - newState.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${numbro(summary.kgco2e / 1000).format({thousandSeparated: true, mantissa: 0})} tons of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: 'Try again',
              action: () => getStore().dispatch(quitGame()),
            })), 1);
          }

          if (history[1] && history[2] && history[3] && history[1].supplyWh < history[1].demandWh * .9 && history[2].supplyWh < history[2].demandWh * .9 && history[3].supplyWh < history[3].demandWh * .9) {
            const summary = summarizeHistory(history);
            setTimeout(() => getStore().dispatch(openDialog({
              title: 'Fired!',
              message: `You've allowed chronic blackouts for 3 months, causing shareholders to remove you from office.
                You survived for ${newState.date.year - newState.startingYear} years,
                earned ${formatMoneyConcise(summary.revenue)} in revenue
                and emitted ${numbro(summary.kgco2e / 1000).format({thousandSeparated: true, mantissa: 0})} tons of pollution.`,
              open: true,
              notCancellable: true,
              actionLabel: 'Try again',
              action: () => getStore().dispatch(quitGame()),
            })), 1);
          }

          const scenario = SCENARIOS.find((s) => s.id === newState.scenarioId) || {
            durationMonths: 12 * 20,
            endMessageTitle: `You've retired!`,
          };
          if (newState.date.monthsEllapsed === scenario.durationMonths) {
            const summary = summarizeHistory(history);
            const blackoutsTWh = Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
            // This is also described in the manual; if I update the algorithm, update the manual too!
            const finalScore = Math.round(summary.supplyWh / 1000000000000 + 40 * summary.netWorth / 1000000000 + summary.customers / 100000 - 3 * summary.kgco2e / 1000000000000 - 100 * blackoutsTWh);
            const scores = (getStorageJson('highscores', {scores: []}) as ScoresContainerType).scores;
            setStorageKeyValue('highscores', {scores: [...scores, {
              score: finalScore,
              scenarioId: state.scenarioId,
              difficulty: state.difficulty,
              date: (new Date()).toString(),
            } as ScoreType]});
            setTimeout(() => getStore().dispatch(openDialog({
              title: scenario.endMessageTitle || `You've retired!`,
              message: `Your score is ${finalScore}.`,
              open: true,
              closeText: 'Keep playing',
              actionLabel: 'Return to menu',
              action: () => getStore().dispatch(quitGame()),
            })), 1);
          }
        }
      }

      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS[state.speed]);
      return newState;
    } else {
      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS.PAUSED);
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
    newState.facilities = newState.facilities.filter((g: GeneratorOperatingType) => {
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
    array_move(newState.facilities, a.spotInList, a.spotInList + a.delta);
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
    };
    generateNewTimeline(newState, a.cash, a.customers);

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
    getSupplyWAndUpdateFacilities(newState.facilities, newState.timeline[0]);
    getSupplyWAndUpdateFacilities(newState.facilities, newState.timeline[0]);
    getSupplyWAndUpdateFacilities(newState.facilities, newState.timeline[0]);
    getSupplyWAndUpdateFacilities(newState.facilities, newState.timeline[0]);
    newState.timeline = reforecastSupply(newState);

    return newState;

  } else if (action.type === 'GAME_LOADED') {

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
