import ManualLink from "./ManualLink";
import { MANUAL_ENTRY } from "../../data/Manual";
import * as React from "react";
import { Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RemoveIcon from "@mui/icons-material/Remove";
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
  const previousDirection = React.useRef(direction);
  const lastMotion = React.useRef(-Infinity);
  const [moving, setMoving] = React.useState<string | null>(null);
  const motionEnabled = game.speed === "SLOW" || game.speed === "NORMAL";
  React.useEffect(() => {
    const changed = previousDirection.current !== direction;
    previousDirection.current = direction;
    setMoving(null);
    // Initial display and resume are snapshots, not new trades. FAST can reverse many
    // times a second; don't queue effects or let an old arrow outlive its direction.
    if (!changed || !motionEnabled || direction === "Standing by") return;
    let finish: number | undefined;
    const timer = window.setTimeout(() => {
      if (performance.now() - lastMotion.current < 2500) return;
      lastMotion.current = performance.now();
      setMoving(direction);
      // Reduced motion suppresses animationend, but must still consume this cue.
      finish = window.setTimeout(() => setMoving(null), 500);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(finish);
    };
  }, [direction, motionEnabled]);
  const available = now.transmissionCapacityW || 0;
  const operatingLines = (game.transmission?.lines || []).filter(
    ({ yearsToBuildLeft }) => yearsToBuildLeft <= 0,
  );
  const nameplate = operatingLines.reduce(
    (sum, line) => sum + line.capacityW,
    0,
  );
  const weatherLimited = available + 1 < nameplate;

  return (
    <div className="powerExchangeSummary">
      <div className="powerExchangeHero">
        <img src="/images/transmission.svg" alt="" />
        <div>
          <Typography variant="h6" className="powerExchangeDirection">
            {direction}
            <span
              aria-hidden="true"
              className="powerExchangeArrow"
              data-direction={direction}
              data-moving={(motionEnabled && moving === direction) || undefined}
              onAnimationEnd={() => setMoving(null)}
            >
              {direction === "Importing" ? (
                <ArrowBackIcon />
              ) : direction === "Exporting" ? (
                <ArrowForwardIcon />
              ) : (
                <RemoveIcon />
              )}
            </span>
          </Typography>
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
          {/* With several lines this is what trade actually cost, weighted by each line's flow */}
          <dt>
            {operatingLines.length > 1
              ? "Average neighbor price"
              : "Neighbor price"}
          </dt>
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
