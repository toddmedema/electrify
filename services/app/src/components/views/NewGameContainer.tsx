import {quitGame} from 'app/reducers/GameState';
import {connect} from 'react-redux';
import Redux from 'redux';

import {toCard} from 'app/actions/Card';
import {AppStateType, GameStateType} from '../../Types';
import NewGame, {DispatchProps, StateProps} from './NewGame';

import {FIREBASE_CONFIG} from 'app/Globals';
import * as firebase from 'firebase';
import withFirebaseAuth from 'react-with-firebase-auth';
const firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
const firebaseAppAuth = firebaseApp.auth();
const providers = {
  googleProvider: new firebase.auth.GoogleAuthProvider(),
};

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(quitGame());
    },
    onDetails: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
      dispatch(toCard({name: 'NEW_GAME_DETAILS'}));
    },
    onCustomGame: () => {
      dispatch(toCard({name: 'CUSTOM_GAME'}));
    },
  };
};

const NewGameContainer =  withFirebaseAuth({
  providers,
  firebaseAppAuth,
})(connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGame));

export default NewGameContainer;
