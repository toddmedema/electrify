import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {TICK_MINUTES, TICK_MS} from '../Constants';
import {getStore} from '../Store';
import {BuildGeneratorAction, DateType, GameStateType, GeneratorType, SetSpeedAction, SpeedType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  speed: 'NORMAL',
  inGame: false,
  cash: 1000000,
  generators: [] as GeneratorType[],
  currentMinute: 180, // This is the line where the chart switches from historic to forecast
  timeline: [] as TimelineType[],
  seedPrefix: Math.random(),
};

export function setSpeed(speed: SpeedType): SetSpeedAction {
  return { type: 'SET_SPEED', speed };
}

export function forecastSunlightPercent(date: DateType) {
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

export function getDemandW(date: DateType, gameState: GameStateType, sunlight: number, temperatureC: number) {
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

export function getSupplyW(gameState: GameStateType, sunlight: number, windKph: number, temperatureC: number) {
  let supply = 0;
  gameState.generators.forEach((generator: GeneratorType) => {
    switch (generator.fuel) {
      case 'Sun':
        // Solar panels slightly less efficient in warm weather, declining about 1% efficiency per 1C starting at 10C
        supply += generator.peakW * sunlight * Math.max(1, 1 - (temperatureC - 10) / 100);
        break;
      case 'Wind':
        supply += generator.peakW * windKph / 30;
        break;
      default:
        supply += generator.peakW;
        break;
    }
  });
  return supply;
}

export function generateTimelineDatapoint(minute: number, gameState: GameStateType) {
  const date = getDateFromMinute(minute);
  const sunlight = forecastSunlightPercent(date);

  // TODO use real weather data
  const windKph = 10;
  const temperatureC = 10;
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

function calculateProfitAndLoss(gameState: GameStateType) {
  const dollarsPerWh = 0.14 / 1000;
  const supplyW = 100000000;

  const expenses = 1; // TODO make sure this is in the right units (i.e. if generators op expenses are per year but this is per TICK_MINUTES, and how many "days" are in a year?)

  return supplyW * dollarsPerWh * 60 / TICK_MINUTES - expenses;
}

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  switch (action.type) {
    case 'BUILD_GENERATOR':
      return {
        ...state,
        generators: [...state.generators, (action as BuildGeneratorAction).generator],
      };
    case 'GAME_START':
      const timeline = [] as TimelineType[];
      for (let minute = 0; minute < 1440; minute += TICK_MINUTES) {
        timeline.push(generateTimelineDatapoint(minute, state));
      }
      return {
        ...state,
        timeline,
        inGame: true,
      };
    case 'SET_SPEED':
      return {...state, speed: (action as SetSpeedAction).speed};
    case 'GAME_EXIT':
      return {...initialGameState};
    case 'GAME_TICK':
      if (state.inGame) {
        if (state.speed !== 'PAUSED') {
          const newState = {
            ...state,
            currentMinute: state.currentMinute + TICK_MINUTES,
          };

          // Update timeline
          newState.timeline.shift();
          const newMinute = state.timeline[state.timeline.length - 1].minute + TICK_MINUTES;
          state.timeline.push(generateTimelineDatapoint(newMinute, state));

          // Update finances
          newState.cash += calculateProfitAndLoss(state);

          if (state.speed === 'SLOW') {
            setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS * 2);
          } else if (state.speed === 'FAST') {
            setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS / 4);
          } else {
            setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS);
          }
          return newState;
        } else {
          setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS);
        }
      } else {
        setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS);
      }
      return state;
    default:
      return state;
  }
}
