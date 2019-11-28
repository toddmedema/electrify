import Redux from 'redux';
import {GameStateType, SeasonType} from '../Types';

export const initialGameState: GameStateType = {
  season: 'Spring' as SeasonType,
  seedPrefix: Math.random(),
  turn: 1,
  turnMax: 16,
  finances: {
    cash: 1000000,
  },
};

// TODO any randomness should be done as:
// const rng = seedrandom(seedPrefix + turn);
// rng();
// https://github.com/davidbau/seedrandom

export function gameState(state: GameStateType = initialGameState, action: Redux.Action): GameStateType {
  switch (action.type) {
    case 'FOO':
      return state;
    case 'EXIT_GAME':
      return {
        ...initialGameState,
      };
    default:
      return state;
  }
}
