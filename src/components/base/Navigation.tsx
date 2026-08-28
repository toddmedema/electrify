import * as React from "react";
import { Badge, BottomNavigation, BottomNavigationAction } from "@mui/material";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import HistoryIcon from "@mui/icons-material/History";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import { useAppSelector, useAppDispatch } from "../../Store";
import { CardNameType, CardType } from "../../Types";
import { navigate, selectCardName } from "../../reducers/Card";
import { isPaneLayout } from "../../Globals";

export interface StateProps {
  card: CardType;
}

export interface Props extends StateProps {}

export default function Navigation() {
  const dispatch = useAppDispatch();
  const cardName = useAppSelector(selectCardName);
  const paneLayout = isPaneLayout();
  // Facilities is always the left pane at this width. If a resize lands here while that was
  // the active phone tab, Finances is the second pane actually being shown.
  const selectedCard =
    paneLayout && cardName === "FACILITIES" ? "FINANCES" : cardName;
  const unreadEvents = useAppSelector((state) => {
    const latest = state.game.eventLog?.[0]?.id || 0;
    return latest > (state.game.eventLogReadThroughId || 0);
  });
  return (
    <BottomNavigation
      id="navfooter"
      showLabels
      value={selectedCard || "MAIN_MENU"}
      onChange={(_e: React.SyntheticEvent, name: CardNameType) =>
        dispatch(navigate(name))
      }
    >
      {!paneLayout && (
        <BottomNavigationAction
          id="faciltiesNav"
          label="Facilities"
          value="FACILITIES"
          icon={<FlashOnIcon />}
        />
      )}
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
