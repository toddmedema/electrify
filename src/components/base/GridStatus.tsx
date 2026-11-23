import * as React from "react";
import { flushSync } from "react-dom";
import { Button, IconButton, Popover } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type {
  CardNameType,
  EvidenceTargetType,
  GameToolType,
  GameType,
  TickPresentFutureType,
} from "../../Types";
import { getGridHealth, readyStorage } from "../../helpers/GridStatus";
import {
  formatForecastWatts,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { formatClockTime, getDateFromMinute } from "../../helpers/DateTime";
import { projectedShortfall } from "../../helpers/MissionStatus";
import { isUtilityExpansionGame } from "../../helpers/ExpansionContext";
import { utilityServiceGap } from "../../helpers/UtilityPlanning";
import { topBarForecastEndMinute } from "../../helpers/Projection";
import { hasTerritoryNetwork } from "../../helpers/Territories";
import { getScenario } from "../../data/Scenarios";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
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
  const gap = ready
    ? utilityServiceGap(game, readProjection(game, now, "top-bar"))
    : undefined;
  return { gap, updating: enabled && !ready };
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
  tutorialActions?: GameToolType[];
  onEvidence?: (target: EvidenceTargetType) => void;
  onNavigate?: (card: CardNameType) => void;
  onReserveHelp?: () => void;
}) {
  const health = getGridHealth(game, now);
  const edgeMargin = useScreenEdgeMargin(16);
  const forecastEnd = topBarForecastEndMinute(game);
  const { gap, updating } = useSupplyRisk(
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
      ? `Supply risk: ${riskMonth}`
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
  const title = React.useRef<HTMLHeadingElement>(null);
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
  const customerImportedW = (now.importedW ?? 0) - (now.storageImportedW ?? 0);
  const territoryNetwork = hasTerritoryNetwork(game);
  const legacyInterties = !!(
    game.transmission?.lines.length &&
    (game.multiplayer || corridorsForLocation(game.location).length)
  );
  const forecastAction =
    forecastAllowed && onEvidence
      ? {
          label: "View supply forecast",
          run: () => onEvidence({ card: "INSIGHTS", layer: "SUPPLY_DEMAND" }),
        }
      : undefined;
  const fleetAction =
    !tutorial && onNavigate
      ? {
          label: "Manage fleet",
          run: () => onNavigate(territoryNetwork ? "FLEET" : "FACILITIES"),
        }
      : undefined;
  const primaryAction =
    stressed && fleetAction ? fleetAction : (forecastAction ?? fleetAction);
  const secondaryAction =
    primaryAction === fleetAction ? forecastAction : fleetAction;
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
          transition: { onEntered: () => title.current?.focus() },
          paper: {
            className: "gridStatusPopover",
            role: "dialog",
            "aria-labelledby": `${id}-title`,
          },
        }}
      >
        <div className="gridStatusHeading">
          <h2 id={`${id}-title`} ref={title} tabIndex={-1}>
            Grid status
          </h2>
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
            <p className={future ? "gridStatusOutlook" : "gridStatusContext"}>
              {forecastMessage}
            </p>
          )}
          {customerImportedW > 0 && (
            <p className="gridStatusContext">
              {formatWatts(customerImportedW)} imported for customers
            </p>
          )}
          {storedWh > 0 && (
            <p className="gridStatusContext">
              {formatWattHours(storedWh)} stored in operating facilities
            </p>
          )}
        </section>
        {(primaryAction || externalPowerAction) && (
          <div className="gridStatusActions">
            {primaryAction && (
              <Button
                variant="contained"
                onClick={() => navigate(primaryAction.run)}
              >
                {primaryAction.label}
              </Button>
            )}
            {(secondaryAction || externalPowerAction) && (
              <div className="gridStatusSecondaryActions">
                {secondaryAction && (
                  <Button onClick={() => navigate(secondaryAction.run)}>
                    {secondaryAction.label}
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
