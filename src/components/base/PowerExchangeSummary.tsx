import * as React from "react";
import { Typography } from "@mui/material";
import { GameType, TickPresentFutureType } from "../../Types";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";

export default function PowerExchangeSummary({
  game,
  now,
}: {
  game: GameType;
  now: TickPresentFutureType;
}) {
  const flow = (now.importedW || 0) - (now.exportedW || 0);
  const direction =
    flow > 0 ? "Importing" : flow < 0 ? "Exporting" : "Standing by";
  const available = now.transmissionCapacityW || 0;
  const nameplate = (game.transmission?.lines || [])
    .filter(({ yearsToBuildLeft }) => yearsToBuildLeft <= 0)
    .reduce((sum, line) => sum + line.capacityW, 0);
  const weatherLimited = available + 1 < nameplate;

  return (
    <div className="powerExchangeSummary">
      <div className="powerExchangeHero">
        <img src="/images/transmission.svg" alt="" />
        <div>
          <Typography variant="h6">{direction}</Typography>
          <Typography color="textSecondary" variant="body2">
            Power automatically follows your trading rule. Imports fill a
            shortage; exports use only energy above demand and your reserve.
          </Typography>
        </div>
      </div>
      <dl className="powerExchangeMetrics">
        <div>
          <dt>Power flowing</dt>
          <dd>{formatWatts(Math.abs(flow))}</dd>
        </div>
        <div>
          <dt>Available capacity</dt>
          <dd>{formatWatts(available)}</dd>
        </div>
        <div>
          <dt>Neighbor price</dt>
          <dd>{formatMoneyConcise(now.marketPricePerMWh || 0)}/MWh</dd>
        </div>
      </dl>
      <Typography
        className={weatherLimited ? "transmissionWeatherWarning" : undefined}
        variant="body2"
        color={weatherLimited ? "warning.main" : "textSecondary"}
      >
        {weatherLimited
          ? `Hot, sunny weather has reduced the lines from ${formatWatts(nameplate)} nameplate capacity.`
          : "Cooler, cloudier weather lets the lines carry their full rating."}
      </Typography>
    </div>
  );
}
