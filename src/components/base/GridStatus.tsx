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
import { formatHour, getDateFromMinute } from "../../helpers/DateTime";
import { projectedShortfall } from "../../helpers/MissionStatus";
import { isUtilityExpansionGame } from "../../helpers/ExpansionContext";
import { utilityServiceGap } from "../../helpers/UtilityPlanning";
import { hasTerritoryNetwork } from "../../helpers/Territories";
import { getScenario } from "../../data/Scenarios";
import { setManualHelpAnchor } from "./ManualHelpPopover";
import { MONTHS } from "../../Constants";
import {
  projectionReady,
  readProjection,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

/** Subscribe to the existing deferred owner; a stale forecast is never read synchronously. */
function useSupplyRisk(game: GameType, now: TickPresentFutureType) {
  const [, landed] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => subscribeProjection(landed), []);
  const enabled = isUtilityExpansionGame(game);
  const ready = enabled && projectionReady(game);
  React.useEffect(() => {
    if (enabled && !ready) requestProjection(game, now);
  }, [enabled, ready, game, now]);
  const gap = ready
    ? utilityServiceGap(game, readProjection(game, now))
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
  const { gap, updating } = useSupplyRisk(game, now);
  const ahead = projectedShortfall(game.timeline, game.date.minute);
  const when = ahead
    ? getDateFromMinute(ahead.minute, game.startingYear)
    : undefined;
  const sameDay =
    ahead &&
    Math.floor(ahead.minute / 1440) === Math.floor(game.date.minute / 1440);
  const future = when
    ? `Short at ${sameDay ? "" : `${when.month} ${when.year}, `}${formatHour(when)}`
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
  const importedW = now.importedW;
  const importedShare =
    importedW !== undefined && now.supplyW > 0
      ? Math.round((100 * importedW) / now.supplyW)
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
        marginThreshold={16}
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
                ? `Purchased power now: ${formatWatts(importedW)}${importedShare === undefined ? "" : ` · ${importedShare}% of supply`}`
                : "No purchased power now"}
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
            <>
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(() =>
                    onNavigate(
                      hasTerritoryNetwork(game) ? "FLEET" : "FACILITIES",
                    ),
                  )
                }
              >
                Manage fleet
              </Button>
              <Button
                variant="outlined"
                onClick={() =>
                  navigate(() =>
                    onNavigate(
                      hasTerritoryNetwork(game)
                        ? "AGREEMENTS"
                        : "BUILD_INTERTIES",
                    ),
                  )
                }
              >
                Manage agreements
              </Button>
            </>
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
