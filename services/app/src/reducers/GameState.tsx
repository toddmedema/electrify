import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {getWeather} from 'shared/schema/Weather';
import {DAYS_PER_YEAR, FUELS, GENERATOR_SELL_MULTIPLIER, GENERATORS, RESERVE_MARGIN, TICK_MINUTES, TICK_MS, YEARS_PER_TICK} from '../Constants';
import {getStore} from '../Store';
import {BuildGeneratorAction, DateType, GameStateType, GeneratorOperatingType, GeneratorShoppingType, MonthlyHistoryType, ReprioritizeGeneratorAction, SellGeneratorAction, SetSpeedAction, SpeedType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  speed: 'NORMAL',
  inGame: false,
  generators: [] as GeneratorOperatingType[],
  currentMinute: 180, // This is the line where the chart switches from historic to forecast
  timeline: [] as TimelineType[],
  monthlyHistory: [] as MonthlyHistoryType[],
  seedPrefix: Math.random(),
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

function getRawSunlightPercent(date: DateType) {
  if (date.minuteOfDay >= date.sunrise && date.minuteOfDay <= date.sunset) {
    const minutesFromDark = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay);
    // TODO incorporate weather forecast (cloudiness)
    // TODO fix the pointiness, esp in shorter winter months
    // Maybe by factoring in day lenght to determine the shape of the curve?

    // Day length / minutes from dark used as proxy for season / max sun height
    // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.015+*+%28x+-+260%29%29%29+from+0+to+420
    // Solar panels generally follow a Bell curve
    return 1 / (1 + Math.pow(Math.E, (-0.015 * (minutesFromDark - 260))));
  }
  return 0;
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
  return demandMultiple * 4200000;
}

function sortGeneratorsByPriority(a: GeneratorOperatingType, b: GeneratorOperatingType) {
  return a.priority < b.priority ? 1 : -1;
}

// Calculate how much is needed to be supplied to meet demandW
function getSupplyW(gameState: GameStateType, sunlight: number, windKph: number, temperatureC: number, demandW: number) {
  let supply = 0;
  // Executed in sort order
  gameState.generators.forEach((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      switch (g.fuel) {
        case 'Sun':
          // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
          g.currentW = g.peakW * sunlight * Math.max(1, 1 - (temperatureC - 10) / 100);
          console.log(g.currentW);
          break;
        case 'Wind':
          // TODO what is the real number / curve for wind speed efficiency?
          g.currentW = g.peakW * windKph / 30;
          break;
        default:
          // TODO base off existing state + spin rate
          // TODO be intelligent about this
          // How? if the forecast is increasing / decreasing, have larger / smaller reserve?
          // Account for spin up / down time?
          const targetW = Math.max(0, demandW * (1 + RESERVE_MARGIN) - supply);
          g.currentW = Math.min(g.peakW, targetW);
          break;
      }
      supply += g.currentW;
    }
  });
  return supply;
}

function generateTimelineDatapoint(minute: number, gameState: GameStateType) {
  const date = getDateFromMinute(minute);
  const weather = getWeather('SF', date.hourOfFullYear);
  const sunlight = getRawSunlightPercent(date) * (weather.CLOUD_PCT_NO + weather.CLOUD_PCT_FEW * .5 + weather.CLOUD_PCT_ALL * .2);
  const windKph = weather.WIND_KPH;
  const temperatureC = weather.TEMP_C;
  const demandW = getDemandW(date, gameState, sunlight, temperatureC);

  return ({
    minute,
    supplyW: getSupplyW(gameState, sunlight, windKph, temperatureC, demandW),
    demandW,
    sunlight,
    windKph,
    temperatureC,
  });
}

// Each frame, update the month's history with cumulative values -> use that to update finances
function updateMonthlyHistory(gameState: GameStateType): MonthlyHistoryType {
  const monthlyHistory = gameState.monthlyHistory[0];
  const now = gameState.timeline.find((t: TimelineType) => t.minute >= gameState.currentMinute);
  if (!now) {
    return monthlyHistory;
  }

  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh = Math.min(now.supplyW, now.demandW) * TICK_MINUTES / 60;
  const demandWh = now.demandW * TICK_MINUTES / 60;
  const revenue = supplyWh * dollarsPerWh;

  let expensesOM = 0;
  let expensesFuel = 0;
  const expensesTaxesFees = 0; // TODO
  gameState.generators.forEach((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / DAYS_PER_YEAR / 1440 * TICK_MINUTES;
      if (FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerW || 0);
        expensesFuel += fuelBtu * FUELS[g.fuel].costPerBtu;
      }
    }
  });

  return {
    ...monthlyHistory,
    revenue: monthlyHistory.revenue + revenue,
    expensesOM: monthlyHistory.expensesOM + expensesOM,
    expensesFuel: monthlyHistory.expensesFuel + expensesFuel,
    expensesTaxesFees: monthlyHistory.expensesTaxesFees + expensesTaxesFees,
    cash: Math.round(monthlyHistory.cash + revenue - expensesOM - expensesFuel - expensesTaxesFees),
    supplyWh: monthlyHistory.supplyWh + supplyWh,
    demandWh: monthlyHistory.demandWh + demandWh,
  };
}

function reforecast(newState: GameStateType): TimelineType[] {
  return newState.timeline.map((t: TimelineType) => {
    if (t.minute > newState.currentMinute) {
      return generateTimelineDatapoint(t.minute, newState);
    }
    return t;
  });
}

// Updates generator construction / spin up status
function updateGenerators(state: GameStateType): GeneratorOperatingType[] {
  return state.generators.map((g: GeneratorOperatingType) => {
    if (g.yearsToBuildLeft > 0) {
      g.yearsToBuildLeft = Math.max(0, g.yearsToBuildLeft - YEARS_PER_TICK);
    } else {
      // TODO automanage based on demand, don't blindly spin up to max
      if (g.currentW < g.peakW) {
        g.currentW = Math.min(g.peakW, g.currentW + g.peakW / (g.spinMinutes || 1) * TICK_MINUTES);
      }
    }
    return g;
  });
}

// Edits the state in place to handle all of the one-off consequences of building, not including reforecasting
// which can be done once after multiple builds
function buildGenerator(state: GameStateType, g: GeneratorShoppingType): GameStateType {
  const newGame = state.timeline.length === 0;
  const generator = {
    ...g,
    id: Math.random(),
    priority: g.priority + Math.random(), // Vary priorities slightly
    currentW: 0, // TODO it starts at 0, and spins up in future ticks
    yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
  } as GeneratorOperatingType;
  state.generators.push(generator);
  state.generators.sort(sortGeneratorsByPriority);
  state.monthlyHistory[0].cash -= newGame ? 0 : generator.buildCost;
  return state;
}

// TODO rather than force specifying a bunch of arguments, maybe accept a dela / overrides object?
function newMonthlyHistoryEntry(minute: number, cash: number, netWorth: number): MonthlyHistoryType {
  const date = getDateFromMinute(minute);
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
  };
}

// TODO account for generators + depreciation
// (once that's done, need to udpate newMonthlyHistoryEntry to just use gameState to calculate...)
// (but, there's a circular dependency with declaring cash in the timeline...)
function getNetWorth(gameState: GameStateType): number {
  return gameState.monthlyHistory[0].cash;
}

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  // If statements instead of switch here b/c compiler was complaining about newState being redeclared in block-scope
  if (action.type === 'BUILD_GENERATOR') {
    const a = action as BuildGeneratorAction;
    const newState = buildGenerator({...state}, a.generator);
    newState.timeline = reforecast(newState);
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

    newState.timeline = reforecast(newState);
    return newState;

  } else if (action.type === 'REPRIORITIZE_GENERATOR') {
    const a = action as ReprioritizeGeneratorAction;
    const newState = {...state};
    const leftGenerator = newState.generators[a.spotInList];
    const rightGenerator = newState.generators[a.spotInList + a.delta];
    const leftPriority = leftGenerator.priority;
    leftGenerator.priority = rightGenerator.priority;
    rightGenerator.priority = leftPriority;
    newState.generators.sort(sortGeneratorsByPriority);
    return newState;

  } else if (action.type === 'GAME_START') {
    let newState = {
      ...state,
      inGame: true,
      timeline: [] as TimelineType[],
      monthlyHistory: [newMonthlyHistoryEntry(state.currentMinute, 1000000000, 1000000000)],
    };

    // TODO this is where different scenarios could have different generator starting conditions
    const COAL_GENERATOR = GENERATORS(newState, 2000000000).find((g: GeneratorShoppingType) => g.name === 'Coal') as GeneratorShoppingType;
    newState = buildGenerator(newState, COAL_GENERATOR);

    for (let minute = 0; minute < 1440; minute += TICK_MINUTES) {
      newState.timeline.push(generateTimelineDatapoint(minute, state));
    }
    return newState;

  } else if (action.type === 'SET_SPEED') {
    return {...state, speed: (action as SetSpeedAction).speed};

  } else if (action.type === 'GAME_EXIT') {
    return {...initialGameState};

  } else if (action.type === 'GAME_TICK') {
    if (state.inGame && state.speed !== 'PAUSED') {
      const newState = {
        ...state,
        currentMinute: state.currentMinute + TICK_MINUTES,
        generators: updateGenerators(state),
      };

      newState.monthlyHistory[0] = updateMonthlyHistory(state);

      // Update timeline
      // TODO (WARNING: PERFORMANCE HIT?) recalculate rest of forecast based on what just happened
      const newMinute = state.timeline[state.timeline.length - 1].minute + TICK_MINUTES;
      if (Math.floor(newState.currentMinute / 1440) > Math.floor(state.currentMinute / 1440)) { // If it's a new day / month
        // Record final history for the month, then insert a new blank month
        newState.monthlyHistory[0].netWorth = getNetWorth(newState);
        newState.monthlyHistory.unshift(newMonthlyHistoryEntry(newMinute, newState.monthlyHistory[0].cash, getNetWorth(state)));

        // Update timeline - keep the current (last) data point, recalculate everything else
        newState.timeline = newState.timeline.slice(-1);
        for (let minute = 0; minute < 1440; minute += TICK_MINUTES) {
          newState.timeline.push(generateTimelineDatapoint(newMinute + minute, newState));
        }
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
