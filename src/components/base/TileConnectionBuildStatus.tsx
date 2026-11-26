import * as React from "react";
import { Button, Typography } from "@mui/material";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  formatConnectionDuration,
  tileConnectionProgress,
  type TileConnection,
} from "../../helpers/TerritoryConnections";
import ConstructionProgressBar from "./ConstructionProgress";

export default function TileConnectionBuildStatus({
  connection,
  minute,
  paused,
  announce = false,
}: {
  connection: TileConnection;
  minute: number;
  paused: boolean;
  announce?: boolean;
}) {
  const status = React.useId();
  const progress = tileConnectionProgress(connection, minute);
  const monthsLeft = Math.ceil(
    (connection.connectionMinute - minute) / MINUTES_PER_MONTH,
  );
  return (
    <div className="tileConnectionBuild">
      <Button
        variant="contained"
        disabled
        aria-describedby={`${status} ${status}-progress`}
      >
        Build here
      </Button>
      <Typography
        id={status}
        component="p"
        variant="body2"
        role={announce ? "alert" : undefined}
      >
        {minute >= connection.towerMinute
          ? "Waiting for upstream connection"
          : "Constructing transmission lines"}
        {" · "}
        {formatConnectionDuration(monthsLeft)} left
      </Typography>
      <span id={`${status}-progress`} className="srOnly">
        {Math.floor(progress * 100)}% complete
      </span>
      <ConstructionProgressBar builtFraction={progress} paused={paused} />
    </div>
  );
}
