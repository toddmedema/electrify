import * as React from "react";
import { useStore } from "react-redux";
import { Alert, Checkbox, Button, FormControlLabel } from "@mui/material";
import type { RootState } from "../../Store";
import { useAppDispatch } from "../../Store";
import { isStorage, type GameType, type TerritoryTileId } from "../../Types";
import { facilityLoanMonths } from "../../helpers/Financials";
import { formatWatts, formatWattHours } from "../../helpers/Format";
import { expectedMonthlyOutputShape } from "../../helpers/ExpectedOutput";
import {
  projectReview,
  projectSiteQuote,
  selectProject,
  type ProjectSelection,
  type ReadyProjectSite,
} from "../../helpers/ProjectBuild";
import {
  resilienceBuildOptions,
  resilienceSelection,
  withResilienceOptions,
} from "../../helpers/Hazards";
import { formatConnectionDuration } from "../../helpers/TerritoryConnections";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import { territoryMapLabel, territoryTileLabel } from "./TerritoryMapLayout";
import { signature } from "./DeferredProjection";
import { useBuildForecast } from "./BuildForecast";
import { useMoney } from "./CurrencyContext";
import { useTerritoryTilePurchases } from "./TerritoryTilePurchases";
import ConceptIcon from "./ConceptIcon";
import TileWorkspaceSurface from "./TileWorkspaceSurface";
import BuildFacilities from "../views/BuildFacilities";
import "./ProjectBuild.scss";

export default function ProjectBuild({
  game,
  project,
  candidate,
  compatibleSites,
  catalogue,
  onProject,
  onUpdateProject,
  onClose,
  onBusy,
}: {
  game: GameType;
  project?: ProjectSelection;
  candidate?: TerritoryTileId;
  compatibleSites: number;
  catalogue: boolean;
  onProject: (project: ProjectSelection) => void;
  /** Update options without discarding the chosen geographic site. */
  onUpdateProject?: (project: ProjectSelection) => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const { purchase, availableCash, readAvailableCash } =
    useTerritoryTilePurchases();
  const { formatMoneyConcise: money, formatPurchasePrice: price } = useMoney();
  const forecast = useBuildForecast(game);
  const [message, setMessage] = React.useState("");
  const [progress, setProgress] = React.useState("");
  const lock = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  React.useEffect(() => {
    setMessage("");
  }, [candidate, project, catalogue]);
  const pricingKey = `${signature(game)}|${game.interestRate}|${JSON.stringify(game.multiplayer?.tileOwners)}|${JSON.stringify(game.multiplayer?.landOwners)}`;
  const quote = React.useMemo(
    () =>
      project && candidate
        ? projectSiteQuote(game, project, candidate)
        : undefined,
    // The shared planning signature tracks fleet, date, rules and economics without repricing on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, project, candidate],
  );
  const ready = quote?.facility ? (quote as ReadyProjectSite) : undefined;
  const connection = ready?.connection;
  const payment = ready?.owned && {
    cash: projectReview(game, ready, false, availableCash),
    loan: projectReview(game, ready, true, availableCash),
  };
  const title = ready
    ? `${ready.facility.name} · ${formatWatts(ready.facility.peakW)}`
    : project
      ? `${project.name} · ${formatWatts(project.peakW)}`
      : "Build";
  const confirm = async (financed?: boolean) => {
    if (lock.current || !project || !candidate) return;
    const shown = payment && (financed ? payment.loan : payment.cash);
    const initial = store.getState();
    const latest = projectSiteQuote(initial.game, project, candidate);
    const details =
      financed !== undefined && latest.facility
        ? projectReview(
            initial.game,
            latest as ReadyProjectSite,
            financed,
            readAvailableCash(),
          )
        : undefined;
    if (financed === undefined) {
      if (!connection || latest.connection?.quoteKey !== connection.quoteKey) {
        setMessage(
          "Connection changed. Check the updated costs before paying.",
        );
        return;
      }
    } else if (
      !shown ||
      !details ||
      details.key !== shown.key ||
      details.remaining < 0 ||
      !latest.owned
    ) {
      setMessage("Project changed. Check the updated costs before paying.");
      return;
    }
    lock.current = true;
    onBusy(true);
    setMessage("");
    const sameRun = () => {
      const state = store.getState();
      return (
        alive.current &&
        state.ui?.evidenceRunId === initial.ui?.evidenceRunId &&
        state.game.seed === initial.game.seed &&
        state.game.scenarioId === initial.game.scenarioId
      );
    };
    try {
      if (financed === undefined && latest.connection) {
        setProgress("Connecting…");
        const result = await purchase(candidate, latest.connection.quoteKey);
        if (sameRun() && result.status !== "started")
          setMessage(result.message);
        return;
      }
      if (financed === undefined || !latest.facility || !details) return;
      setProgress("Starting construction…");
      const result = await dispatch(
        purchaseFacility(
          latest.facility,
          financed,
          latest.tile.territoryId,
          candidate,
          details.buildKey,
        ),
      );
      if (!sameRun()) return;
      if (result.status === "accepted") {
        onBusy(false);
        onClose();
      } else setMessage(result.message);
    } finally {
      lock.current = false;
      onBusy(false);
      if (alive.current) setProgress("");
    }
  };
  const facility = ready?.facility;
  const shape =
    facility && !isStorage(facility)
      ? expectedMonthlyOutputShape(facility, forecast?.timeline ?? [], {
          game,
          tileId: candidate,
        })
      : undefined;
  const output = !facility
    ? undefined
    : isStorage(facility)
      ? `Discharge ${formatWatts(facility.peakW)} · Stores ${formatWattHours(facility.peakWh)} · ${Math.round(facility.peakWh / facility.peakW)} h at full power — requires charging`
      : shape?.kind === "on-demand"
        ? `Up to ${formatWatts(facility.peakW)} · on demand`
        : shape
          ? `${formatWatts(facility.peakW * shape.mean)} average${shape.kind === "water-inflow" ? " inflow potential" : " output"}`
          : forecast
            ? "Estimate unavailable"
            : "Estimating…";
  const loanLeads =
    !!payment && payment.cash.remaining < 0 && payment.loan.remaining >= 0;
  return (
    <TileWorkspaceSurface
      id="tool-BUILD_GENERATORS"
      closeLabel="Close project"
      building={catalogue}
      title={catalogue ? "Build" : title}
      titleIcon={
        (catalogue || !project) && <ConceptIcon concept="build" decorative />
      }
      focusKey={`${catalogue}:${candidate ?? "sites"}`}
      projectCandidate={!catalogue}
      returnFocusSelector=".desktopBuildRail, #buildNav"
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      {catalogue ? (
        <BuildFacilities
          embedded
          onPickSite={(option) => onProject(selectProject(option))}
        />
      ) : (
        <div className="projectCandidateContent">
          <div className="projectCandidateScroll">
            {ready && (
              <p className="projectLocation">
                {territoryTileLabel(ready.tile)} ·{" "}
                {territoryMapLabel(ready.tile.territoryId)}
              </p>
            )}
            {!candidate && compatibleSites > 0 && (
              <p>Choose a highlighted site.</p>
            )}
            {!candidate && compatibleSites === 0 && (
              <Alert severity="info">
                No compatible connected or adjacent sites are available for this
                project. Change the technology or size, or extend your network
                with Connect.
              </Alert>
            )}
            {candidate && !ready && (
              <Alert severity="info">{quote?.reason}</Alert>
            )}
            {ready && connection && (
              <dl className="projectFacts">
                <div>
                  <dt>Connection</dt>
                  <dd>
                    {price(connection.price)} ·{" "}
                    {formatConnectionDuration(connection.buildMonths)}
                  </dd>
                </div>
                <div>
                  <dt>Estimated build cost</dt>
                  <dd>{price(ready.facility.buildCost)}</dd>
                </div>
                <div>
                  <dt>Expected output</dt>
                  <dd>{output}</dd>
                </div>
              </dl>
            )}
            {ready && payment && (
              <>
                <dl className="projectFacts">
                  <div>
                    <dt>Cash purchase</dt>
                    <dd>{price(payment.cash.required)} now</dd>
                  </div>
                  <div>
                    <dt>Loan option</dt>
                    <dd>
                      {price(payment.loan.required)} now +{" "}
                      <span className="projectMonthlyPayment">
                        {money(payment.loan.terms.monthlyPayment)}/mo
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Connection</dt>
                    <dd>Connected</dd>
                  </div>
                  <div>
                    <dt>Build cost</dt>
                    <dd>{price(ready.facility.buildCost)}</dd>
                  </div>
                  <div className="projectOutput">
                    <dt>Expected output</dt>
                    <dd>{output}</dd>
                  </div>
                  <div>
                    <dt>Estimated online</dt>
                    <dd>
                      {payment.cash.online.month} {payment.cash.online.year}
                    </dd>
                  </div>
                </dl>
                {!isStorage(ready.facility) && onUpdateProject && (
                  <div
                    className="projectBuildOptions"
                    aria-label="Project upgrades"
                  >
                    {resilienceBuildOptions(ready.facility, game).map(
                      (option) => (
                        <FormControlLabel
                          key={option.upgrade}
                          disabled={!!progress}
                          control={
                            <Checkbox
                              checked={option.selected}
                              onChange={(event) => {
                                if (lock.current || isStorage(ready.facility))
                                  return;
                                onUpdateProject(
                                  selectProject(
                                    withResilienceOptions(
                                      ready.facility,
                                      game,
                                      {
                                        ...resilienceSelection(
                                          ready.facility,
                                          game,
                                        ),
                                        [option.upgrade]: event.target.checked,
                                      },
                                    ),
                                  ),
                                );
                              }}
                            />
                          }
                          label={`${option.label} +${price(option.extraBuildCost)}`}
                        />
                      ),
                    )}
                  </div>
                )}
                <p className="projectLoanTerms">
                  {(game.interestRate * 100).toFixed(2)}% annual interest for{" "}
                  {facilityLoanMonths(ready.facility.lifespanYears) / 12}{" "}
                  years.{" "}
                </p>
                {payment.cash.remaining < 0 && (
                  <p role="status">
                    {payment.loan.remaining < 0
                      ? `${money(-payment.loan.remaining)} more cash needed for a loan.`
                      : `${money(-payment.cash.remaining)} more cash needed to pay in full.`}
                  </p>
                )}
              </>
            )}
            {message && (
              <Alert severity="info" role="status">
                {message}
              </Alert>
            )}
          </div>
          {connection && (
            <div className="projectCandidateActions">
              {progress && <span role="status">{progress}</span>}
              <Button
                variant="contained"
                disabled={!!progress || connection.price > availableCash}
                onClick={() => void confirm()}
              >
                Connect · {price(connection.price)}
              </Button>
            </div>
          )}
          {payment && (
            <div className="projectCandidateActions">
              {progress && <span role="status">{progress}</span>}
              <Button
                disabled={!!progress}
                onClick={() => {
                  if (!lock.current) onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                variant={loanLeads ? "outlined" : "contained"}
                disabled={!!progress || payment.cash.remaining < 0}
                onClick={() => void confirm(false)}
                startIcon={<ConceptIcon concept="money" fontSize="small" />}
              >
                Cash
              </Button>
              <Button
                variant={loanLeads ? "contained" : "outlined"}
                disabled={!!progress || payment.loan.remaining < 0}
                onClick={() => void confirm(true)}
                startIcon={<ConceptIcon concept="finances" fontSize="small" />}
              >
                Loan
              </Button>
            </div>
          )}
        </div>
      )}
    </TileWorkspaceSurface>
  );
}
