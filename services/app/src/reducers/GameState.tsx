import Redux from 'redux';
import { createSelector } from 'reselect';
import {GENERATORS} from '../Constants';
import {getStore} from '../Store';
import {AppStateType, GameStateType, GeneratorType, SeasonType, TimelineType} from '../Types';

const seedrandom = require('seedrandom');

export const initialGameState: GameStateType = {
  cash: 1000000,
  generators: [] as GeneratorType[],
  timeline: [  {hour: 1, supplyW: 10000, demandW: 11500},
  {hour: 2, supplyW: 10000, demandW: 11400},
  {hour: 3, supplyW: 10000, demandW: 12000},
  {hour: 4, supplyW: 10000, demandW: 11800},
  {hour: 5, supplyW: 10000, demandW: 12100},
  {hour: 6, supplyW: 10000, demandW: 12900},
  {hour: 7, supplyW: 13000, demandW: 13600},
  {hour: 8, supplyW: 15000, demandW: 14700},
  {hour: 9, supplyW: 15600, demandW: 15300},
  {hour: 10, supplyW: 16500, demandW: 16000},
  {hour: 11, supplyW: 16000, demandW: 15700},
  {hour: 12, supplyW: 17000, demandW: 15800},
  {hour: 13, supplyW: 16500, demandW: 15600},
  {hour: 14, supplyW: 17500, demandW: 15500},
  {hour: 15, supplyW: 16000, demandW: 15600},
  {hour: 16, supplyW: 16200, demandW: 15900},
  {hour: 17, supplyW: 15500, demandW: 15500},
  {hour: 18, supplyW: 14500, demandW: 14000},
  {hour: 19, supplyW: 11000, demandW: 13000},
  {hour: 20, supplyW: 10000, demandW: 12900},
  {hour: 21, supplyW: 10000, demandW: 12800},
  {hour: 22, supplyW: 10000, demandW: 12700},
  {hour: 23, supplyW: 10000, demandW: 12000},
  {hour: 24, supplyW: 10000, demandW: 11500}] as TimelineType[],
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

export function getSunshinePercent(hour: number, sunrise: number, sunset: number) {
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
      const sunshine = (1 - cloudiness) * getSunshinePercent(hour, sunrise, sunset);

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
      // TODO better forecasting
      const tempForecast = state.timeline.shift();
      if (tempForecast) {
        tempForecast.hour = state.timeline[state.timeline.length - 1].hour + 1;
        state.timeline.push(tempForecast);
      }
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
