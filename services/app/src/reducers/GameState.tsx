import Redux from 'redux';
import {GENERATORS, TICK_MINUTES, TICK_MS} from '../Constants';
import {getStore} from '../Store';
import {GameStateType, GeneratorType, SetSpeedAction, SpeedType, TimelineType} from '../Types';

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

// export function getSunshinePercent(minute: number, sunrise: number, sunset: number) {
//   if (minute >= sunrise && minute <= sunset) {
//     const minutesFromDark = Math.min(minute - sunrise, sunset - minute);
//     // TODO improve approximation curve
//     // Day length / minutes from dark used as proxy for season / max sun height
//     // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.8+*+%28x+-+3%29%29%29+from+0+to+7
//     // Solar panels generally follow a Bell curve: https://www.solarpaneltalk.com/forum/solar/solar-energy-facts/374711-please-help-me-understand-my-production-rate-vs-my-system-size-confused
//     return 1 / (1 + Math.pow(Math.E, (-0.8 * (minutesFromDark - 3))));
//   }
//   return 0;
// }

export function getDemandW(minute: number, gameState: GameStateType) {
  // TODO curve based on time of day (non-seasonal)
  // TODO curve based on more evening demand when darker (lighting)
  // TODO curve based on warm temperature (semi-exponential above 70F for cooling)
  return 250000000;
}

export function getSupplyW(minute: number, gameState: GameStateType) {
  let supply = 0;
  gameState.generators.forEach((generator: GeneratorType) => {
    switch (generator.fuel) {
      case 'Sun':
        supply += generator.peakW; // TODO * solarOutput;
        break;
      case 'Wind':
        supply += generator.peakW; // TODO * windOutput;
        break;
      default:
        supply += generator.peakW;
        break;
    }
  });
  return supply;
}

export function generateTimelineDatapoint(minute: number, gameState: GameStateType) {
  return ({
    minute,
    supplyW: getSupplyW(minute, gameState),
    demandW: getDemandW(minute, gameState),
    solarOutput: 0,
    windOutput: 0,
    temperature: 0,
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
      const newGenerator = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
      return {
        ...state,
        generators: [...state.generators, newGenerator],
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
      console.log('Tick! Minute: ' + state.currentMinute);

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
            setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS / 3);
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
