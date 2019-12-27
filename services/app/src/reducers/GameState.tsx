import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {getMonthlyPayment, getPaymentInterest} from 'shared/helpers/Financials';
import {getRawSunlightPercent, getWeather} from 'shared/schema/Weather';
import {DOWNPAYMENT_PERCENT, FUELS, GENERATOR_SELL_MULTIPLIER, GENERATORS, INTEREST_RATE_YEARLY, LOAN_MONTHS, RESERVE_MARGIN, TICK_MINUTES, TICK_MS, TICKS_PER_DAY, TICKS_PER_MONTH, TICKS_PER_YEAR, YEARS_PER_TICK} from '../Constants';
import {getStore} from '../Store';
import {BuildGeneratorAction, DateType, GameStateType, GeneratorOperatingType, GeneratorShoppingType, MonthlyHistoryType, NewGameAction, ReprioritizeGeneratorAction, SellGeneratorAction, SetSpeedAction, SpeedType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  speed: 'NORMAL',
  inGame: false,
  generators: [] as GeneratorOperatingType[],
  date: getDateFromMinute(0),
  timeline: [] as TimelineType[],
  monthlyHistory: [] as MonthlyHistoryType[],
  seedPrefix: Math.random(),
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
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
  return demandMultiple * 4300000;
}

// Each frame, update the month's history with cumulative values -> use that to update finances
function updateMonthlyHistory(gameState: GameStateType, now: TimelineType): MonthlyHistoryType {
  const monthlyHistory = gameState.monthlyHistory[0];

  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh = Math.min(now.supplyW, now.demandW) * TICK_MINUTES / 60;
  const demandWh = now.demandW * TICK_MINUTES / 60;
  const revenue = supplyWh * dollarsPerWh;

  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  const expensesTaxesFees = 0; // TODO
  gameState.generators.forEach((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      if (FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerWh || 0) * TICK_MINUTES / 60;
        expensesFuel += fuelBtu * FUELS[g.fuel].costPerBtu;
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

// Calculate how much is needed to be supplied to meet demandW
// and changes generator status (in place)
function getSupplyWAndUpdateGenerators(generators: GeneratorOperatingType[], t: TimelineType) {
  let supply = 0;
  // Executed in sort order, aka highest priority first
  generators.forEach((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      switch (g.fuel) {
        case 'Sun':
          // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
          g.currentW = g.peakW * t.sunlight * Math.max(1, 1 - (t.temperatureC - 10) / 100);
          break;
        case 'Wind':
          // TODO what is the real number / curve for wind speed efficiency?
          g.currentW = g.peakW * t.windKph / 30;
          break;
        default:
          const targetW = Math.max(0, t.demandW * (1 + RESERVE_MARGIN) - supply);
          if (targetW < g.currentW) { // spinning down
            g.currentW = Math.max(0, targetW, g.currentW - g.peakW * TICK_MINUTES / (g.spinMinutes || 1));
          } else { // spinning up
            g.currentW = Math.min(g.peakW, targetW, g.currentW + g.peakW * TICK_MINUTES / (g.spinMinutes || 1));
          }
          break;
      }
      supply += g.currentW;
    }
  });
  return supply;
}

function reforecastSupply(state: GameStateType): TimelineType[] {
  // Make temporary deep copy so that it can be revised in place
  const generators = state.generators.map((g: GeneratorOperatingType) => ({...g}));
  return state.timeline.map((t: TimelineType) => {
    if (t.minute >= state.date.minute) {
      return {
        ...t,
        supplyW: getSupplyWAndUpdateGenerators(generators, t),
      };
    }
    return t;
  });
}

function reforecastAll(newState: GameStateType): TimelineType[] {
  newState.timeline = reforecastWeather(newState);
  newState.timeline = reforecastDemand(newState);
  newState.timeline = reforecastSupply(newState);
  return newState.timeline;
}

function generateNewTimeline(startingMinute: number): TimelineType[] {
  const array = new Array(TICKS_PER_DAY) as TimelineType[];
  for (let i = 0; i < TICKS_PER_DAY; i++) {
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

// Updates generator construction status
// reforecasts supply if any complete
function updateGeneratorConstruction(state: GameStateType): void {
  let oneFinished = false;
  state.generators.forEach((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft > 0) {
      g.yearsToBuildLeft = Math.max(0, g.yearsToBuildLeft - YEARS_PER_TICK);
      if (g.yearsToBuildLeft === 0) {
        oneFinished = true;
      }
    }
  });
  if (oneFinished) {
    state.timeline = reforecastSupply(state);
  }
}

// Edits the state in place to handle all of the one-off consequences of building, not including reforecasting
// which can be done once after multiple builds
function buildGenerator(state: GameStateType, g: GeneratorShoppingType, financed: boolean): GameStateType {
  const newGame = state.timeline.length === 0;
  let financing = {
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
  };
  if (newGame) {
    // Don't charge anything for initial generators
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
  const generator = {
    ...g,
    ...financing,
    id: Math.random(),
    priority: g.priority + Math.random(), // Vary priorities slightly for consistent sorting
    currentW: newGame ? g.peakW : 0,
    yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
  } as GeneratorOperatingType;
  state.generators.push(generator);
  state.generators.sort((i, j) => i.priority < j.priority ? 1 : -1);
  return state;
}

// TODO rather than force specifying a bunch of arguments, maybe accept a dela / overrides object?
function newMonthlyHistoryEntry(date: DateType, cash: number, netWorth: number): MonthlyHistoryType {
  return {
    year: date.year,
    month: date.monthNumber,
    supplyWh: 0,
    demandWh: 0,
    cash,
    netWorth,
    revenue: 0,
    expensesFuel: 0,
    expensesOM: 0,
    expensesTaxesFees: 0,
    expensesInterest: 0,
  };
}

// TODO account for generator current value (incl depreciation) + debts (i.e. outstanding loan principle)
// (once that's done, need to udpate newMonthlyHistoryEntry to just use gameState to calculate...)
// (but, there's a circular dependency with declaring cash in the timeline...)
function getNetWorth(gameState: GameStateType): number {
  return gameState.monthlyHistory[0].cash;
}

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  // If statements instead of switch here b/c compiler was complaining about newState + const a being redeclared in block-scope
  if (action.type === 'BUILD_GENERATOR') {

    const a = action as BuildGeneratorAction;
    const newState = buildGenerator({...state}, a.generator, a.financed);
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'SELL_GENERATOR') {

    const newState = {...state};
    const generatorId = (action as SellGeneratorAction).id;
    // in one loop, refund cash from selling + remove from list of generators
    newState.generators = newState.generators.filter((g: GeneratorOperatingType) => {
      if (g.id === generatorId) {
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

  } else if (action.type === 'REPRIORITIZE_GENERATOR') {

    const a = action as ReprioritizeGeneratorAction;
    const newState = {...state};
    const leftGenerator = newState.generators[a.spotInList];
    const rightGenerator = newState.generators[a.spotInList + a.delta];
    const leftPriority = leftGenerator.priority;
    leftGenerator.priority = rightGenerator.priority;
    rightGenerator.priority = leftPriority;
    newState.generators.sort((i, j) => i.priority < j.priority ? 1 : -1);
    newState.timeline = reforecastSupply(newState);
    return newState;

  } else if (action.type === 'NEW_GAME') {

    const a = action as NewGameAction;
    let newState = {
      ...state,
      timeline: [] as TimelineType[],
      monthlyHistory: [newMonthlyHistoryEntry(state.date, a.cash, a.cash)],
    };
    a.generators.forEach((search: Partial<GeneratorShoppingType>) => {
      const newGen = GENERATORS(newState, search.peakW || 1000000).find((g: GeneratorShoppingType) => {
        for (const property in search) {
          if (g[property] !== search[property]) {
            return false;
          }
        }
        return true;
      }) as GeneratorShoppingType;
      newState = buildGenerator(newState, newGen, false);
    });
    newState.timeline = generateNewTimeline(0);
    newState.timeline = reforecastAll(newState);
    return newState;

  } else if (action.type === 'GAME_LOADED') {

    return {...state, inGame: true};

  } else if (action.type === 'SET_SPEED') {

    return {...state, speed: (action as SetSpeedAction).speed};

  } else if (action.type === 'GAME_EXIT') {

    return {...initialGameState};

  } else if (action.type === 'GAME_TICK') {

    if (state.inGame && state.speed !== 'PAUSED') {
      const newState = {
        ...state,
        date: getDateFromMinute(state.date.minute + TICK_MINUTES),
      };
      updateGeneratorConstruction(newState);
      const now = newState.timeline.find((t: TimelineType) => t.minute >= newState.date.minute);
      if (now) {
        getSupplyWAndUpdateGenerators(newState.generators, now);
        newState.monthlyHistory[0] = updateMonthlyHistory(state, now);
      }

      if (newState.date.sunrise !== state.date.sunrise) { // If it's a new day / month
        // Record final history for the month, then insert a new blank month
        newState.monthlyHistory[0].netWorth = getNetWorth(newState);
        newState.monthlyHistory.unshift(newMonthlyHistoryEntry(newState.date, newState.monthlyHistory[0].cash, getNetWorth(state)));

        // Populate a new forecast timeline
        newState.timeline = generateNewTimeline(newState.date.minute);
        newState.timeline = reforecastAll(newState);
      }

      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS[state.speed]);
      return newState;
    } else {
      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS.SLOW);
    }
    return state;
  }
  return state;
}
