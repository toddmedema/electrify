import ManualLink from "./ManualLink";
import { MANUAL_ENTRY } from "../../data/Manual";
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
        </div>
      </div>
      <ManualLink entry={MANUAL_ENTRY.INTERTIES} text="How interties work" />
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
      {weatherLimited && (
        <Typography
          className="transmissionWeatherWarning"
          variant="body2"
          color="warning.main"
        >
          Hot, sunny weather has reduced the lines from {formatWatts(nameplate)}{" "}
          nameplate capacity.
        </Typography>
      )}
    </div>
  );
}
