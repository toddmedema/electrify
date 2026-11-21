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
  onChangeProject,
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
  onChangeProject: () => void;
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
  const [partial, setPartial] = React.useState(false);
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
    setPartial(false);
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
  const payment = ready && {
    cash: projectReview(game, ready, false, availableCash),
    loan: projectReview(game, ready, true, availableCash),
  };
  const title = ready
    ? `${ready.facility.name} · ${formatWatts(ready.facility.peakW)}`
    : project
      ? `${project.name} · ${formatWatts(project.peakW)}`
      : "Plan a project";
  const confirm = async (financed: boolean) => {
    if (lock.current || !project || !candidate || !payment) return;
    const shown = financed ? payment.loan : payment.cash;
    const initial = store.getState();
    const latest = projectSiteQuote(initial.game, project, candidate);
    const details = latest.facility
      ? projectReview(
          initial.game,
          latest as ReadyProjectSite,
          financed,
          readAvailableCash(),
        )
      : undefined;
    if (!details || details.key !== shown.key) {
      setMessage("Project changed. Check the updated costs before paying.");
      return;
    }
    if (details.remaining < 0) {
      setMessage("More cash is needed before this project can start.");
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
    let connected = false;
    try {
      if (latest.connection) {
        setProgress("Connecting…");
        const result = await purchase(candidate, latest.connection.quoteKey);
        if (!sameRun()) return;
        if (result.status !== "connected") {
          setMessage(result.message);
          return;
        }
        connected = true;
      }
      if (!sameRun()) return;
      // Host ownership must already be in the dispatching store. Recheck economics after Connect.
      const owned = projectSiteQuote(store.getState().game, project, candidate);
      const ownedReview = owned.facility
        ? projectReview(
            store.getState().game,
            owned as ReadyProjectSite,
            financed,
            readAvailableCash(),
          )
        : undefined;
      const expectedCash =
        details.availableCash - (latest.connection?.price ?? 0);
      // Cash and pending reservations can subtract in a different order after settlement.
      const cashRounding =
        Number.EPSILON * Math.max(1, Math.abs(details.availableCash)) * 4;
      if (
        !owned.facility ||
        !owned.owned ||
        !ownedReview ||
        ownedReview.remaining < 0 ||
        ownedReview.buildKey !== details.buildKey ||
        (connected &&
          Math.abs(ownedReview.availableCash - expectedCash) > cashRounding)
      ) {
        setPartial(connected);
        setMessage(
          connected
            ? "Site connected. Construction did not start. Check the updated costs before paying."
            : "Project changed. Check the updated costs before paying.",
        );
        return;
      }
      setProgress("Starting construction…");
      const result = await dispatch(
        purchaseFacility(
          owned.facility,
          financed,
          owned.tile.territoryId,
          candidate,
          details.buildKey,
        ),
      );
      if (!sameRun()) return;
      if (result.status === "accepted") {
        onBusy(false);
        onClose();
      } else {
        setPartial(connected);
        setMessage(
          connected
            ? `Site connected. Construction did not start. ${result.message}`
            : result.message,
        );
      }
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
      building={catalogue}
      title={catalogue ? "Plan a project" : title}
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
            <div className="projectCandidateHeader">
              {ready && (
                <p className="projectLocation">
                  {territoryTileLabel(ready.tile)} ·{" "}
                  {territoryMapLabel(ready.tile.territoryId)}
                </p>
              )}
              <Button
                size="small"
                disabled={!!progress}
                onClick={() => {
                  if (!lock.current) onChangeProject();
                }}
              >
                Change project
              </Button>
            </div>
            {!candidate && compatibleSites > 0 && (
              <>
                <p>Choose a highlighted site.</p>
                <p className="projectSiteLegend">
                  <span>Connected · total project cost</span>
                  <span>
                    Connection required · total project and connection cost
                  </span>
                </p>
              </>
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
                    <dd>
                      {ready.owned ? "Connected" : price(ready.connectionCost)}
                    </dd>
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
                  {facilityLoanMonths(ready.facility.lifespanYears) / 12} years.{" "}
                  {ready.connectionCost > 0 && "Connection is paid in cash."}
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
              <Alert severity={partial ? "warning" : "info"} role="status">
                {message}
              </Alert>
            )}
          </div>
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
