import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {getWeather} from 'shared/schema/Weather';
import {DAYS_PER_YEAR, FUELS, GENERATOR_SELL_MULTIPLIER, GENERATORS, TICK_MINUTES, TICK_MS, YEARS_PER_TICK} from '../Constants';
import {getStore} from '../Store';
import {BuildGeneratorAction, DateType, GameStateType, GeneratorOperatingType, GeneratorShoppingType, ReprioritizeGeneratorAction, SellGeneratorAction, SetSpeedAction, SpeedType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

const COAL_GENERATOR = GENERATORS.find((g: GeneratorShoppingType) => g.name === 'Coal') as GeneratorShoppingType;
const startingGenerator = {
  ...COAL_GENERATOR,
  id: Math.random(),
  currentW: COAL_GENERATOR.peakW,
  yearsToBuildLeft: 0,
} as GeneratorOperatingType;

export const initialGameState: GameStateType = {
  speed: 'NORMAL',
  inGame: false,
  cash: 10000000,
  generators: [startingGenerator] as GeneratorOperatingType[],
  currentMinute: 180, // This is the line where the chart switches from historic to forecast
  timeline: [] as TimelineType[],
  seedPrefix: Math.random(),
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

function getRawSunlightPercent(date: DateType) {
  if (date.minuteOfDay >= date.sunrise && date.minuteOfDay <= date.sunset) {
    const minutesFromDark = Math.min(date.minuteOfDay - date.sunrise, date.sunset - date.minuteOfDay);
    // TODO incorporate weather forecast (cloudiness)
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
  return demandMultiple * 1000000;
}

function sortGeneratorsByPriority(a: GeneratorOperatingType, b: GeneratorOperatingType) {
  return a.priority < b.priority ? 1 : -1;
}

function getSupplyW(gameState: GameStateType, sunlight: number, windKph: number, temperatureC: number) {
  let supply = 0;
  gameState.generators.forEach((generator: GeneratorOperatingType) => {
    switch (generator.fuel) {
      case 'Sun':
        // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
        supply += generator.peakW * sunlight * Math.max(1, 1 - (temperatureC - 10) / 100);
        break;
      case 'Wind':
        // TODO what is the real number / curve for wind speed efficiency?
        supply += generator.peakW * windKph / 30;
        break;
      default:
        supply += generator.peakW;
        break;
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

  return ({
    minute,
    supplyW: getSupplyW(gameState, sunlight, windKph, temperatureC),
    demandW: getDemandW(date, gameState, sunlight, temperatureC),
    sunlight,
    windKph,
    temperatureC,
  });
}

// export const getForecasts = createSelector(
//   [getGameState, getSunrise, getSunset],
//   (gameState, sunrise, sunset) => {
//     const rng = seedrandom(gameState.seedPrefix + gameState.timeline[0].minute);
//     // TODO cloudiness probabilities based on real life + season
//     let cloudiness = rng();
//     const forecasts = [];
//     for (let minute = 1; minute <= 24; minute++) {
//       // Cloudiness moves at most 0.25 per minute, can never be "100%" (solar panels still produce 10-25% when overcast)
//       cloudiness = Math.min(0.85, Math.max(0, cloudiness + rng() * 0.5 - 0.25));
//       const sunshine = (1 - cloudiness) * getSunshinePercent(minute, sunrise, sunset);

//       const windOutput = rng(); // TODO
//       const temperature = rng(); // TODO

//       // TODO temperature changes solarOutput
//       const solarOutput = sunshine;

//       const demand = getDemand(minute);

//       let supply = 0;
//       gameState.generators.forEach((generator: GeneratorType) => {
//         switch (generator.fuel) {
//           case 'Sun':
//             supply += generator.peakMW * solarOutput;
//             break;
//           case 'Wind':
//             supply += generator.peakMW * windOutput;
//             break;
//           default:
//             supply += generator.peakMW;
//             break;
//         }
//       });
//       forecasts.push({ minute, supply, demand, solarOutput, windOutput, temperature });
//     }

//     return forecasts;
//   }
// );

function calculateProfitAndLoss(gameState: GameStateType): number {
  const now = gameState.timeline.find((t: TimelineType) => t.minute >= gameState.currentMinute);
  if (!now) {
    return 0;
  }

  // TODO actually calculate market price / sale value
  const dollarsPerWh = 0.07 / 1000;
  const supplyW = Math.min(now.supplyW, now.demandW);
  const profits = supplyW * dollarsPerWh * 60 / TICK_MINUTES;

  // TODO fuel expenses
  const generatorOperatingExpenses = gameState.generators
    .reduce((acc: number, g: GeneratorOperatingType) => {
      if (g.yearsToBuildLeft > 0) {
        return acc;
      }

      let fuelCosts = 0;
      if (FUELS[g.fuel]) {
        const fuelBtu = g.currentW * (g.btuPerW || 0);
        fuelCosts = fuelBtu * FUELS[g.fuel].costPerBtu;
      }

      const operatingCosts = g.annualOperatingCost / DAYS_PER_YEAR / 1440 * TICK_MINUTES;

      // Annual total cost:
      // console.log((operatingCosts + fuelCosts) *  DAYS_PER_YEAR * 1440 / TICK_MINUTES);

      return acc + operatingCosts + fuelCosts;
    }, 0);
  const expenses = generatorOperatingExpenses;

  return profits - expenses;
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

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  // If statements instead of switch here b/c compiler was complaining about newState being redeclared in block-scope
  if (action.type === 'BUILD_GENERATOR') {
    const a = action as BuildGeneratorAction;
    const newState = {...state};
    const generator = {
      ...a.generator,
      id: Math.random(),
      priority: a.generator.priority + Math.random(), // Vary priorities slightly
      currentW: 0, // TODO it starts at 0, and spins up in future ticks
      yearsToBuildLeft: a.generator.yearsToBuild,
    } as GeneratorOperatingType;
    newState.generators.push(generator);
    newState.generators.sort(sortGeneratorsByPriority);
    newState.cash -= generator.buildCost;
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
        newState.cash += g.buildCost - lostFromSelling * Math.min(1, Math.pow(percentBuilt * 10, 1 / 2));
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
    const timeline = [] as TimelineType[];
    for (let minute = 0; minute < 1440; minute += TICK_MINUTES) {
      timeline.push(generateTimelineDatapoint(minute, state));
    }
    return {
      ...state,
      timeline,
      inGame: true,
    };
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

      // Update timeline
      // TODO (WARNING: PERFORMANCE HIT?) recalculate rest of forecast based on what just happened
      const newMinute = state.timeline[state.timeline.length - 1].minute + TICK_MINUTES;
      // If it's a new day, generate the new forecast - keep the current (last) data point, recalculate everything else
      if (Math.floor(newState.currentMinute / 1440) > Math.floor(state.currentMinute / 1440)) {
        newState.timeline = newState.timeline.slice(-1);
        for (let minute = 0; minute < 1440; minute += TICK_MINUTES) {
          newState.timeline.push(generateTimelineDatapoint(newMinute + minute, newState));
        }
      }

      // Update finances
      newState.cash += calculateProfitAndLoss(state);

      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS[state.speed]);
      return newState;
    } else {
      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS.SLOW);
    }
    return state;
  }
  return state;
}
