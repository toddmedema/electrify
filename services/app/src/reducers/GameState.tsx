import Redux from 'redux';
import {GENERATORS, TICK_MINUTES, TICK_MS} from '../Constants';
import {getStore} from '../Store';
import {GameStateType, GeneratorType, TimelineType} from '../Types';

// const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  inGame: false,
  cash: 1000000,
  generators: [] as GeneratorType[],
  // TODO generate real data when you start playing
  currentMinute: 0,
  timeline: [
    {minute: 0, supplyW: 10000, demandW: 11500},
    {minute: 60, supplyW: 10000, demandW: 11400},
    {minute: 120, supplyW: 10000, demandW: 12000},
    {minute: 180, supplyW: 10000, demandW: 11800},
    {minute: 240, supplyW: 10000, demandW: 12100},
    {minute: 300, supplyW: 10000, demandW: 12900},
    {minute: 360, supplyW: 13000, demandW: 13600},
    {minute: 420, supplyW: 15000, demandW: 14700},
    {minute: 480, supplyW: 15600, demandW: 15300},
    {minute: 540, supplyW: 16500, demandW: 16000},
    {minute: 600, supplyW: 16000, demandW: 15700},
    {minute: 660, supplyW: 17000, demandW: 15800},
    {minute: 720, supplyW: 16500, demandW: 15600},
    {minute: 780, supplyW: 17500, demandW: 15500},
    {minute: 840, supplyW: 16000, demandW: 15600},
    {minute: 900, supplyW: 16200, demandW: 15900},
    {minute: 960, supplyW: 15500, demandW: 15500},
    {minute: 1020, supplyW: 14500, demandW: 14000},
    {minute: 1080, supplyW: 11000, demandW: 13000},
    {minute: 1140, supplyW: 10000, demandW: 12900},
    {minute: 1200, supplyW: 10000, demandW: 12800},
    {minute: 1260, supplyW: 10000, demandW: 12700},
    {minute: 1320, supplyW: 10000, demandW: 12000},
    {minute: 1380, supplyW: 10000, demandW: 11500},
  ] as TimelineType[],
  seedPrefix: Math.random(),
};

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

// export function getDemand(minute: number) {
//   // TODO curve based on time of day (non-seasonal)
//   // TODO curve based on more evening demand when darker (lighting)
//   // TODO curve based on warm temperature (semi-exponential above 70F for cooling)
//   return 1000;
// }

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
      // TODO GENERATE STUFF (at the right time interval... perhaps that should be a constant since it's used here + GAME_TICK)
      return {
        ...state,
        inGame: true,
      };
    case 'GAME_EXIT':
      return {
        ...initialGameState,
      };
    case 'GAME_TICK':
      console.log('Tick! Minute: ' + state.timeline[0].minute, state.currentMinute);
      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), TICK_MS);

      if (state.inGame) {
        const newState = {
          ...state,
          currentMinute: state.currentMinute + TICK_MINUTES,
        };

        // Generate the new forecast and remove the oldest data point
        // TODO better forecasting, which will also fix the state manipulation
        const newForecast = state.timeline[0];
        if (newForecast) {
          newForecast.minute = state.timeline[state.timeline.length - 1].minute + TICK_MINUTES;
          state.timeline.push(newForecast);
        }
        newState.timeline.shift();

        newState.cash += calculateProfitAndLoss(state);

        // TODO decide when to increment season + year

        return newState;
      }
      return state;
    default:
      return state;
  }
}
