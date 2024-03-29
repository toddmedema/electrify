import Redux from 'redux';

export function changeSettings(settings: any) {
  return (dispatch: Redux.Dispatch<any>): any => {
    dispatch({type: 'CHANGE_SETTINGS', settings});
  };
}
