import * as React from "react";
import { BottomNavigation, BottomNavigationAction } from "@mui/material";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import { useAppSelector, useAppDispatch } from "../../Store";
import { CardNameType, CardType } from "../../Types";
import { navigate, selectCardName } from "../../reducers/Card";

export interface StateProps {
  card: CardType;
}

export interface Props extends StateProps {}

export default function Navigation() {
  const dispatch = useAppDispatch();
  const cardName = useAppSelector(selectCardName);
  return (
    <BottomNavigation
      id="navfooter"
      showLabels
      value={cardName || "MAIN_MENU"}
      onChange={(_e: React.SyntheticEvent, name: CardNameType) =>
        dispatch(navigate(name))
      }
    >
      <BottomNavigationAction
        id="faciltiesNav"
        label="Facilities"
        value="FACILITIES"
        icon={<FlashOnIcon />}
      />
      <BottomNavigationAction
        id="financesNav"
        label="Finances"
        value="FINANCES"
        icon={<AttachMoneyIcon />}
      />
      <BottomNavigationAction
        id="forecastsNav"
        label="Forecasts"
        value="FORECASTS"
        icon={<InsertChartIcon />}
      />
    </BottomNavigation>
  );
}
