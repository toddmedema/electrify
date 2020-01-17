import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {getMonthlyPayment, getPaymentInterest} from 'shared/helpers/Financials';
import {getRawSunlightPercent, getWeather} from 'shared/schema/Weather';
import {openDialog} from '../actions/UI';
import {DIFFICULTIES, DOWNPAYMENT_PERCENT, FUELS, GAME_TO_REAL_YEARS, GENERATOR_SELL_MULTIPLIER, GENERATORS, INTEREST_RATE_YEARLY, LOAN_MONTHS, REGIONAL_GROWTH_MAX_ANNUAL, RESERVE_MARGIN, TICK_MINUTES, TICK_MS, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_MONTH, TICKS_PER_YEAR, YEARS_PER_TICK} from '../Constants';
import {getStore} from '../Store';
import {BuildFacilityAction, DateType, FacilityOperatingType, FacilityShoppingType, GameStateType, GeneratorOperatingType, MonthlyHistoryType, NewGameAction, QuitGameAction, ReprioritizeFacilityAction, SellFacilityAction, SetSpeedAction, SpeedType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  difficulty: 'EMPLOYEE',
  speed: 'PAUSED',
  inGame: false,
  inTutorial: true,
  tutorialStep: -1, // Not set to 0 until after card transition, so that the target element exists
  facilities: [] as FacilityOperatingType[],
  date: getDateFromMinute(0),
  timeline: [] as TimelineType[],
  monthlyHistory: [] as MonthlyHistoryType[],
  seedPrefix: Math.random(),
  regionPopulation: 1000000,
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

export function quitGame(): QuitGameAction {
  return { type: 'GAME_EXIT' };
}

function getDemandW(date: DateType, gameState: GameStateType, sunlight: number, temperatureC: number) {
  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized = temperatureC / 30;
  const minutesFromDarkNormalized = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay) / 420;
  const demandMultiple = 387.5 + 69.5 * temperatureNormalized + 31.44 * minutesFromDarkNormalized;
      // + 192.12 * (Weekday variable)
  return demandMultiple * gameState.regionPopulation;
}

// Each frame, update the month's history with cumulative values -> use that to update finances
function updateMonthlyFinances(gameState: GameStateType, now: TimelineType): MonthlyHistoryType {
  const monthlyHistory = gameState.monthlyHistory[0];

  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh = Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const demandWh = now.demandW / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const revenue = supplyWh * dollarsPerWh;

  let kgco2e = 0;
  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  const expensesTaxesFees = 0; // TODO
  gameState.facilities.forEach((g: FacilityShoppingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerWh || 0) / TICKS_PER_HOUR * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        expensesFuel += fuelBtu * FUELS[g.fuel].costPerBtu;
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

  return {
    ...monthlyHistory,
    revenue: monthlyHistory.revenue + revenue,
    expensesOM: monthlyHistory.expensesOM + expensesOM,
    expensesFuel: monthlyHistory.expensesFuel + expensesFuel,
    expensesTaxesFees: monthlyHistory.expensesTaxesFees + expensesTaxesFees,
    expensesInterest: monthlyHistory.expensesInterest + expensesInterest,
    cash: Math.round(monthlyHistory.cash + revenue - expensesOM - expensesFuel - expensesTaxesFees - expensesInterest - principalRepayment),
    supplyWh: monthlyHistory.supplyWh + supplyWh,
    demandWh: monthlyHistory.demandWh + demandWh,
    kgco2e: monthlyHistory.kgco2e + kgco2e,
  };
}

function reforecastWeather(state: GameStateType): TimelineType[] {
  return state.timeline.map((t: TimelineType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute);
      const weather = getWeather('SF', date.hourOfFullYear);
      return {
        ...t,
        sunlight: getRawSunlightPercent(date) * (weather.CLOUD_PCT_NO + weather.CLOUD_PCT_FEW * .5 + weather.CLOUD_PCT_ALL * .2),
        windKph: weather.WIND_KPH,
        temperatureC: weather.TEMP_C,
      };
    }
    return t;
  });
}

function reforecastDemand(state: GameStateType): TimelineType[] {
  return state.timeline.map((t: TimelineType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute);
      return {
        ...t,
        demandW: getDemandW(date, state, t.sunlight, t.temperatureC),
      };
    }
    return t;
  });
}

// Updates construction status
// then calculates how much is needed to be supplied to meet demandW
// and changes generator / storage status (in place)
// (doesn't count storage charging against supply created)
function getSupplyWAndUpdateFacilities(facilities: FacilityOperatingType[], t: TimelineType) {
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
  // TODO maybe also calculate the total charge needed, and reduce that amount by 'charge' when checking to see if more power is needed
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.currentWh < g.peakWh && g.yearsToBuildLeft === 0) {
      indexOfLastUnchargedBattery = i;
      totalChargeNeeded += Math.min(g.peakW, (g.peakWh - g.currentWh) * TICKS_PER_HOUR);
    }
  });

  // Executed in sort order, aka highest priority first
  // Renewables produce what they will; on-demand produces up to demand + reserve margin
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.yearsToBuildLeft === 0) {
      const targetW = Math.max(0, t.demandW * (1 + RESERVE_MARGIN) - supply);
      if (g.fuel) { // Capable of generating electricity
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
              if (indexOfLastUnchargedBattery >= 0) { // If there's a battery to charge, output as much as possible to charge it beyond demand
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

function reforecastSupply(state: GameStateType): TimelineType[] {
  // Make temporary deep copy so that it can be revised in place
  const facilities = state.facilities.map((g: FacilityOperatingType) => ({...g}));
  return state.timeline.map((t: TimelineType) => {
    if (t.minute >= state.date.minute) {
      return {
        ...t,
        supplyW: getSupplyWAndUpdateFacilities(facilities, t),
      };
    }
    return t;
  });
}

export function reforecastAll(newState: GameStateType): TimelineType[] {
  newState.timeline = reforecastWeather(newState);
  newState.timeline = reforecastDemand(newState);
  newState.timeline = reforecastSupply(newState);
  return newState.timeline;
}

export function generateNewTimeline(startingMinute: number, ticks = TICKS_PER_DAY): TimelineType[] {
  const array = new Array(ticks) as TimelineType[];
  for (let i = 0; i < ticks; i++) {
    array[i] = {
      minute: startingMinute + i * TICK_MINUTES,
      supplyW: 0,
      demandW: 0,
      sunlight: 0,
      windKph: 0,
      temperatureC: 0,
    };
  }
  return array;
}

// Edits the state in place to handle all of the one-off consequences of building, not including reforecasting
// which should be done once after multiple builds
function buildFacility(state: GameStateType, g: FacilityShoppingType, financed: boolean): GameStateType {
  const newGame = state.timeline.length === 0;
  let financing = {
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
  };
  if (newGame) {
    // Don't charge anything for initial builds
  } else if (financed) {
    const downpayment = g.buildCost * DOWNPAYMENT_PERCENT;
    state.monthlyHistory[0].cash -= downpayment;
    const loanAmount = g.buildCost - downpayment;
    financing = {
      loanAmountTotal: loanAmount,
      loanAmountLeft: loanAmount,
      loanMonthlyPayment: getMonthlyPayment(loanAmount, INTEREST_RATE_YEARLY, LOAN_MONTHS),
    };
  } else { // purchased in cash
    state.monthlyHistory[0].cash -= g.buildCost;
  }
  const facility = {
    ...g,
    ...financing,
    id: Math.random(),
    priority: g.priority + Math.random(), // Vary priorities slightly for consistent sorting
    currentW: newGame && g.peakWh === undefined ? g.peakW : 0,
    yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
  } as FacilityOperatingType;
  if (g.peakWh) {
    facility.currentWh = 0;
  }
  state.facilities = [...state.facilities, facility];
  state.facilities.sort((i, j) => i.priority < j.priority ? 1 : -1);
  return state;
}

// TODO rather than force specifying a bunch of arguments, maybe accept a dela / overrides object?
function newMonthlyHistoryEntry(date: DateType, facilities: FacilityOperatingType[], cash: number): MonthlyHistoryType {
  return {
    year: date.year,
    month: date.monthNumber,
    supplyWh: 0,
    demandWh: 0,
    kgco2e: 0,
    cash,
    netWorth: getNetWorth(facilities, cash),
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesTaxesFees: 0,
    expensesInterest: 0,
  };
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

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  // If statements instead of switch here b/c compiler was complaining about newState + const a being redeclared in block-scope
  if (action.type === 'GAMESTATE_DELTA') {

    return {...state, ...(action as any).delta};

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
        // Refund slightly more if construction isn't complete - after all, that money hasn't been spent yet
        // But lose more upfront from material purchases: https://www.wolframalpha.com/input/?i=10*x+%5E+1%2F2+from+0+to+100
        const percentBuilt = (g.yearsToBuild - g.yearsToBuildLeft) / g.yearsToBuild;
        const lostFromSelling = g.buildCost * GENERATOR_SELL_MULTIPLIER;
        newState.monthlyHistory[0].cash += g.buildCost - lostFromSelling * Math.min(1, Math.pow(percentBuilt * 10, 1 / 2));
        return false;
      }
      return true;
    });
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'REPRIORITIZE_FACILITY') {

    const a = action as ReprioritizeFacilityAction;
    const newState = {...state};
    const left = newState.facilities[a.spotInList];
    const right = newState.facilities[a.spotInList + a.delta];
    const leftPriority = left.priority;
    left.priority = right.priority;
    right.priority = leftPriority;
    newState.facilities.sort((i, j) => i.priority < j.priority ? 1 : -1);
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'NEW_GAME') {

    // TODO also search STORAGE
    const a = action as NewGameAction;
    let newState = {
      ...state,
      regionPopulation: a.regionPopulation,
      timeline: [] as TimelineType[],
    };
    a.facilities.forEach((search: Partial<FacilityShoppingType>) => {
      const newFacility = GENERATORS(newState, search.peakW || 1000000).find((g: FacilityShoppingType) => {
        for (const property in search) {
          if (g[property] !== search[property]) {
            return false;
          }
        }
        return true;
      }) as FacilityShoppingType;
      newState = buildFacility(newState, newFacility, false);
    });
    newState.monthlyHistory = [newMonthlyHistoryEntry(state.date, newState.facilities, a.cash)]; // after building facilities
    newState.timeline = generateNewTimeline(0);
    newState.timeline = reforecastAll(newState);

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

    return {...state, speed: 'PAUSED'};

  } else if (action.type === 'GAME_EXIT') {

    return {...initialGameState};

  } else if (action.type === 'GAME_TICK') {

    if (state.inGame && state.speed !== 'PAUSED') {
      const newState = {
        ...state,
        date: getDateFromMinute(state.date.minute + TICK_MINUTES),
      };
      const now = newState.timeline.find((t: TimelineType) => t.minute >= newState.date.minute);
      if (now) {
        getSupplyWAndUpdateFacilities(newState.facilities, now);
        newState.monthlyHistory[0] = updateMonthlyFinances(state, now);
      }

      if (newState.date.sunrise !== state.date.sunrise) { // If it's a new day / month
        const difficulty = DIFFICULTIES[state.difficulty];

        // Update popultion, reduce growth rate when blackouts (can even go negative)
        const {demandWh, supplyWh} = newState.monthlyHistory[0];
        const percentDemandUnfulfilled = (demandWh - supplyWh) / demandWh;
        const growthRate = REGIONAL_GROWTH_MAX_ANNUAL - difficulty.blackoutPenalty * percentDemandUnfulfilled;
        newState.regionPopulation = Math.round(state.regionPopulation * (1 + growthRate / 12));

        // Record final history for the month, then insert a new blank month
        const cash = newState.monthlyHistory[0].cash;
        newState.monthlyHistory[0].netWorth = getNetWorth(newState.facilities, cash);
        newState.monthlyHistory.unshift(newMonthlyHistoryEntry(newState.date, newState.facilities, cash));

        // Populate a new forecast timeline
        newState.timeline = generateNewTimeline(newState.date.minute);
        newState.timeline = reforecastAll(newState);

        // Time-based tutorial triggers
        if (newState.inTutorial) {
          if (newState.date.monthsEllapsed === 12) {
            setTimeout(() => getStore().dispatch(openDialog({
              title: 'Tutorial complete!',
              message: '',
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
  }
  return state;
}
