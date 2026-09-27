import * as React from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardHeader,
  Dialog,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Radio,
  RadioGroup,
  Skeleton,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import CloseIcon from "@mui/icons-material/Close";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import EnergySavingsLeafIcon from "@mui/icons-material/EnergySavingsLeaf";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import ScheduleIcon from "@mui/icons-material/Schedule";
import FactoryIcon from "@mui/icons-material/Factory";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import { useAppDispatch, useAppSelector } from "../../Store";
import {
  cancelPolicy,
  chooseScenarioResponse,
  closePolicyDecision,
  openPolicyDecision,
  schedulePolicy,
} from "../../reducers/GameActions";
import { setSpeed } from "../../reducers/Game";
import {
  GameType,
  PolicyChangeType,
  PolicyId,
  PolicyProgramType,
  PolicyTier,
} from "../../Types";
import { POLICIES, POLICY_IDS, POLICY_TIERS } from "../../data/Policies";
import {
  BuildoutPolicyId,
  buildoutComplete,
  buildoutCompletionMonth,
  buildoutMonths,
  buildoutMonthsDone,
  emptyPolicies,
  policyAvailable,
  policyBudget,
  policyTotalCost,
  programCustomers,
  isOperatingPolicy,
} from "../../helpers/Policies";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../../helpers/DateTime";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { getScenario } from "../../data/Scenarios";
import { createPolicyPreviewWorker } from "../../helpers/PolicyPreviewClient";
import {
  PolicyPreviewResult,
  previewPolicy,
} from "../../helpers/PolicyPreview";
import {
  previewWildfire,
  WildfirePreviewResult,
  wildfirePreviewMonth,
} from "../../helpers/WildfirePreview";
import {
  wildfirePreparedness,
  wildfireSeasonOdds,
  WildfirePreparednessType,
} from "../../helpers/Wildfire";
import { isDesktopScreen } from "../../Globals";
import { buildSpeedOptions } from "../base/GameAppBar";
import PolicyDemandChart, {
  PolicyDemandChartPlaceholder,
} from "../base/PolicyDemandChart";
import ManualLink from "../base/ManualLink";
import { MANUAL_ENTRY } from "../base/ManualEntries";
import {
  policyWindowLabel,
  suggestedPolicyStartHour,
} from "../../helpers/PolicyWindow";
// The estimate's closing note wraps to two lines at dialog width. Reserving both whether or not
// it appears keeps the dialog from changing height when an estimate arrives.
const NOTE_SLOT = { minHeight: "2lh" };

// A fire season can open before the run did, so months may be negative.
const labelMonth = (game: GameType, month: number) => {
  const d = getDateFromMinute(
    (((month % 12) + 12) % 12) * MINUTES_PER_MONTH,
    game.startingYear + Math.floor(month / 12),
  );
  return `${d.month} ${d.year}`;
};

const PROGRAM_ICONS: Record<PolicyId, typeof ScheduleIcon> = {
  efficiency: EnergySavingsLeafIcon,
  solar: SolarPowerIcon,
  timeOfUse: ScheduleIcon,
  curtailment: FactoryIcon,
};
const BUILDOUT_IDS: BuildoutPolicyId[] = ["efficiency", "solar"];

const BUILDOUT_SHORT_NAME: Record<BuildoutPolicyId, string> = {
  efficiency: "Efficiency",
  solar: "Rooftop solar",
};

/** Build-out programs read as projects; operating offers are simply on or off. */
function programStatus(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string {
  if (isOperatingPolicy(id)) return program.tier;
  const buildout = id as BuildoutPolicyId;
  if (buildoutComplete(program.adoption))
    return program.completedMonth === undefined
      ? "Completed"
      : `Completed ${labelMonth(game, program.completedMonth)}`;
  if (program.tier === "On")
    return `In progress · month ${buildoutMonthsDone(buildout, program.adoption)} of ${buildoutMonths(buildout)}`;
  if (program.adoption > 0)
    return `Paused · month ${buildoutMonthsDone(buildout, program.adoption)} of ${buildoutMonths(buildout)}`;
  return "Not started";
}

function pendingLabel(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string {
  const pending = program.pending!;
  const when = labelMonth(game, pending.month);
  if (isOperatingPolicy(id))
    return pending.tier === "Off"
      ? `Turns off ${when}`
      : `${program.tier === "On" ? "Window moves" : "Turns on"} ${when} · ${policyWindowLabel(pending.startHour ?? program.startHour ?? 17)}`;
  if (pending.tier === "Off") return `Pauses ${when}`;
  return program.adoption > 0 ? `Resumes ${when}` : `Starts ${when}`;
}

/** The list's status line: the current state, then any change scheduled for next month. */
function choiceStatus(
  game: GameType,
  id: PolicyId,
  program: PolicyProgramType,
): string {
  const status = programStatus(game, id, program);
  if (!program.pending) return status;
  const pending = pendingLabel(game, id, program);
  return `${status} · ${pending[0].toLowerCase()}${pending.slice(1)}`;
}

function buildoutImpact(game: GameType, id: BuildoutPolicyId): string {
  return id === "solar"
    ? `${formatWatts(POLICIES.solar.cap * programCustomers(game))} of rooftop panels`
    : `Home and business use ${Math.round(POLICIES.efficiency.applianceSaving * 100)}% lower, heating and cooling ${Math.round(POLICIES.efficiency.weatherSaving * 100)}% lower`;
}

/** Project facts and progress for a finite rebate build-out. */
function BuildoutSummary({
  game,
  id,
  program,
  effective,
  end,
}: {
  game: GameType;
  id: BuildoutPolicyId;
  program: PolicyProgramType;
  effective: number;
  end: number;
}) {
  const months = buildoutMonths(id);
  const complete = buildoutComplete(program.adoption);
  const done = buildoutMonthsDone(id, program.adoption);
  const total = complete
    ? program.spent
    : program.spent +
      policyTotalCost(game, id, effective) * (1 - program.adoption);
  const finish = buildoutCompletionMonth(id, program.adoption, effective);
  // The finish row follows the plan: a scheduled pause has no finish month to promise.
  const planned = program.pending?.tier ?? program.tier;
  const finishLabel =
    planned === "On"
      ? "Finishes"
      : program.tier === "On"
        ? undefined
        : program.adoption > 0
          ? "If resumed now"
          : "If started now";
  const facts: [string, string][] = complete
    ? [
        ["Result", buildoutImpact(game, id)],
        ["Total cost", formatMoneyConcise(program.spent)],
      ]
    : [
        ["Total cost", `About ${formatMoneyConcise(total)}`],
        [
          "While active",
          `${formatMoneyConcise(policyBudget(game, id, "On", effective))}/month`,
        ],
        ["At completion", buildoutImpact(game, id)],
      ];
  // Progress already says how far a started project has to go.
  if (!complete && program.adoption === 0)
    facts.unshift(["Duration", `${months} months of installations`]);
  if (!complete && finishLabel)
    facts.push([
      finishLabel,
      finish < end ? labelMonth(game, finish) : "After this run ends",
    ]);
  const progress = complete
    ? programStatus(game, id, program)
    : `${program.tier === "On" ? "Month" : "Paused after month"} ${done} of ${months} · ${formatMoneyConcise(program.spent)} spent`;
  return (
    <Box className="customerProgramProject" sx={{ display: "grid", gap: 1.5 }}>
      {program.adoption > 0 && (
        <Box sx={{ display: "grid", gap: 1 }}>
          <LinearProgress
            variant="determinate"
            value={Math.round(program.adoption * 100)}
            aria-label={`${POLICIES[id].name} build-out progress`}
            aria-valuetext={progress}
            color={complete ? "success" : "primary"}
            sx={{ height: 8, borderRadius: 1 }}
          />
          <Typography variant="body2">{progress}</Typography>
        </Box>
      )}
      <Box component="dl" className="customerProgramFacts">
        {facts.map(([term, value]) => (
          <React.Fragment key={term}>
            <Typography component="dt" variant="body2">
              {term}
            </Typography>
            <Typography component="dd" variant="body2">
              {value}
            </Typography>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The game the estimates are computed against. While paused that is simply the live game; while
 * the clock runs it moves on once a month, or when a program, story answer or fleet changes, so
 * an estimate can settle instead of restarting on every tick.
 */
function useEstimateSnapshot(game: GameType): GameType {
  const snapshot = React.useRef(game);
  const previous = snapshot.current;
  if (
    previous !== game &&
    (game.speed === "PAUSED" ||
      game.date.monthsElapsed !== previous.date.monthsElapsed ||
      game.policies !== previous.policies ||
      game.worldEvents.occurrences !== previous.worldEvents.occurrences ||
      game.facilities.length !== previous.facilities.length)
  )
    snapshot.current = game;
  return snapshot.current;
}

interface EstimateRequest<T> {
  key: string;
  message: { game: GameType; month: number; change?: PolicyChangeType };
  estimate: () => T;
}

/**
 * Runs one estimate in the preview worker. A result only counts for the request and snapshot it
 * answers, so a stale reply can never enable an action.
 */
function useEstimate<T>(
  request: EstimateRequest<T> | undefined,
  snapshot: GameType,
): { result?: T; error?: string } {
  const [preview, setPreview] = React.useState<{
    key: string;
    snapshot: GameType;
    result?: T;
    error?: string;
  }>();
  const latest = React.useRef(request);
  latest.current = request;
  const key = request?.key;
  React.useEffect(() => {
    const current = latest.current;
    if (!key || !current) return;
    let worker: Worker | undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        worker = createPolicyPreviewWorker();
        // The worker reloads its data over the network, which fails offline. The page already
        // has that data loaded, so fall back to estimating here.
        const estimateHere = () => {
          if (cancelled) return;
          try {
            setPreview({ key, snapshot, result: current.estimate() });
          } catch (_error) {
            setPreview({
              key,
              snapshot,
              error:
                "Could not estimate this change. Reopen the program to retry.",
            });
          }
        };
        worker.onmessage = (event) => {
          if (event.data?.error) estimateHere();
          else if (!cancelled) setPreview({ key, snapshot, ...event.data });
        };
        worker.onerror = (event: ErrorEvent) => {
          // An unhandled worker error is re-raised on the window. The preview falls back to
          // the page itself, so it must not also be reported as an uncaught runtime error.
          event.preventDefault();
          estimateHere();
        };
        worker.postMessage(current.message);
      } catch (_error) {
        setPreview({
          key,
          snapshot,
          error: "Could not start the preview. Reopen the program to retry.",
        });
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [key, snapshot]);
  const settled =
    !!key && preview?.key === key && preview.snapshot === snapshot;
  return settled ? { result: preview.result, error: preview.error } : {};
}

/** Keep the standing program's status and yearly budget visible in the list. */
function preparednessStatus(preparedness: WildfirePreparednessType): string {
  return `${preparedness.active ? "On" : "Off"} · ${percent(preparedness.effectiveness)} effective · ${formatMoneyConcise(preparedness.annualCost)}/yr`;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Season facts and a simulated typical wildfire, met with and without funded crews. */
function WildfireDetails({
  game,
  preparedness,
  month,
  result,
  error,
}: {
  game: GameType;
  preparedness: WildfirePreparednessType;
  month?: number;
  result?: WildfirePreviewResult;
  error?: string;
}) {
  const { season, effectiveness, remainingMonths, active } = preparedness;
  const progress = active
    ? effectiveness >= 1
      ? "Fully effective"
      : `Ramping up · ${Math.ceil(remainingMonths)} months to full effectiveness`
    : effectiveness > 0
      ? `Fading · ${Math.ceil(remainingMonths)} months of protection remaining`
      : "No protection";
  const offLabel = active ? "Stop now" : "Keep off";
  const onLabel = active ? "Keep on" : "Start now";
  const facts: [string, string][] = [
    ["Status", preparedness.active ? "On · stays on until turned off" : "Off"],
    ["Annual budget", `${formatMoneyConcise(preparedness.annualCost)}/yr`],
    [
      "Billing",
      active
        ? `${formatMoneyConcise(preparedness.annualCost / 12)}/month · no upfront payment`
        : "No charges while off · no upfront payment",
    ],
    [
      "At full effectiveness",
      "50% fewer disconnections and generator output losses",
    ],
    ["Ramp-up / decay", "12 months each · linear"],
    [
      "Next wildfire season",
      `${labelMonth(game, season.startMonth)} to ${labelMonth(game, season.endMonth - 1)}`,
    ],
  ];
  const standard = result?.standardIncident;
  const prepared = result?.preparedIncident;
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Typography>
        Crews, inspections and vegetation clearing reduce wildfire
        disconnections and generator losses by up to 50%. Benefits build
        linearly over 12 months. Turning off stops charges now and fades
        remaining protection over 12 months; restarting ramps from the current
        level. Preparedness does not prevent fires or reduce restoration costs.
        Existing fires keep their initial response.
      </Typography>
      <Box
        className="customerProgramProject"
        sx={{ display: "grid", gap: 1.5 }}
      >
        <Typography variant="subtitle2">
          {percent(effectiveness)} effective
        </Typography>
        <LinearProgress
          variant="determinate"
          value={effectiveness * 100}
          aria-label="Wildfire preparedness effectiveness"
          aria-valuetext={`${percent(effectiveness)} effective · ${progress}`}
          color={effectiveness >= 1 ? "success" : "primary"}
          sx={{ height: 8, borderRadius: 1 }}
        />
        <Typography variant="body2">{progress}</Typography>
      </Box>
      <Typography>{wildfireSeasonOdds(preparedness.profile)}</Typography>
      <Box component="dl" className="customerProgramFacts">
        {facts.map(([term, value]) => (
          <React.Fragment key={term}>
            <Typography component="dt" variant="body2">
              {term}
            </Typography>
            <Typography component="dd" variant="body2">
              {value}
            </Typography>
          </React.Fragment>
        ))}
      </Box>
      {month === undefined && (
        <Typography variant="body2" color="textSecondary">
          The next wildfire season starts after this run ends. The program can
          still protect against new fires before then.
        </Typography>
      )}
      {month !== undefined && (
        <>
          <Box>
            <Typography component="h3" variant="subtitle1">
              Next wildfire season · simulated fire in {labelMonth(game, month)}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              A typical fire in the next season's highest-risk month. It
              illustrates the program's effects, not whether or when a real fire
              will start.
            </Typography>
          </Box>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : !result || !standard || !prepared ? (
            <>
              <Typography variant="body2">
                {offLabel} ━ · {onLabel} ┄
              </Typography>
              <PolicyDemandChartPlaceholder />
              <Box aria-hidden>
                {Array.from({ length: 4 }, (_, i) => (
                  <Typography key={i}>
                    <Skeleton width={i % 2 ? "60%" : "80%"} />
                  </Typography>
                ))}
              </Box>
            </>
          ) : (
            <>
              <Typography variant="body2">
                {offLabel} ━ · {onLabel} ┄
              </Typography>
              <PolicyDemandChart
                current={result.standardDemandW}
                changed={result.preparedDemandW}
                labels={[offLabel, onLabel]}
                ariaLabel={`Customer demand still connected during a simulated wildfire: ${offLabel} and ${onLabel}, over a representative day`}
              />
              <Box role="status">
                <Typography>
                  Effectiveness at this fire: {offLabel}{" "}
                  {percent(result.standardEffectiveness)} → {onLabel}{" "}
                  {percent(result.preparedEffectiveness)}
                </Typography>
                <Typography>
                  Customer load disconnected:{" "}
                  {percent(standard.disconnectedDemand)} →{" "}
                  {percent(prepared.disconnectedDemand)}
                </Typography>
                {standard.selectedFacilityNames.length > 0 && (
                  <Typography>
                    {standard.selectedFacilityNames.join(", ")} limited to{" "}
                    {percent(standard.outputMultiplier)} →{" "}
                    {percent(prepared.outputMultiplier)} output
                  </Typography>
                )}
                <Typography>
                  Electricity supplied:{" "}
                  {formatWattHours(result.standard.supplyWh)} →{" "}
                  {formatWattHours(result.prepared.supplyWh)} in{" "}
                  {labelMonth(game, month)}, against{" "}
                  {formatWattHours(result.noFire.supplyWh)} with no fire
                </Typography>
                {standard.restorationCostPerMonth > 0 && (
                  <Typography>
                    Restoration:{" "}
                    {formatMoneyConcise(standard.restorationCostPerMonth)}{" "}
                    either way
                  </Typography>
                )}
                <Typography>
                  Utility cash if this fire strikes:{" "}
                  {formatMoneyConcise(result.cashBenefit)} better with
                  preparedness, before the{" "}
                  {formatMoneyConcise(preparedness.annualCost)}/yr program cost
                </Typography>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}

type Selection = PolicyId | "wildfire";

function ProgramsScreen({
  onClose,
  onViewDemand,
}: {
  onClose: () => void;
  onViewDemand: () => void;
}) {
  const game = useAppSelector((s) => s.game);
  const dispatch = useAppDispatch();
  const manualOpen = useAppSelector((s) => !!s.ui.manualHelpEntry);
  const token = React.useId();
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !manualOpen) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose, manualOpen]);
  const [selected, setSelected] = React.useState<Selection>();
  const [tier, setTier] = React.useState<PolicyTier>("Off");
  const [startHour, setStartHour] = React.useState(17);
  React.useEffect(() => {
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token]);
  const snapshot = useEstimateSnapshot(game);
  const policiesOn = policyAvailable(game);
  const preparedness = wildfirePreparedness(game);
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash ?? 0;
  const effective = game.date.monthsElapsed + 1;
  const end =
    getScenario(game.scenarioId, game.customScenario)?.durationMonths ?? 0;
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  const policy = selected && selected !== "wildfire" ? selected : undefined;
  const current = policy ? programs[policy] : undefined;
  const buildout =
    policy && !isOperatingPolicy(policy)
      ? (policy as BuildoutPolicyId)
      : undefined;
  // The estimate always shows the end of the program rather than its first month. For a
  // build-out that is its unpaused completion from next month (when a start or resume would
  // finish, or when a pause cuts off what would otherwise have finished then); an operating
  // offer has no end, so its first effective month. Either way it is capped at the run's last
  // month.
  const completion = buildout
    ? buildoutCompletionMonth(buildout, current!.adoption, effective)
    : effective;
  const month = Math.max(effective, Math.min(completion, end - 1));
  const policyEstimate = useEstimate<PolicyPreviewResult>(
    policy &&
      effective < end &&
      // Undoing a scheduled build-out change needs no estimate.
      !(buildout && (buildoutComplete(current!.adoption) || current!.pending))
      ? (() => {
          const change = {
            id: policy,
            tier,
            month: effective,
            ...(isOperatingPolicy(policy) ? { startHour } : {}),
          };
          return {
            key: `${policy}/${tier}/${startHour}/${month}/${snapshot.date.minute}`,
            message: { game: snapshot, change, month },
            estimate: () => previewPolicy(snapshot, change, month),
          };
        })()
      : undefined,
    snapshot,
  );
  const fireMonth =
    selected === "wildfire" ? wildfirePreviewMonth(snapshot) : undefined;
  const wildfireEstimate = useEstimate<WildfirePreviewResult>(
    fireMonth === undefined
      ? undefined
      : {
          key: `wildfire/${fireMonth}/${snapshot.date.minute}`,
          message: { game: snapshot, month: fireMonth },
          estimate: () => previewWildfire(snapshot, fireMonth),
        },
    snapshot,
  );
  const operating = policy ? isOperatingPolicy(policy) : false;
  const complete = !!buildout && buildoutComplete(current!.adoption);
  const cancelling = !!buildout && !!current!.pending;
  const planned = current?.pending?.tier ?? current?.tier ?? "Off";
  const { result, error } = policyEstimate;
  const unchanged =
    tier === (current?.pending?.tier ?? current?.tier ?? "Off") &&
    (!operating ||
      tier === "Off" ||
      startHour === (current?.pending?.startHour ?? current?.startHour ?? 17));
  const finished = (id: PolicyId) =>
    !isOperatingPolicy(id) && buildoutComplete(programs[id].adoption);
  const open = (id: PolicyId) => {
    const program = programs[id];
    setSelected(id);
    // Build-outs offer one decision: the opposite of the plan, or undoing a scheduled change.
    setTier(
      isOperatingPolicy(id)
        ? (program.pending?.tier ?? program.tier)
        : program.pending
          ? program.tier
          : program.tier === "On"
            ? "Off"
            : "On",
    );
    setStartHour(
      program.pending?.startHour ??
        program.startHour ??
        (program.tier !== "Off" ? 17 : suggestedPolicyStartHour(game)),
    );
  };
  // Rows share the scenario pick list's card, so both catalogs scan the same way.
  const row = ({
    id,
    name,
    status,
    description,
    Icon,
    done,
    active,
    onOpen,
  }: {
    id: string;
    name: string;
    status: string;
    description?: string;
    Icon: typeof ScheduleIcon;
    done?: boolean;
    active?: boolean;
    onOpen: () => void;
  }) => (
    <Card
      key={id}
      className="build-list-item missionItem customerProgramItem"
      data-completed={done || undefined}
      data-active={active || undefined}
    >
      <CardActionArea
        aria-label={`${name} · ${status}`}
        aria-describedby={description ? `program-description-${id}` : undefined}
        onClick={onOpen}
      >
        <CardHeader
          avatar={
            <Avatar className="customerProgramIcon">
              <Icon aria-hidden />
            </Avatar>
          }
          title={
            <span className="customerProgramTitle">
              <span>{name}</span>
              <span className="customerProgramStatus">{status}</span>
            </span>
          }
          subheader={
            description && (
              <span id={`program-description-${id}`}>{description}</span>
            )
          }
          action={<ArrowRightIcon color="primary" aria-hidden />}
        />
      </CardActionArea>
    </Card>
  );
  const choice = (id: PolicyId) => {
    const done = finished(id);
    return row({
      id,
      name: POLICIES[id].name,
      status: choiceStatus(game, id, programs[id]),
      description: done ? undefined : POLICIES[id].description,
      Icon: PROGRAM_ICONS[id],
      done,
      active: !done && (programs[id].tier === "On" || !!programs[id].pending),
      onOpen: () => open(id),
    });
  };
  const section = (title: string, rows: React.ReactNode[]) =>
    rows.length > 0 && (
      <Box
        component="section"
        aria-label={title}
        className="customerProgramSection"
      >
        <Typography component="h3" variant="subtitle2">
          {title}
        </Typography>
        {rows}
      </Box>
    );
  const peakBefore = result ? Math.max(...result.current) : 0;
  const peakAfter = result ? Math.max(...result.changed) : 0;
  const canChangePreparedness = !!preparedness && !game.replayPlayback;
  const title = selected
    ? selected === "wildfire"
      ? "Wildfire preparedness"
      : POLICIES[selected].name
    : undefined;
  return (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      aria-labelledby="program-title"
      data-customer-programs="true"
      className="customerProgramsScreen"
    >
      <header className="constructionHeader">
        <Toolbar className="constructionTitleBar" disableGutters>
          <IconButton
            color="primary"
            onClick={onClose}
            aria-label="Close customer programs"
            size="large"
          >
            <CloseIcon />
          </IconButton>
          <Typography
            variant="h6"
            component="h1"
            id="program-title"
            className="constructionTitle"
          >
            <span className="iconLabel">
              <GroupsIcon fontSize="small" aria-hidden />
              {/* Phones abbreviate the title so it still shares a line with close */}
              <span className="programsTitleLong">Customer programs</span>
              <span className="programsTitleShort">Programs</span>
            </span>
            <ManualLink entry={MANUAL_ENTRY.CUSTOMER_PROGRAMS} />
            <span
              className="weak constructionCash"
              aria-label={`Available cash ${formatMoneyStable(cash)}`}
            >
              {formatMoneyStable(cash)} cash
            </span>
          </Typography>
          {/* Like the build screen, the programs screen covers the game bar, so the speed
              control lives here. The clock opened paused; another speed is kept on close */}
          {game.inGame && (
            <div className="constructionSpeed">
              {buildSpeedOptions({
                speed: game.speed,
                onSpeedChange: (speed) => dispatch(setSpeed(speed)),
                desktop: isDesktopScreen(),
              })}
            </div>
          )}
        </Toolbar>
      </header>
      <div
        className="customerProgramsBody"
        role="region"
        aria-label={title ?? "Programs"}
      >
        <div
          className="programsMobileCash weak"
          aria-label={`Available cash ${formatMoneyStable(cash)}`}
        >
          {formatMoneyStable(cash)} cash
          <ManualLink entry={MANUAL_ENTRY.CUSTOMER_PROGRAMS} />
        </div>
        {!selected ? (
          <Box className="customerProgramList">
            <Typography variant="body2" color="textSecondary">
              {preparedness
                ? "Wildfire preparedness billing changes now; benefits ramp up or fade over 12 months. Other programs start next month."
                : "Changes start next month."}
            </Typography>
            {policiesOn &&
              section(
                "Rebate projects",
                BUILDOUT_IDS.filter((id) => !finished(id)).map(choice),
              )}
            {policiesOn &&
              section(
                "Rates and contracts",
                POLICY_IDS.filter(isOperatingPolicy).map(choice),
              )}
            {preparedness &&
              section("Hazard readiness", [
                row({
                  id: "wildfire",
                  name: "Wildfire preparedness",
                  status: preparednessStatus(preparedness),
                  description:
                    "Ongoing protection with a 12-month ramp-up and decay. At full effectiveness, halves disconnections and generator losses. Billed monthly until turned off.",
                  Icon: LocalFireDepartmentIcon,
                  active: preparedness.active,
                  onOpen: () => setSelected("wildfire"),
                }),
              ])}
            {policiesOn &&
              section("Completed", POLICY_IDS.filter(finished).map(choice))}
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography component="h2" variant="h6">
              {title}
            </Typography>
            {selected === "wildfire" ? (
              preparedness && (
                <WildfireDetails
                  game={game}
                  preparedness={preparedness}
                  month={fireMonth}
                  result={wildfireEstimate.result}
                  error={wildfireEstimate.error}
                />
              )
            ) : (
              <>
                <Typography>
                  {complete
                    ? `This one-time project is finished. Installed ${selected === "solar" ? "rooftop panels keep generating" : "upgrades keep saving energy"} with no further cost.`
                    : POLICIES[selected].description}
                </Typography>
                {!complete && (
                  <details className="customerProgramHowItWorks">
                    <summary>How it works</summary>
                    <Typography sx={{ mt: 1 }}>
                      {POLICIES[selected].mechanism}
                    </Typography>
                  </details>
                )}
                {current!.pending && (
                  // A standing notice, not an interruption: it is already true when the card opens.
                  <Alert severity="info" role="status">
                    {pendingLabel(game, selected, current!)}
                  </Alert>
                )}
                {buildout ? (
                  <BuildoutSummary
                    game={game}
                    id={buildout}
                    program={current!}
                    effective={effective}
                    end={end}
                  />
                ) : (
                  <>
                    <RadioGroup
                      row
                      aria-label="Program status"
                      value={tier}
                      onChange={(e) => setTier(e.target.value as PolicyTier)}
                    >
                      {POLICY_TIERS.map((choice) => (
                        <FormControlLabel
                          key={choice}
                          value={choice}
                          control={<Radio />}
                          sx={{ minHeight: 44, m: 0, flex: 1 }}
                          label={choice}
                        />
                      ))}
                    </RadioGroup>
                    {tier !== "Off" && (
                      <TextField
                        select
                        fullWidth
                        label="Daily window"
                        value={startHour}
                        onChange={(event) =>
                          setStartHour(Number(event.target.value))
                        }
                        slotProps={{
                          select: { native: true },
                          htmlInput: { style: { minHeight: 24 } },
                        }}
                        helperText={
                          selected === "timeOfUse"
                            ? `Use moves to ${policyWindowLabel((startHour + 4) % 24, 3)} afterward.`
                            : undefined
                        }
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <option key={hour} value={hour}>
                            {policyWindowLabel(hour)}
                          </option>
                        ))}
                      </TextField>
                    )}
                  </>
                )}
                {complete || cancelling ? null : effective >= end ? (
                  <Alert severity="info">
                    This run ends before another program change could take
                    effect.
                  </Alert>
                ) : (
                  <>
                    <Typography component="h3" variant="subtitle1">
                      Estimated utility demand · {labelMonth(game, month)}
                    </Typography>
                    {error ? (
                      <Alert severity="error">{error}</Alert>
                    ) : !result ? (
                      // Mirrors the loaded layout line for line so the dialog keeps its height
                      // when the estimate arrives instead of jumping under the player's pointer
                      <>
                        <Typography variant="body2">
                          Current plan ━ · With this change ┄
                        </Typography>
                        <PolicyDemandChartPlaceholder />
                        <Box aria-hidden>
                          {Array.from({ length: operating ? 1 : 2 }, (_, i) => (
                            <Typography key={i}>
                              <Skeleton width={i % 2 ? "60%" : "80%"} />
                            </Typography>
                          ))}
                          <Typography variant="body2" sx={NOTE_SLOT}>
                            &nbsp;
                          </Typography>
                        </Box>
                      </>
                    ) : (
                      <>
                        <Typography variant="body2">
                          Current plan ━ · With this change ┄
                        </Typography>
                        <PolicyDemandChart
                          current={result.current}
                          changed={result.changed}
                        />
                        <Box role="status">
                          <Typography>
                            Peak demand: {formatWatts(peakBefore)} →{" "}
                            {formatWatts(peakAfter)}
                          </Typography>
                          {!operating && (
                            <Typography>
                              Electricity supplied:{" "}
                              {formatWattHours(result.before.supplyWh)} →{" "}
                              {formatWattHours(result.after.supplyWh)}
                            </Typography>
                          )}

                          {formatWatts(peakBefore) === formatWatts(peakAfter) ||
                          Math.abs(peakAfter - peakBefore) <
                            peakBefore * 0.001 ? (
                            <Typography variant="body2" sx={NOTE_SLOT}>
                              Little change in peak demand.{" "}
                              {operating
                                ? "Only eligible loads respond. Try a different daily window to target your peak."
                                : selected === "solar"
                                  ? "Daylight savings may leave the evening peak unchanged."
                                  : "Efficiency savings are largest for heating and cooling, so mild weather may leave the peak unchanged."}
                            </Typography>
                          ) : (
                            <Typography
                              variant="body2"
                              sx={NOTE_SLOT}
                              aria-hidden
                            >
                              &nbsp;
                            </Typography>
                          )}
                        </Box>
                        {result.after.cash < 0 && (
                          <Alert severity="warning">
                            Projected cash is negative. Existing debt rules
                            still apply.
                          </Alert>
                        )}
                      </>
                    )}
                  </>
                )}
                <Button
                  onClick={() => {
                    onClose();
                    onViewDemand();
                  }}
                >
                  View demand
                </Button>
              </>
            )}
          </Box>
        )}
      </div>
      {selected && (
        <div className="customerProgramsActions">
          <Button onClick={() => setSelected(undefined)}>Back</Button>
          {policy && operating && current!.pending && (
            <Button
              onClick={() => {
                dispatch(cancelPolicy({ id: policy, ...current!.pending! }));
                setSelected(undefined);
              }}
            >
              Cancel scheduled change
            </Button>
          )}
          {selected === "wildfire"
            ? preparedness?.choice && (
                <Button
                  variant="contained"
                  disabled={!canChangePreparedness}
                  onClick={() => {
                    dispatch(
                      chooseScenarioResponse({
                        decisionId: preparedness.choice!.id,
                        optionId: preparedness.active ? "stop" : "prepare",
                      }),
                    );
                    setSelected(undefined);
                  }}
                >
                  {preparedness.active
                    ? "Turn off preparedness"
                    : `Start preparedness (${formatMoneyConcise(preparedness.annualCost)}/yr)`}
                </Button>
              )
            : !complete && (
                <Button
                  variant="contained"
                  disabled={
                    // Undoing a scheduled change needs no estimate.
                    (!cancelling && (unchanged || !result)) ||
                    effective >= end ||
                    !!game.replayPlayback
                  }
                  onClick={() => {
                    if (cancelling)
                      dispatch(
                        cancelPolicy({ id: policy!, ...current!.pending! }),
                      );
                    else
                      dispatch(
                        schedulePolicy({
                          id: policy!,
                          tier,
                          month: effective,
                          ...(operating ? { startHour } : {}),
                        }),
                      );
                    setSelected(undefined);
                  }}
                >
                  {operating
                    ? tier === "Off"
                      ? "Turn off next month"
                      : planned !== "Off"
                        ? "Update next month"
                        : "Turn on next month"
                    : current!.pending
                      ? current!.pending.tier === "Off"
                        ? "Cancel scheduled pause"
                        : current!.adoption > 0
                          ? "Cancel scheduled resume"
                          : "Cancel scheduled start"
                      : tier === "Off"
                        ? "Pause new installations next month"
                        : current!.adoption > 0
                          ? "Resume build-out next month"
                          : "Start build-out next month"}
                </Button>
              )}
        </div>
      )}
    </Dialog>
  );
}

export default function CustomerPrograms({
  game,
  onViewDemand,
}: {
  game: GameType;
  onViewDemand: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const policiesOn = policyAvailable(game);
  const preparedness = wildfirePreparedness(game);
  if ((!policiesOn && !preparedness) || game.replayPlayback) return null;
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  // A finished build-out costs nothing more, so it is neither active nor in the rebate total.
  const building = policiesOn
    ? BUILDOUT_IDS.filter(
        (id) =>
          programs[id].tier === "On" &&
          !buildoutComplete(programs[id].adoption),
      )
    : [];
  const active =
    (policiesOn
      ? POLICY_IDS.filter(
          (id) => isOperatingPolicy(id) && programs[id].tier !== "Off",
        ).length
      : 0) +
    building.length +
    (preparedness?.active ? 1 : 0);
  const pending = POLICY_IDS.some((id) => programs[id].pending);
  const budget = building.reduce(
    (sum, id) => sum + policyBudget(game, id, "On", game.date.monthsElapsed),
    0,
  );
  const progress = building.map(
    (id) =>
      ` · ${BUILDOUT_SHORT_NAME[id]} build-out · month ${buildoutMonthsDone(id, programs[id].adoption)} of ${buildoutMonths(id)}`,
  );
  return (
    <Box className="customerProgramsControl">
      <Button
        aria-label="Customer programs"
        title={
          pending
            ? `Customer programs: change starts ${labelMonth(game, game.date.monthsElapsed + 1)}`
            : `Customer programs: ${active} active${progress.join("")}${budget > 0 ? ` · ${formatMoneyConcise(budget)}/month in rebates` : ""}${preparedness?.active ? ` · wildfire preparedness ${formatMoneyConcise(preparedness.annualCost)}/yr` : ""}`
        }
        color="primary"
        variant="contained"
        onClick={() => setOpen(true)}
      >
        <GroupsIcon />
      </Button>
      {open && (
        <ProgramsScreen
          onClose={() => setOpen(false)}
          onViewDemand={onViewDemand}
        />
      )}
    </Box>
  );
}
