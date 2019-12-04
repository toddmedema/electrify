import Redux from 'redux';
import { createSelector } from 'reselect';
import {GENERATORS} from '../Constants';
import {getStore} from '../Store';
import {AppStateType, GameStateType, GeneratorType, SeasonType} from '../Types';

const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  cash: 1000000,
  generators: [] as GeneratorType[],
  season: 'Spring' as SeasonType,
  seedPrefix: Math.random(),
  tick: 0,
  year: 1990,
};

const getGameState = (state: AppStateType) => state.gameState;
const getSeason = (state: AppStateType) => state.gameState.season;

// Based on SF/California for now, v2 change by location
export const getSunrise = createSelector(
  [getSeason],
  (season) => {
    switch (season) {
      case 'Spring':
        return 7;
      case 'Summer':
        return 6;
      case 'Fall':
        return 7;
      case 'Winter':
      default:
        return 7;
    }
  }
);

// Based on SF/California for now, v2 change by location
export const getSunset = createSelector(
  [getSeason],
  (season) => {
    switch (season) {
      case 'Spring':
        return 18;
      case 'Summer':
        return 21;
      case 'Fall':
        return 20;
      case 'Winter':
      default:
        return 17;
    }
  }
);

export function getSunshine(hour: number, sunrise: number, sunset: number) {
  if (hour >= sunrise && hour <= sunset) {
    const hoursFromDark = Math.min(hour - sunrise, sunset - hour);
    // TODO improve approximation curve
    // Day length / hours from dark used as proxy for season / max sun height
    // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.8+*+%28x+-+3%29%29%29+from+0+to+7
    // Solar panels generally follow a Bell curve: https://www.solarpaneltalk.com/forum/solar/solar-energy-facts/374711-please-help-me-understand-my-production-rate-vs-my-system-size-confused
    return 1 / (1 + Math.pow(Math.E, (-0.8 * (hoursFromDark - 3))));
  }
  return 0;
}

export function getDemand(hour: number) {
  // TODO curve based on time of day (non-seasonal)
  // TODO curve based on more evening demand when darker (lighting)
  // TODO curve based on warm temperature (semi-exponential above 70F for cooling)
  return 1000;
}

export const getForecasts = createSelector(
  [getGameState, getSunrise, getSunset],
  (gameState, sunrise, sunset) => {
    const rng = seedrandom(gameState.seedPrefix + gameState.tick);
    // TODO cloudiness probabilities based on real life + season
    let cloudiness = rng();
    const forecasts = [];
    for (let hour = 1; hour <= 24; hour++) {
      // Cloudiness moves at most 0.25 per hour, can never be "100%" (solar panels still produce 10-25% when overcast)
      cloudiness = Math.min(0.85, Math.max(0, cloudiness + rng() * 0.5 - 0.25));
      const sunshine = (1 - cloudiness) * getSunshine(hour, sunrise, sunset);

      const windOutput = rng(); // TODO
      const temperature = rng(); // TODO

      // TODO temperature changes solarOutput
      const solarOutput = sunshine;

      const demand = getDemand(hour);

      let supply = 0;
      gameState.generators.forEach((generator: GeneratorType) => {
        switch (generator.fuel) {
          case 'Sun':
            supply += generator.peakMW * solarOutput;
            break;
          case 'Wind':
            supply += generator.peakMW * windOutput;
            break;
          default:
            supply += generator.peakMW;
            break;
        }
      });
      forecasts.push({ hour, supply, demand, solarOutput, windOutput, temperature });
    }

    return forecasts;
  }
);

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  switch (action.type) {
    case 'BUILD_GENERATOR':
      const newGenerator = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
      return {
        ...state,
        generators: [...state.generators, newGenerator],
      };
    case 'EXIT_GAME':
      return {
        ...initialGameState,
      };
    case 'GAME_TICK':
      const newState = {
        ...state,
        tick: state.tick + 1,
      };
      setTimeout(() => getStore().dispatch({type: 'GAME_TICK'}), 1000);
      console.log(newState.tick);
      return newState;
    default:
      return state;
  }
}
