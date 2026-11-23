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
  const future = when
    ? `Short at ${sameDay ? "" : `${when.month} ${when.year}, `}${formatClockTime(when)}`
    : gap
      ? `Supply risk: ${MONTHS[gap.month - 1]} ${gap.year}`
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
  const storage = anchor ? readyStorage(game) : undefined;
  const territoryNetwork = hasTerritoryNetwork(game);
  const legacyInterties = !!(
    game.transmission?.lines.length &&
    (game.multiplayer || corridorsForLocation(game.location).length)
  );
  const importedW = now.importedW;
  const storageImportedW = now.storageImportedW ?? 0;
  const customerImportedW =
    importedW === undefined
      ? undefined
      : Math.max(0, importedW - storageImportedW);
  const importedShare =
    customerImportedW !== undefined && now.supplyW > 0
      ? Math.round((100 * customerImportedW) / now.supplyW)
      : undefined;
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
        <section aria-labelledby={`${id}-now`}>
          <h3 id={`${id}-now`}>Now</h3>
          <dl>
            <div>
              <dt>Demand</dt>
              <dd>{formatWatts(now.demandW)}</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{formatWatts(now.supplyW)}</dd>
            </div>
            <div>
              <dt>{health.state === "blackout" ? "Shortage" : "Reserve"}</dt>
              <dd>{health.metric}</dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby={`${id}-future`}>
          <h3 id={`${id}-future`}>Future</h3>
          <p>
            {future
              ? `${future}${ahead ? ` · About ${formatForecastWatts(ahead.demandW - ahead.supplyW)} short` : ""}`
              : "No shortfall in this month’s sample"}
          </p>
          {updating && <p className="gridStatusMuted">Updating forecast…</p>}
        </section>
        <section aria-label="Supply resources">
          <p>
            {storage && storage.storedWh > 0
              ? `Storage ready: ${formatWattHours(storage.storedWh)} stored`
              : "No storage ready"}
            <br />
            {storage
              ? `${formatWatts(storage.dischargingW)} discharging`
              : "Unavailable"}
          </p>
          <p>
            {importedW === undefined
              ? "Purchased power now: Unavailable"
              : importedW > 0
                ? `Purchased power now: ${formatWatts(importedW)} total`
                : "No purchased power now"}
            {importedW !== undefined && importedW > 0 && (
              <>
                <br />
                For customers: {formatWatts(customerImportedW ?? 0)}
                {importedShare === undefined
                  ? ""
                  : ` · ${importedShare}% of supply`}
                {storageImportedW > 0 && (
                  <>
                    <br />
                    Charging storage: {formatWatts(storageImportedW)}
                  </>
                )}
              </>
            )}
            {now.entitlementImportCapacityW !== undefined && (
              <>
                <br />
                Under agreement: {formatWatts(now.entitlementImportCapacityW)}
              </>
            )}
          </p>
        </section>
        <div className="gridStatusActions">
          {forecastAllowed && onEvidence && (
            <Button
              variant="contained"
              onClick={() =>
                navigate(() =>
                  onEvidence({ card: "INSIGHTS", layer: "SUPPLY_DEMAND" }),
                )
              }
            >
              View supply forecast
            </Button>
          )}
          {!tutorial && onNavigate && (
            <Button
              variant="outlined"
              onClick={() =>
                navigate(() =>
                  onNavigate(territoryNetwork ? "FLEET" : "FACILITIES"),
                )
              }
            >
              Manage fleet
            </Button>
          )}
          {!tutorial &&
            ((territoryNetwork && onNavigate) ||
              (legacyInterties && onEvidence)) && (
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(() =>
                    territoryNetwork
                      ? onNavigate?.("AGREEMENTS")
                      : onEvidence?.("interties"),
                  )
                }
              >
                Manage agreements
              </Button>
            )}
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
      </Popover>
    </div>
  );
}
