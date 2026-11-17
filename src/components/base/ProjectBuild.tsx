import * as React from "react";
import { useStore } from "react-redux";
import {
  Alert,
  Checkbox,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
  Tab,
  Tabs,
} from "@mui/material";
import type { RootState } from "../../Store";
import { useAppDispatch } from "../../Store";
import { isStorage, type GameType, type TerritoryTileId } from "../../Types";
import { facilityLoanMonths } from "../../helpers/Financials";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts, formatWattHours } from "../../helpers/Format";
import { sliderTickToW } from "../../helpers/BuildSizing";
import { expectedMonthlyOutputShape } from "../../helpers/ExpectedOutput";
import {
  projectCatalogue,
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
import { territoryBuildTileName } from "./TerritoryBuildDestination";
import { territoryMapLabel } from "./TerritoryMapLayout";
import { signature } from "./DeferredProjection";
import { useBuildForecast } from "./BuildForecast";
import { useMoney } from "./CurrencyContext";
import { useToolState } from "./GameToolMemory";
import { useTerritoryTilePurchases } from "./TerritoryTilePurchases";
import TileWorkspaceSurface from "./TileWorkspaceSurface";
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
  const { purchase, availableCash, pendingCost } = useTerritoryTilePurchases();
  const { formatMoneyConcise: money } = useMoney();
  const forecast = useBuildForecast(game);
  const [storage, setStorage] = useToolState("project.storage", false);
  const [generatorSize, setGeneratorSize] = useToolState(
    "project.generatorSize",
    10,
  );
  const [storageSize, setStorageSize] = useToolState("project.storageSize", 18);
  const [financed, setFinanced] = React.useState(false);
  const [reviewKey, setReviewKey] = React.useState<string>();
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
    setReviewKey(undefined);
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
  const review = ready
    ? projectReview(game, ready, financed, availableCash)
    : undefined;
  const size = storage ? storageSize : generatorSize;
  const options = React.useMemo(
    () => projectCatalogue(game, sliderTickToW(size), storage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, size, storage],
  );
  const title = ready
    ? `${ready.facility.name} · ${formatWatts(ready.facility.peakW)}`
    : project
      ? `${project.name} · ${formatWatts(project.peakW)}`
      : "Plan a project";
  const reviewing = reviewKey !== undefined;
  const change = () => {
    if (!lock.current) {
      setReviewKey(undefined);
      onChangeProject();
    }
  };
  const beginReview = () => {
    if (!review || lock.current) return;
    setMessage("");
    setReviewKey(review.key);
  };
  const confirm = async () => {
    if (lock.current || !project || !candidate || !reviewKey) return;
    const initial = store.getState();
    const latest = projectSiteQuote(initial.game, project, candidate);
    const details = latest.facility
      ? projectReview(
          initial.game,
          latest as ReadyProjectSite,
          financed,
          (currentTick(initial.game)?.cash ?? 0) - pendingCost,
        )
      : undefined;
    if (!details || details.key !== reviewKey) {
      setReviewKey(undefined);
      setMessage("Project changed. Review the updated details.");
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
          setReviewKey(undefined);
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
          )
        : undefined;
      if (
        !owned.facility ||
        !owned.owned ||
        !ownedReview ||
        ownedReview.remaining < 0 ||
        JSON.stringify(owned.facility) !== JSON.stringify(latest.facility) ||
        ownedReview.online.month !== details.online.month ||
        ownedReview.online.year !== details.online.year ||
        store.getState().game.interestRate !== initial.game.interestRate
      ) {
        setPartial(connected);
        setReviewKey(undefined);
        setMessage(
          connected
            ? "Site connected. Construction did not start. Review the updated project."
            : "Project changed. Review the updated details.",
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
        ),
      );
      if (!sameRun()) return;
      if (result.status === "accepted") {
        onBusy(false);
        onClose();
      } else {
        setPartial(connected);
        setReviewKey(undefined);
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
  return (
    <TileWorkspaceSurface
      title={
        catalogue
          ? "Plan a project"
          : reviewing
            ? `${ready?.owned ? "Build" : "Connect and build"} ${project?.name}?`
            : title
      }
      focusKey={`${catalogue}:${candidate ?? "sites"}:${reviewing}`}
      projectCandidate={!catalogue}
      returnFocusSelector=".territoryMapBuildToggle"
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      {catalogue ? (
        <div className="projectCatalogue">
          <Tabs
            value={storage ? "storage" : "generators"}
            variant="fullWidth"
            aria-label="Project type"
            onChange={(_event, value) => {
              if (!lock.current) setStorage(value === "storage");
            }}
          >
            <Tab value="generators" label="Generators" disabled={!!progress} />
            <Tab value="storage" label="Storage" disabled={!!progress} />
          </Tabs>
          <label className="projectSize">
            {storage ? "Storage capacity" : "Generator capacity"}
            <strong>
              {storage
                ? formatWattHours(sliderTickToW(size))
                : formatWatts(sliderTickToW(size))}
            </strong>
            <input
              aria-label={storage ? "Storage capacity" : "Generator capacity"}
              type="range"
              min={storage ? 4 : 0}
              max={storage ? 37 : 34}
              step={1}
              value={size}
              disabled={!!progress}
              onChange={(event) => {
                if (!lock.current)
                  (storage ? setStorageSize : setGeneratorSize)(
                    Number(event.target.value),
                  );
              }}
            />
          </label>
          <ul className="projectOptions">
            {options.map((option) => {
              const maxSize = isStorage(option)
                ? option.maxPeakWh
                : option.maxPeakW;
              const requestedSize = isStorage(option)
                ? option.peakWh
                : option.peakW;
              const tooLarge = maxSize > 0 && requestedSize > maxSize;
              const maxLabel = isStorage(option)
                ? formatWattHours(maxSize)
                : formatWatts(maxSize);
              return (
                <li key={option.name}>
                  <div>
                    <strong>{option.name}</strong>
                    <span>{option.description}</span>
                    <small>
                      {isStorage(option)
                        ? formatWattHours(option.peakWh)
                        : formatWatts(option.peakW)}{" "}
                      · {money(option.buildCost)} before site costs
                    </small>
                    {tooLarge && (
                      <small>Maximum available size: {maxLabel}</small>
                    )}
                    {maxSize <= 0 && (
                      <small>No suitable sites currently available.</small>
                    )}
                  </div>
                  <Button
                    variant="outlined"
                    disabled={!!progress}
                    aria-label={
                      tooLarge
                        ? `Choose ${maxLabel} sites for ${option.name}`
                        : `Choose sites for ${option.name}`
                    }
                    onClick={() => {
                      if (lock.current) return;
                      const selected = tooLarge
                        ? projectCatalogue(
                            game,
                            maxSize,
                            isStorage(option),
                          ).find(({ name }) => name === option.name)
                        : option;
                      if (selected) onProject(selectProject(selected));
                    }}
                  >
                    {tooLarge ? `Use ${maxLabel}` : "Choose sites"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="projectCandidateContent">
          <div className="projectCandidateScroll">
            <div className="projectCandidateHeader">
              {ready && (
                <p className="projectLocation">
                  {reviewing && <strong>{title} · </strong>}
                  {territoryBuildTileName(ready.tile.id, game)} ·{" "}
                  {territoryMapLabel(ready.tile.territoryId)}
                </p>
              )}
              <Button size="small" disabled={!!progress} onClick={change}>
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
            {ready && review && (
              <>
                <dl className="projectFacts">
                  <div>
                    <dt>Connection cost</dt>
                    <dd>
                      {ready.owned
                        ? `Already connected · ${money(0)}`
                        : money(ready.connectionCost)}
                    </dd>
                  </div>
                  <div>
                    <dt>Project cost</dt>
                    <dd>{money(ready.facility.buildCost)}</dd>
                  </div>
                  <div>
                    <dt>Cash required now</dt>
                    <dd>{money(review.required)}</dd>
                  </div>
                  <div>
                    <dt>Cash remaining</dt>
                    <dd>{money(review.remaining)}</dd>
                  </div>
                  <div className="projectOutput">
                    <dt>Expected output</dt>
                    <dd>{output}</dd>
                  </div>
                  <div>
                    <dt>Estimated online</dt>
                    <dd>
                      {review.online.month} {review.online.year}
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
                          label={`${option.label} +${money(option.extraBuildCost)}`}
                        />
                      ),
                    )}
                  </div>
                )}
                {review.remaining < 0 && (
                  <p role="status">
                    {money(-review.remaining)} more cash needed
                    {!reviewing && !financed
                      ? "; review financing options."
                      : "."}
                  </p>
                )}
                {reviewing && (
                  <>
                    <RadioGroup
                      aria-label="Project payment"
                      value={financed ? "loan" : "cash"}
                      onChange={(_event, value) => {
                        const loan = value === "loan";
                        setFinanced(loan);
                        setReviewKey(
                          projectReview(game, ready, loan, availableCash).key,
                        );
                      }}
                    >
                      <FormControlLabel
                        disabled={!!progress}
                        value="cash"
                        control={<Radio />}
                        label={`Cash · ${money(ready.facility.buildCost)} project payment`}
                      />
                      <FormControlLabel
                        disabled={!!progress}
                        value="loan"
                        control={<Radio />}
                        label="Loan · connection paid in cash"
                      />
                    </RadioGroup>
                    {financed && (
                      <p className="projectLoanTerms">
                        Down payment {money(review.terms.downpayment)} · Borrow{" "}
                        {money(review.terms.loanAmount)} ·{" "}
                        {money(review.terms.monthlyPayment)}/month ·{" "}
                        {(game.interestRate * 100).toFixed(2)}% annual interest
                        · {facilityLoanMonths(ready.facility.lifespanYears)}{" "}
                        months
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            {message && (
              <Alert severity={partial ? "warning" : "info"} role="status">
                {message}
              </Alert>
            )}
          </div>
          {ready && (
            <div className="projectCandidateActions">
              {reviewing ? (
                <>
                  <Button
                    disabled={!!progress}
                    onClick={() => setReviewKey(undefined)}
                  >
                    Back to sites
                  </Button>
                  <Button
                    variant="contained"
                    disabled={!!progress || !review || review.remaining < 0}
                    onClick={() => void confirm()}
                  >
                    {progress ||
                      (ready.owned ? "Build project" : "Connect & build")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  disabled={!!progress}
                  onClick={beginReview}
                >
                  {progress || (partial ? "Review build" : "Review project")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </TileWorkspaceSurface>
  );
}
