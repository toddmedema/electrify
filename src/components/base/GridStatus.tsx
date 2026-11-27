import * as React from "react";
import { flushSync } from "react-dom";
import { Button, IconButton, Popover } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type {
  CardNameType,
  EvidenceTargetType,
  TutorialActionType,
  GameType,
  TickPresentFutureType,
} from "../../Types";
import { getGridHealth, readyStorage } from "../../helpers/GridStatus";
import {
  formatForecastWatts,
  formatForecastWattHours,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import {
  formatClockTime,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import { projectedShortfall } from "../../helpers/MissionStatus";
import { isUtilityExpansionGame } from "../../helpers/ExpansionContext";
import { utilityServiceGap } from "../../helpers/UtilityPlanning";
import { monthMinute, topBarForecastEndMinute } from "../../helpers/Projection";
import { hasTerritoryNetwork } from "../../helpers/Territories";
import { getScenario } from "../../data/Scenarios";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { focusInitialDialogAction } from "./dialogFocus";
import { setManualHelpAnchor } from "./ManualHelpAnchor";
import { MONTHS } from "../../Constants";
import { useScreenEdgeMargin } from "../../ScreenEdgePadding";
import {
  projectionReady,
  readProjection,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

/** Subscribe to the existing deferred owner; a stale forecast is never read synchronously. */
function useSupplyRisk(
  game: GameType,
  now: TickPresentFutureType,
  enabled: boolean,
) {
  const [, landed] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(
    () => (enabled ? subscribeProjection(landed, "top-bar") : undefined),
    [enabled],
  );
  const ready = enabled && projectionReady(game, "top-bar");
  React.useEffect(() => {
    if (enabled && !ready) requestProjection(game, now, "top-bar");
  }, [enabled, ready, game, now]);
  const projection = ready ? readProjection(game, now, "top-bar") : undefined;
  const gap = projection && utilityServiceGap(game, projection);
  return { gap, forecast: projection?.forecast, updating: enabled && !ready };
}

function peakShortfallInMonth(
  forecast: readonly TickPresentFutureType[],
  monthStart: number,
) {
  const monthEnd = monthStart + MINUTES_PER_MONTH;
  let peak: { minute: number; watts: number } | undefined;
  for (const tick of forecast) {
    if (tick.minute < monthStart) continue;
    if (tick.minute >= monthEnd) break;
    const watts = tick.demandW - tick.supplyW;
    if (watts > (peak?.watts ?? 0)) peak = { minute: tick.minute, watts };
  }
  return peak;
}

function Power({ watts }: { watts: number }) {
  const text = watts === 0 ? "0MW" : formatWatts(watts);
  const split = text.match(/^(.*?)([kMGT]?W)$/);
  return (
    <span className="gridStatusPower">
      {split?.[1] ?? text}
      <span className="gridStatusUnit">{split?.[2]}</span>
    </span>
  );
}

export default function GridStatus({
  game,
  now,
  tutorialActions,
  onEvidence,
  onNavigate,
  onReserveHelp,
}: {
  game: GameType;
  now: TickPresentFutureType;
  tutorialActions?: TutorialActionType[];
  onEvidence?: (target: EvidenceTargetType) => void;
  onNavigate?: (card: CardNameType) => void;
  onReserveHelp?: () => void;
}) {
  const health = getGridHealth(game, now);
  const edgeMargin = useScreenEdgeMargin(16);
  const forecastEnd = topBarForecastEndMinute(game);
  const { gap, forecast, updating } = useSupplyRisk(
    game,
    now,
    isUtilityExpansionGame(game) && game.date.minute < forecastEnd,
  );
  const shortfall = projectedShortfall(game.timeline, game.date.minute);
  const ahead =
    shortfall && shortfall.minute < forecastEnd ? shortfall : undefined;
  const when = ahead
    ? getDateFromMinute(ahead.minute, game.startingYear)
    : undefined;
  const sameDay =
    ahead &&
    Math.floor(ahead.minute / 1440) === Math.floor(game.date.minute / 1440);
  const shortfallTime = when
    ? `${sameDay ? "" : `${when.month} ${when.year}, `}${formatClockTime(when)}`
    : undefined;
  const riskMonth = gap ? `${MONTHS[gap.month - 1]} ${gap.year}` : undefined;
  const future = shortfallTime
    ? `Short at ${shortfallTime}`
    : riskMonth
      ? `Shortage: ${riskMonth}`
      : undefined;
  const forecastMessage =
    ahead && shortfallTime
      ? `About ${formatForecastWatts(ahead.demandW - ahead.supplyW)} short at ${shortfallTime} in this month’s sample`
      : riskMonth
        ? `Projected reliability risk in ${riskMonth}`
        : updating
          ? "Updating forecast…"
          : undefined;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const riskMonthStart = gap && monthMinute(gap, game.startingYear);
  // The current month's finance row comes from the separate month-closing timeline.
  const riskPeak =
    anchor &&
    !ahead &&
    forecast &&
    riskMonthStart !== undefined &&
    riskMonthStart > game.date.minute
      ? peakShortfallInMonth(forecast, riskMonthStart)
      : undefined;
  const id = React.useId();
  const close = () => {
    const trigger = anchor;
    flushSync(() => setAnchor(null));
    trigger?.focus({ preventScroll: true });
  };
  const tutorial = !!getScenario(game.scenarioId, game.customScenario)
    ?.tutorialSteps;
  const forecastAllowed = !tutorial || !!tutorialActions?.includes("INSIGHTS");
  const navigate = (action: () => void) => {
    // Unmount the transient diagnosis before navigation replaces the map's one tool panel.
    flushSync(() => setAnchor(null));
    action();
  };
  const stressed = health.state !== "stable";
  const storedWh = anchor && stressed ? readyStorage(game).storedWh : 0;
  const territoryNetwork = hasTerritoryNetwork(game);
  const legacyInterties = !!(
    game.transmission?.lines.length &&
    (game.multiplayer || corridorsForLocation(game.location).length)
  );
  const openForecast = forecastAllowed && onEvidence;
  const openFleet = !tutorial && onNavigate;
  const externalPowerAction =
    !tutorial &&
    (territoryNetwork
      ? onNavigate && {
          label: "Manage agreements",
          run: () => onNavigate("AGREEMENTS"),
        }
      : legacyInterties &&
        onEvidence && {
          label: "Manage interties",
          run: () => onEvidence("interties"),
        });
  const warning =
    health.state === "low-reserve" || health.state === "at-limit" || !!future;
  return (
    <div
      className={`gridHealth gridHealth-${health.state}${warning && health.state !== "blackout" ? " statusWarning" : ""}`}
    >
      <button
        type="button"
        className="gridHealthSummary gridStatusButton"
        aria-label={`Current grid status: NOW ${health.metric}${health.state === "low-reserve" ? ", Low" : ""}${future ? `. FUTURE ${future}` : ""}. Open grid status`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
      >
        <span className="gridStatusNow">
          <span className="gridStatusQualifier">NOW</span>{" "}
          <Power watts={health.watts} />{" "}
          {health.state === "blackout" ? "short" : "reserve"}
          {health.state === "low-reserve" && " · Low"}
        </span>
        {future && (
          <span className="gridStatusFuture">
            <span className="gridStatusQualifier">FUTURE</span> {future}
          </span>
        )}
      </button>
      <span className="srOnly" aria-live="polite">
        {future ? `Future supply warning. ${future}.` : ""}
      </span>
      <Popover
        transitionDuration={0}
        disableRestoreFocus
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        marginThreshold={edgeMargin}
        slotProps={{
          transition: {
            onEntered: (node: HTMLElement) => {
              focusInitialDialogAction(node);
            },
          },
          paper: {
            className: "gridStatusPopover",
            role: "dialog",
            "aria-labelledby": `${id}-title`,
          },
        }}
      >
        <div className="gridStatusHeading">
          <h2 id={`${id}-title`}>Grid status</h2>
          <IconButton aria-label="Close grid status" onClick={close}>
            <CloseIcon />
          </IconButton>
        </div>
        <section aria-labelledby={`${id}-now`} className="gridStatusDiagnosis">
          <div
            className={`gridStatusCurrent gridStatusCurrent-${health.state}`}
          >
            <div className="gridStatusReadout">
              <h3 id={`${id}-now`}>Now · {health.label}</h3>
              <strong>{health.metric}</strong>
            </div>
            {onReserveHelp && (
              <Button
                onClick={() => {
                  const trigger = anchor;
                  navigate(() => {
                    trigger?.focus({ preventScroll: true });
                    setManualHelpAnchor(trigger);
                    onReserveHelp();
                  });
                }}
              >
                About reserve
              </Button>
            )}
          </div>
          {forecastMessage && (
            <div className={future ? "gridStatusOutlook" : "gridStatusContext"}>
              <p>{forecastMessage}</p>
              {gap && !ahead && (
                <div className="gridStatusOutlookDetail">
                  <p>
                    About {formatForecastWattHours(gap.demandWh - gap.supplyWh)}{" "}
                    unmet
                  </p>
                  {riskPeak && (
                    <p>
                      {formatForecastWatts(riskPeak.watts)} peak shortfall at{" "}
                      {formatClockTime(
                        getDateFromMinute(riskPeak.minute, game.startingYear),
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {storedWh > 0 && (
            <p className="gridStatusContext">
              {formatWattHours(storedWh)} stored in operating facilities
            </p>
          )}
        </section>
        {(openForecast || openFleet || externalPowerAction) && (
          <div className="gridStatusActions">
            {openForecast && (
              <Button
                variant="contained"
                onClick={() =>
                  navigate(() =>
                    openForecast({ card: "INSIGHTS", layer: "SUPPLY_DEMAND" }),
                  )
                }
              >
                View supply forecast
              </Button>
            )}
            {(openFleet || externalPowerAction) && (
              <div className="gridStatusSecondaryActions">
                {openFleet && (
                  <Button
                    onClick={() =>
                      navigate(() =>
                        openFleet(territoryNetwork ? "FLEET" : "FACILITIES"),
                      )
                    }
                  >
                    Manage fleet
                  </Button>
                )}
                {externalPowerAction && (
                  <Button onClick={() => navigate(externalPowerAction.run)}>
                    {externalPowerAction.label}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Popover>
    </div>
  );
}
