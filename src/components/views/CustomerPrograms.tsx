import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Radio,
  RadioGroup,
  Skeleton,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import CloseIcon from "@mui/icons-material/Close";
import { useAppDispatch, useAppSelector } from "../../Store";
import {
  cancelPolicy,
  closePolicyDecision,
  openPolicyDecision,
  schedulePolicy,
} from "../../reducers/GameActions";
import { GameType, PolicyId, PolicyProgramType, PolicyTier } from "../../Types";
import { POLICIES, POLICY_IDS, POLICY_TIERS } from "../../data/Policies";
import {
  BuildoutPolicyId,
  buildoutComplete,
  buildoutCompletionMonth,
  buildoutMonths,
  buildoutMonthsDone,
  buildoutMonthsRemaining,
  emptyPolicies,
  policyAvailable,
  policyBudget,
  policyTotalCost,
  isOperatingPolicy,
} from "../../helpers/Policies";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { getScenario } from "../../data/Scenarios";
import { createPolicyPreviewWorker } from "../../helpers/PolicyPreviewClient";
import {
  PolicyPreviewResult,
  previewPolicy,
} from "../../helpers/PolicyPreview";
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

const labelMonth = (game: GameType, month: number) => {
  const d = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  return `${d.month} ${d.year}`;
};

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
    return `Paused · ${Math.round(program.adoption * 100)}% installed`;
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
      ? `Off starts ${when}`
      : `On starts ${when} · ${policyWindowLabel(pending.startHour ?? program.startHour ?? 17)}`;
  if (pending.tier === "Off") return `Pauses ${when}`;
  return program.adoption > 0 ? `Resumes ${when}` : `Starts ${when}`;
}

function buildoutImpact(game: GameType, id: BuildoutPolicyId): string {
  return id === "solar"
    ? `Up to ${formatWatts(POLICIES.solar.cap * game.customerMarketSize * game.startingDemandScale)} of daytime rooftop generation`
    : `Home and business use ${Math.round(POLICIES.efficiency.cap * 100)}% lower all day`;
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
  const remaining = buildoutMonthsRemaining(id, program.adoption);
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
        program.adoption > 0
          ? [
              "Remaining",
              `${remaining} ${remaining === 1 ? "month" : "months"}`,
            ]
          : ["Duration", `${months} months of installations`],
        ["Total cost", `About ${formatMoneyConcise(total)}`],
        [
          "While active",
          `${formatMoneyConcise(policyBudget(game, id, "On", effective))}/month`,
        ],
        ["At completion", buildoutImpact(game, id)],
      ];
  if (!complete && finishLabel)
    facts.push([
      finishLabel,
      finish < end ? labelMonth(game, finish) : "After this run ends",
    ]);
  const progress = complete
    ? `Completed ${program.completedMonth === undefined ? "" : `${labelMonth(game, program.completedMonth)} `}· no further cost`
    : `${program.tier === "On" ? "Month" : "Paused after month"} ${done} of ${months} · ${formatMoneyConcise(program.spent)} spent of about ${formatMoneyConcise(total)}`;
  return (
    <Box className="customerProgramProject" sx={{ display: "grid", gap: 1.5 }}>
      {program.pending && (
        <Typography>{pendingLabel(game, id, program)}</Typography>
      )}
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
      <Box
        component="dl"
        sx={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          columnGap: 2,
          rowGap: 0.5,
          m: 0,
          "& dt": { color: "text.secondary" },
          "& dd": { m: 0 },
        }}
      >
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

function Decision({
  onClose,
  onViewDemand,
}: {
  onClose: () => void;
  onViewDemand: () => void;
}) {
  const game = useAppSelector((s) => s.game);
  const dispatch = useAppDispatch();
  const manualOpen = useAppSelector((s) => !!s.ui.manualHelpEntry);
  const phone = useMediaQuery("(max-width:600px)");
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
  const [selected, setSelected] = React.useState<PolicyId>();
  const [tier, setTier] = React.useState<PolicyTier>("Off");
  const [startHour, setStartHour] = React.useState(17);
  const [later, setLater] = React.useState(false);
  const [preview, setPreview] = React.useState<{
    key: string;
    snapshot: GameType;
    result?: PolicyPreviewResult;
    error?: string;
  }>();
  React.useEffect(() => {
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token]);
  const effective = game.date.monthsElapsed + 1;
  const end =
    getScenario(game.scenarioId, game.customScenario)?.durationMonths ?? 0;
  const selectedProgram = selected
    ? (game.policies?.programs ?? emptyPolicies().programs)[selected]
    : undefined;
  const buildout =
    selected && !isOperatingPolicy(selected)
      ? (selected as BuildoutPolicyId)
      : undefined;
  // The comparison month is the unpaused completion from next month: when a start or resume
  // would finish, or when a pause cuts off what would otherwise have finished then.
  const completion = buildout
    ? buildoutCompletionMonth(buildout, selectedProgram!.adoption, effective)
    : effective;
  const laterMonth = Math.max(effective, Math.min(completion, end - 1));
  const month = later ? laterMonth : effective;
  const key = `${selected}/${tier}/${startHour}/${month}/${game.date.minute}`;
  React.useEffect(() => {
    if (
      !selected ||
      effective >= end ||
      // Undoing a scheduled build-out change needs no estimate.
      (buildout &&
        (buildoutComplete(selectedProgram!.adoption) ||
          selectedProgram!.pending))
    )
      return;
    let worker: Worker | undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        worker = createPolicyPreviewWorker();
        const change = {
          id: selected,
          tier,
          month: effective,
          ...(isOperatingPolicy(selected) ? { startHour } : {}),
        };
        // The worker reloads its data over the network, which fails offline. The page already
        // has that data loaded, so fall back to estimating here.
        const estimateHere = () => {
          if (cancelled) return;
          try {
            setPreview({
              key,
              snapshot: game,
              result: previewPolicy(game, change, month),
            });
          } catch (_error) {
            setPreview({
              key,
              snapshot: game,
              error:
                "Could not estimate this change. Reopen the program to retry.",
            });
          }
        };
        worker.onmessage = (event) => {
          if (event.data?.error) estimateHere();
          else if (!cancelled)
            setPreview({ key, snapshot: game, ...event.data });
        };
        worker.onerror = (event: ErrorEvent) => {
          // An unhandled worker error is re-raised on the window. The preview falls back to
          // the page itself, so it must not also be reported as an uncaught runtime error.
          event.preventDefault();
          estimateHere();
        };
        worker.postMessage({ game, change, month });
      } catch (_error) {
        setPreview({
          key,
          snapshot: game,
          error: "Could not start the preview. Reopen the program to retry.",
        });
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [
    game,
    selected,
    tier,
    startHour,
    month,
    effective,
    end,
    key,
    buildout,
    selectedProgram,
  ]);
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  const current = selectedProgram;
  const operating = selected ? isOperatingPolicy(selected) : false;
  const complete = !!buildout && buildoutComplete(current!.adoption);
  const cancelling = !!buildout && !!current!.pending;
  const planned = current?.pending?.tier ?? current?.tier ?? "Off";
  const settled = preview?.key === key && preview.snapshot === game;
  const result = settled ? preview.result : undefined;
  const error = settled ? preview.error : undefined;
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
    setLater(false);
  };
  const choice = (id: PolicyId) => {
    const status = programStatus(game, id, programs[id]);
    return (
      <Box
        key={id}
        className="customerProgramChoice"
        data-completed={finished(id) || undefined}
      >
        <Button
          className="customerProgramChoiceButton"
          aria-label={`${POLICIES[id].name} · ${status}`}
          aria-describedby={`program-description-${id}`}
          fullWidth
          sx={{ minHeight: 44, textAlign: "left" }}
          onClick={() => open(id)}
        >
          <span>
            <strong>{POLICIES[id].name}</strong>
            <Typography component="span" variant="body2">
              {status}
            </Typography>
            <Typography
              id={`program-description-${id}`}
              component="span"
              variant="body2"
              color="textSecondary"
            >
              {finished(id)
                ? buildoutImpact(game, id as BuildoutPolicyId)
                : POLICIES[id].description}
            </Typography>
          </span>
          <span aria-hidden>›</span>
        </Button>
        {programs[id].pending && (
          <Typography variant="body2">
            {pendingLabel(game, id, programs[id])}
          </Typography>
        )}
      </Box>
    );
  };
  const peakBefore = result ? Math.max(...result.current) : 0;
  const peakAfter = result ? Math.max(...result.changed) : 0;
  return (
    <Dialog
      open
      fullScreen={phone}
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      aria-labelledby="program-title"
      data-customer-programs="true"
    >
      <DialogTitle
        id="program-title"
        sx={{ display: "flex", alignItems: "center", gap: 1 }}
      >
        {selected ? POLICIES[selected].name : "Customer programs"}
        <ManualLink entry={MANUAL_ENTRY.CUSTOMER_PROGRAMS} />
        <IconButton
          aria-label="Close customer programs"
          onClick={onClose}
          sx={{ ml: "auto", width: 44, height: 44 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          "& button": { minHeight: 44 },
          "& summary": { minHeight: 44, cursor: "pointer" },
        }}
      >
        {!selected ? (
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography variant="body2">Changes start next month.</Typography>
            {POLICY_IDS.filter((id) => !finished(id)).map(choice)}
            {POLICY_IDS.some(finished) && (
              <Box
                component="section"
                aria-labelledby="completed-programs"
                sx={{ display: "grid", gap: 1 }}
              >
                <Typography
                  id="completed-programs"
                  component="h3"
                  variant="subtitle2"
                  color="textSecondary"
                >
                  Completed
                </Typography>
                {POLICY_IDS.filter(finished).map(choice)}
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography>
              {operating
                ? POLICIES[selected].description
                : POLICIES[selected].mechanism}
            </Typography>
            {buildout ? (
              <BuildoutSummary
                game={game}
                id={buildout}
                program={current!}
                effective={effective}
                end={end}
              />
            ) : (
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
            )}
            {operating && tier !== "Off" && (
              <TextField
                select
                fullWidth
                label="Daily window"
                value={startHour}
                onChange={(event) => setStartHour(Number(event.target.value))}
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
            {complete || cancelling ? null : effective >= end ? (
              <Alert severity="info">
                This run ends before another program change could take effect.
              </Alert>
            ) : (
              <>
                <Typography component="h3" variant="subtitle1">
                  Estimated utility demand · {labelMonth(game, month)}
                </Typography>
                {buildout && laterMonth > effective && (
                  <Button onClick={() => setLater(!later)}>
                    {later
                      ? "First effective month"
                      : completion >= end
                        ? `By ${labelMonth(game, laterMonth)}`
                        : tier === "Off"
                          ? `At planned completion (${labelMonth(game, laterMonth)})`
                          : `At completion (${labelMonth(game, laterMonth)})`}
                  </Button>
                )}
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
                      {Array.from({ length: operating ? 2 : 4 }, (_, i) => (
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
                      {!operating && (
                        <Typography>
                          Program spending:{" "}
                          {formatMoneyConcise(result.spending)} in{" "}
                          {labelMonth(game, month)}
                        </Typography>
                      )}
                      <Typography>
                        Peak demand: {formatWatts(peakBefore)} →{" "}
                        {formatWatts(peakAfter)}
                      </Typography>
                      {!operating && (
                        <Typography>
                          Electricity supplied:{" "}
                          {formatWattHours(result.before.supplyWh)} →{" "}
                          {formatWattHours(result.after.supplyWh)} in{" "}
                          {labelMonth(game, month)}
                        </Typography>
                      )}
                      <Typography>
                        Change in utility cash from now through{" "}
                        {labelMonth(game, month)}:{" "}
                        {formatMoneyConcise(result.cashChange)}
                      </Typography>

                      {formatWatts(peakBefore) === formatWatts(peakAfter) ||
                      Math.abs(peakAfter - peakBefore) < peakBefore * 0.001 ? (
                        <Typography variant="body2" sx={NOTE_SLOT}>
                          Little change in peak demand.{" "}
                          {operating
                            ? "Only eligible loads respond. Try a different daily window to target your peak."
                            : selected === "solar"
                              ? "Daylight savings may leave the evening peak unchanged."
                              : "Efficiency savings build gradually as upgrades are installed."}
                        </Typography>
                      ) : (
                        <Typography variant="body2" sx={NOTE_SLOT} aria-hidden>
                          &nbsp;
                        </Typography>
                      )}
                    </Box>
                    {result.after.cash < 0 && (
                      <Alert severity="warning">
                        Projected cash is negative. Existing debt rules still
                        apply.
                      </Alert>
                    )}
                  </>
                )}
              </>
            )}
            {operating && current!.pending && (
              <Button
                onClick={() => {
                  dispatch(
                    cancelPolicy({ id: selected, ...current!.pending! }),
                  );
                  setSelected(undefined);
                }}
              >
                Cancel scheduled change
              </Button>
            )}
            <Button
              onClick={() => {
                onClose();
                onViewDemand();
              }}
            >
              View demand
            </Button>
          </Box>
        )}
      </DialogContent>
      <DialogActions
        sx={{ p: 2, flexWrap: "wrap", gap: 1, "& button": { minHeight: 44 } }}
      >
        <Button onClick={() => (selected ? setSelected(undefined) : onClose())}>
          {selected ? "Back" : "Close"}
        </Button>
        {selected && !complete && (
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
                dispatch(cancelPolicy({ id: selected, ...current!.pending! }));
              else
                dispatch(
                  schedulePolicy({
                    id: selected,
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
      </DialogActions>
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
  if (!policyAvailable(game) || game.replayPlayback) return null;
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  // A finished build-out costs nothing more, so it is neither active nor in the rebate total.
  const building = (["efficiency", "solar"] as BuildoutPolicyId[]).filter(
    (id) =>
      programs[id].tier === "On" && !buildoutComplete(programs[id].adoption),
  );
  const active =
    POLICY_IDS.filter(
      (id) => isOperatingPolicy(id) && programs[id].tier !== "Off",
    ).length + building.length;
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
    <Box
      className="customerProgramsControl"
      sx={{
        maxWidth: "100%",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
      }}
    >
      <Button
        aria-label="Customer programs"
        title={
          pending
            ? `Customer programs: change starts ${labelMonth(game, game.date.monthsElapsed + 1)}`
            : `Customer programs: ${active} active${progress.join("")}${budget > 0 ? ` · ${formatMoneyConcise(budget)}/month in rebates` : ""}`
        }
        color="primary"
        variant="contained"
        onClick={() => setOpen(true)}
        sx={{ minHeight: 44, minWidth: 44 }}
      >
        <GroupsIcon />
      </Button>
      {open && (
        <Decision onClose={() => setOpen(false)} onViewDemand={onViewDemand} />
      )}
    </Box>
  );
}
