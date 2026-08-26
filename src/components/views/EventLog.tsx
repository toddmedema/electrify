import * as React from "react";
import { Typography } from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import BuildIcon from "@mui/icons-material/Build";
import FlashOffIcon from "@mui/icons-material/FlashOff";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import LocalGasStationIcon from "@mui/icons-material/LocalGasStation";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import GameCard from "../base/GameCard";
import { GameEventKindType, GameEventType } from "../../Types";

/**
 * What has happened to the company, in the order it happened.
 *
 * Everything in here used to be told to the player exactly once and then thrown away: a blackout
 * was a toolbar that pulsed until it stopped, a finished plant a toast that lasted four seconds.
 * Look away, or look at another pane, and there was no way to find out what you had missed --
 * which makes a simulation feel arbitrary rather than causal. This is the run's own record of it.
 */

const KIND_ICONS: { [k in GameEventKindType]: React.JSX.Element } = {
  BLACKOUT: <FlashOffIcon fontSize="small" />,
  BLACKOUT_OVER: <FlashOnIcon fontSize="small" />,
  CONSTRUCTION: <BuildIcon fontSize="small" />,
  BUILD: <AddCircleIcon fontSize="small" />,
  SELL: <RemoveCircleIcon fontSize="small" />,
  LOAN: <AccountBalanceIcon fontSize="small" />,
  FUEL_PRICE: <LocalGasStationIcon fontSize="small" />,
};

export interface StateProps {
  events: GameEventType[];
}

export interface Props extends StateProps {}

export default function EventLog(props: Props): React.JSX.Element {
  const { events } = props;
  return (
    <GameCard className="eventLog" title="Events" id="eventsPane">
      <div className="scrollable">
        {events.length === 0 && (
          <Typography
            className="eventLogEmpty"
            variant="body2"
            color="textSecondary"
          >
            Blackouts, finished construction, loans closing and fuel price
            swings will show up here as they happen.
          </Typography>
        )}
        <ul className="eventLogList">
          {events.map((event: GameEventType) => (
            <li className={`eventLogItem kind-${event.kind}`} key={event.id}>
              <span className="eventLogIcon" aria-hidden="true">
                {KIND_ICONS[event.kind]}
              </span>
              <Typography variant="body2" component="span">
                {event.message}
              </Typography>
              <Typography
                className="eventLogWhen"
                variant="body2"
                color="textSecondary"
                component="span"
              >
                {event.label}
              </Typography>
            </li>
          ))}
        </ul>
      </div>
    </GameCard>
  );
}
