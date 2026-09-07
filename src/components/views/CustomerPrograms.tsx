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
  Radio,
  RadioGroup,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import {
  cancelPolicy,
  closePolicyDecision,
  openPolicyDecision,
  schedulePolicy,
} from "../../reducers/GameActions";
import { GameType, PolicyId, PolicyTier } from "../../Types";
import { POLICIES, POLICY_IDS, POLICY_TIERS } from "../../data/Policies";
import {
  emptyPolicies,
  policyAvailable,
  policyBudget,
} from "../../helpers/Policies";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { getScenario } from "../../data/Scenarios";
import { createPolicyPreviewWorker } from "../../helpers/PolicyPreviewClient";
import { PolicyPreviewResult } from "../../helpers/PolicyPreview";
import PolicyDemandChart from "../base/PolicyDemandChart";

const labelMonth = (game: GameType, month: number) => {
  const d = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  return `${d.month} ${d.year}`;
};

function Decision({
  onClose,
  onViewDemand,
}: {
  onClose: () => void;
  onViewDemand: () => void;
}) {
  const game = useAppSelector((s) => s.game);
  const dispatch = useAppDispatch();
  const phone = useMediaQuery("(max-width:600px)");
  const token = React.useId();
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);
  const [selected, setSelected] = React.useState<PolicyId>();
  const [tier, setTier] = React.useState<PolicyTier>("Off");
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
  const month = later ? Math.min(effective + 11, end - 1) : effective;
  const key = `${selected}/${tier}/${month}/${game.date.minute}`;
  React.useEffect(() => {
    if (!selected || effective >= end) return;
    let worker: Worker | undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        worker = createPolicyPreviewWorker();
        worker.onmessage = (event) => {
          if (!cancelled) setPreview({ key, snapshot: game, ...event.data });
        };
        worker.onerror = () => {
          if (!cancelled)
            setPreview({
              key,
              snapshot: game,
              error:
                "Could not estimate this change. Reopen the program to retry.",
            });
        };
        worker.postMessage({
          game: JSON.parse(JSON.stringify(game)),
          change: { id: selected, tier, month: effective },
          month,
        });
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
  }, [game, selected, tier, month, effective, end, key]);
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  const current = selected ? programs[selected] : undefined;
  const settled = preview?.key === key && preview.snapshot === game;
  const result = settled ? preview.result : undefined;
  const error = settled ? preview.error : undefined;
  const unchanged = tier === (current?.pending?.tier ?? current?.tier ?? "Off");
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
      <DialogTitle id="program-title">
        {selected ? POLICIES[selected].name : "Customer programs"}
      </DialogTitle>
      <DialogContent dividers>
        {!selected ? (
          <Box sx={{ display: "grid", gap: 2 }}>
            {POLICY_IDS.map((id) => (
              <Box key={id}>
                <Button
                  sx={{ minHeight: 44, textAlign: "left" }}
                  onClick={() => {
                    setSelected(id);
                    setTier(programs[id].pending?.tier ?? programs[id].tier);
                    setLater(false);
                  }}
                >
                  {POLICIES[id].name} · {programs[id].tier}
                </Button>
                <Typography>{POLICIES[id].description}</Typography>
                {programs[id].pending && (
                  <Typography variant="body2">
                    {programs[id].pending!.tier} starts{" "}
                    {labelMonth(game, programs[id].pending!.month)}
                  </Typography>
                )}
              </Box>
            ))}
            <Typography variant="body2">
              Funding continues monthly until changed. Installed upgrades stay
              for the rest of this run, including after funding stops.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 2 }}>
            <Typography>{POLICIES[selected].mechanism}</Typography>
            <Typography variant="body2">
              {current!.adoption >= 1
                ? "Fully adopted"
                : current!.adoption > 0
                  ? current!.tier === "Off"
                    ? "Installed upgrades retained"
                    : "Building up"
                  : "No funded upgrades yet"}{" "}
              · {Math.round(current!.adoption * 100)}% of eligible potential
              installed
            </Typography>
            <RadioGroup
              row={!phone}
              aria-label="Monthly funding"
              value={tier}
              onChange={(e) => setTier(e.target.value as PolicyTier)}
            >
              {POLICY_TIERS.map((choice) => (
                <FormControlLabel
                  key={choice}
                  value={choice}
                  control={<Radio />}
                  sx={{ minHeight: 44, m: 0, flex: 1 }}
                  label={`${choice} · ${choice === "Off" ? "$0/month" : `up to ${formatMoneyConcise(policyBudget(game, selected, choice, effective))}/month`}`}
                />
              ))}
            </RadioGroup>
            <Typography variant="body2">
              Off stops new spending; installed upgrades remain.
            </Typography>
            <Typography variant="body2">
              Small installs upgrades at a lower cost per upgrade. Large
              installs them faster, at a higher cost per upgrade.
            </Typography>
            <Typography variant="body2">
              Rebates cost money and reduce electricity sales.
            </Typography>
            {effective >= end ? (
              <Alert severity="info">
                This run ends before another funding change could take effect.
              </Alert>
            ) : (
              <>
                <Typography component="h3" variant="subtitle1">
                  Estimated utility demand · {labelMonth(game, month)}
                </Typography>
                {end - 1 > effective && (
                  <Button onClick={() => setLater(!later)}>
                    {later
                      ? "First effective month"
                      : end > effective + 11
                        ? "After 12 months"
                        : `By ${labelMonth(game, end - 1)}`}
                  </Button>
                )}
                {error ? (
                  <Alert severity="error">{error}</Alert>
                ) : !result ? (
                  <Typography role="status">Estimating this choice…</Typography>
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
                        Program spending: {formatMoneyConcise(result.spending)}{" "}
                        in {labelMonth(game, month)}
                      </Typography>
                      <Typography>
                        Peak demand: {formatWatts(peakBefore)} →{" "}
                        {formatWatts(peakAfter)}
                      </Typography>
                      <Typography>
                        Electricity supplied:{" "}
                        {formatWattHours(result.before.supplyWh)} →{" "}
                        {formatWattHours(result.after.supplyWh)} in{" "}
                        {labelMonth(game, month)}
                      </Typography>
                      <Typography>
                        Change in utility cash from now through{" "}
                        {labelMonth(game, month)}:{" "}
                        {formatMoneyConcise(result.cashChange)}
                      </Typography>
                      <Typography variant="body2">
                        Includes program spending, less electricity sold, and
                        actual dispatch costs.
                      </Typography>
                      {(formatWatts(peakBefore) === formatWatts(peakAfter) ||
                        Math.abs(peakAfter - peakBefore) <
                          peakBefore * 0.001) && (
                        <Typography variant="body2">
                          Little change in peak demand.{" "}
                          {selected === "solar"
                            ? "Daylight savings may leave the evening peak unchanged."
                            : "Efficiency savings build gradually as upgrades are installed."}
                        </Typography>
                      )}
                    </Box>
                    <details>
                      <summary>Why this changes</summary>
                      <Typography variant="body2">
                        {POLICIES[selected].tradeoff} Budgets adjust with
                        inflation. Spending pays only for new upgrades and stops
                        at full adoption. Installed upgrades persist for this
                        run.
                      </Typography>
                      <Typography variant="body2">
                        Estimates hold weather, fuel prices, fleet, rate and
                        customer assumptions, and other accepted programs
                        constant. Efficiency is a simplified end-use reduction
                        for homes and businesses. Solar offsets their remaining
                        load after efficiency; surplus is curtailed. No export
                        payments or utility generation credits. Hint: compare
                        daylight savings with the time of your shortage.
                      </Typography>
                    </details>
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
            {current!.pending && (
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
        {selected && !unchanged && effective < end && (
          <Typography variant="body2" sx={{ width: "100%" }}>
            {tier === "Off"
              ? `Funding stops ${labelMonth(game, effective)}`
              : `Charges start ${labelMonth(game, effective)} · until changed`}
          </Typography>
        )}
        <Button onClick={() => (selected ? setSelected(undefined) : onClose())}>
          {selected ? "Cancel" : "Close"}
        </Button>
        {selected && (
          <Button
            variant="contained"
            disabled={
              unchanged || !result || effective >= end || !!game.replayPlayback
            }
            onClick={() => {
              dispatch(
                schedulePolicy({ id: selected, tier, month: effective }),
              );
              setSelected(undefined);
            }}
          >
            Apply next month
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
  const programs = game.policies?.programs;
  const active = POLICY_IDS.filter(
    (id) => programs?.[id].tier && programs[id].tier !== "Off",
  ).length;
  const pending = POLICY_IDS.some((id) => programs?.[id].pending);
  const budget = POLICY_IDS.reduce(
    (sum, id) =>
      sum +
      policyBudget(
        game,
        id,
        programs?.[id].tier ?? "Off",
        game.date.monthsElapsed,
      ),
    0,
  );
  return (
    <Box
      sx={{
        maxWidth: "100%",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
      }}
    >
      <Button onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>
        Customer programs
      </Button>
      {pending ? (
        <Typography variant="caption">
          Change starts {labelMonth(game, game.date.monthsElapsed + 1)}
        </Typography>
      ) : (
        active > 0 && (
          <Typography variant="caption">
            {active} program{active > 1 ? "s" : ""} active · up to{" "}
            {formatMoneyConcise(budget)}/month
          </Typography>
        )
      )}
      {open && (
        <Decision onClose={() => setOpen(false)} onViewDemand={onViewDemand} />
      )}
    </Box>
  );
}
