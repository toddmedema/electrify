import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import Storage, {DispatchProps, StateProps} from './Storage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const StorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Storage);

export default StorageContainer;
