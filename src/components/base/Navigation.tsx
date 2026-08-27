import * as React from "react";
import { Badge, BottomNavigation, BottomNavigationAction } from "@mui/material";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import HistoryIcon from "@mui/icons-material/History";
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
  const unreadEvents = useAppSelector((state) => {
    const latest = state.game.eventLog?.[0]?.id || 0;
    return latest > (state.game.eventLogReadThroughId || 0);
  });
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
      <BottomNavigationAction
        id="eventsNav"
        label="Events"
        value="EVENTS"
        icon={
          <Badge color="primary" variant="dot" invisible={!unreadEvents}>
            <HistoryIcon />
          </Badge>
        }
      />
    </BottomNavigation>
  );
}
