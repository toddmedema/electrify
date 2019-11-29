import Redux from 'redux';
import { createSelector } from 'reselect';
import {GENERATORS} from '../Constants';
import {AppStateType, GameStateType, GeneratorType, SeasonType} from '../Types';

const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  generators: [] as GeneratorType[],
  season: 'Spring' as SeasonType,
  seedPrefix: Math.random(),
  turn: 1,
  turnMax: 16,
  finances: {
    cash: 1000000,
  },
};

const getGameState = (state: AppStateType) => state.gameState;
const getSeason = (state: AppStateType) => state.gameState.season;

// Based on Pittsburgh for now, v2 change by location
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

// Based on Pittsburgh for now, v2 change by location
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

export function getSolarOutputCurve(hour: number, sunrise: number, sunset: number) {
  if (hour >= sunrise && hour <= sunset) {
    const hoursFromDark = Math.min(hour - sunrise, sunset - hour);
    // TODO improve approximation
    // Rough approximation of solar output: https://www.wolframalpha.com/input/?i=plot+1%2F%281+%2B+e+%5E+%28-0.8+*+%28x+-+3%29%29%29+from+0+to+7
    // Solar panels generally follow a Bell curve: https://www.solarpaneltalk.com/forum/solar/solar-energy-facts/374711-please-help-me-understand-my-production-rate-vs-my-system-size-confused
    return 1 / (1 + Math.pow(Math.E, (-0.8 * (hoursFromDark - 3))));
  }
  return 0;
}

export const getForecasts = createSelector(
  [getGameState, getSunrise, getSunset],
  (gameState, sunrise, sunset) => {
    const rng = seedrandom(gameState.seedPrefix + gameState.turn);
    const forecasts = [];
    for (let hour = 1; hour <= 24; hour++) {
      // TODO add a bit of cloudy randomness
      const solarOutput = getSolarOutputCurve(hour, sunrise, sunset);

      const windOutput = 0; // TODO
      const temperature = 0; // TODO

      const demand = rng() * 1000; // TODO

      let supply = 0;
      gameState.generators.forEach((generator: GeneratorType) => {
        switch (generator.fuel) {
          case 'Sun':
            supply += generator.peakMW * solarOutput;
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
    default:
      return state;
  }
}
