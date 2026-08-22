import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import Navigation, { StateProps } from "./Navigation";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    card: state.card,
  };
};

const NavigationContainer = connect(mapStateToProps)(Navigation);

export default NavigationContainer;
