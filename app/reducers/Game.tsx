import Redux from 'redux'
import {BuildGeneratorAction} from '../actions/ActionTypes'
import {GameState} from './StateTypes'
import {GENERATORS} from '../Constants'


export const initialGame: GameState = {
  company: {
    name: 'Electric Power Authority',
    money: 10000000,
    generators: [],
    generatorsUnderConstruction: [],
    researched: [],
    researchInProgress: [],
  },
  time: {
    index: 0,
    quarter: 'Spring',
    year: 1990,
    minutesEllapsed: 0,
  },
};

export function game(state: GameState = initialGame, action: Redux.Action): GameState {
  switch(action.type) {
    case 'BUILD_GENERATOR':
      const newState = {...state};
      const generatorId = (action as BuildGeneratorAction).id;
      const generator = GENERATORS[generatorId];
      newState.company.money -= generator.costBuild;
      newState.company.generators.push({
        id: generatorId,
        dayBuilt: state.time.index,
        enabled: true,
        currentCapacityMultiplier: 1,
      });
      return newState;
    case 'GAME_NEW':
      return {...initialGame};
    default:
      return state;
  }
}
