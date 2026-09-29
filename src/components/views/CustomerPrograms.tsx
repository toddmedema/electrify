import {
  activeScenario,
  currentCash,
  currentTick,
} from "../../helpers/GameSelectors";
import * as React from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import EnergySavingsLeafIcon from "@mui/icons-material/EnergySavingsLeaf";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import ScheduleIcon from "@mui/icons-material/Schedule";
import FactoryIcon from "@mui/icons-material/Factory";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import { useAppDispatch, useAppSelector } from "../../Store";
import NavigableCardRow from "../base/NavigableCardRow";
import {
  cancelPolicy,
  chooseScenarioResponse,
  closePolicyDecision,
  openPolicyDecision,
  schedulePolicy,
} from "../../reducers/GameActions";
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
  isOperatingPolicy,
  programCustomers,
} from "../../helpers/Policies";
import {
  formatPercent,
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { createPolicyPreviewWorker } from "../../helpers/PolicyPreviewClient";
import { useWorkerRequest } from "../base/useWorkerRequest";
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
import CatalogTitleBar from "../base/CatalogTitleBar";
import {
  buildoutImpact,
  choiceStatus,
  labelMonth,
  programStatus,
  pendingLabel,
} from "../../helpers/PolicyStatus";
import PolicyDemandChart, {
  PolicyDemandChartPlaceholder,
} from "../base/PolicyDemandChart";
import { GENERATORS } from "../../data/Facilities";
import { generateNewTimeline } from "../../reducers/Game";
import { HOURS_PER_YEAR_REAL, TICKS_PER_YEAR } from "../../Constants";
import {
  deriveExpandedSummary,
  summarizeTimeline,
} from "../../helpers/DateTime";
import { getSolarOutputFactor } from "../../helpers/Energy";
import {
  policyWindowLabel,
  suggestedPolicyStartHour,
} from "../../helpers/PolicyWindow";
// The estimate's closing note wraps to two lines at dialog width. Reserving both whether or not
// it appears keeps the dialog from changing height when an estimate arrives.
const NOTE_SLOT = { minHeight: "2lh" };

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
  const snapshot = useEstimateSnapshot(game);
  const solar = React.useMemo(() => {
    const now = currentTick(snapshot);
    if (id !== "solar" || !now) return undefined;
    // A full year avoids presenting a single sunny or dark month as annual production.
    const ticks = generateNewTimeline(
      snapshot,
      now.cash,
      now.customers,
      TICKS_PER_YEAR,
    );
    const peakW = POLICIES.solar.cap * programCustomers(snapshot);
    const facility = GENERATORS(
      snapshot,
      peakW,
      [],
      ticks.map((t) => t.solarIrradianceWM2),
    ).find((g) => g.name === "Solar");
    if (!facility) return undefined;
    const annualWh =
      (peakW *
        HOURS_PER_YEAR_REAL *
        ticks.reduce(
          (sum, tick) =>
            sum +
            getSolarOutputFactor(tick.solarIrradianceWM2, tick.temperatureC),
          0,
        )) /
      ticks.length;
    const energy = (wh: number) =>
      Math.round(wh / 1e6).toLocaleString("en-US") + "MWh/yr";
    return {
      impact: `${formatWatts(peakW)} (est ${energy(annualWh * POLICIES.solar.derate)}) of rooftop panels`,
      label: `Facility comparable (${formatWatts(peakW)}/${energy(annualWh)})`,
      cost: `${formatMoneyConcise(facility.buildCost)} upfront + ${formatMoneyConcise(facility.annualOperatingCost / 12)}/mo`,
    };
  }, [snapshot, id]);
  const profit = deriveExpandedSummary(
    summarizeTimeline(game.timeline, game.startingYear),
  ).profit;
  const impact = solar?.impact ?? buildoutImpact(game, id);
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
        : "If resumed now";
  const facts: [string, string][] = complete
    ? [
        ["Result", impact],
        ["Cost", formatMoneyConcise(program.spent)],
      ]
    : [
        [
          "Cost",
          `${formatMoneyConcise(total)} (${formatMoneyConcise(policyBudget(game, id, "On", effective))}/mo vs ${formatMoneyConcise(profit)}/mo profit)`,
        ],
        ["At completion", impact],
      ];
  if (!complete && program.adoption === 0)
    facts.unshift([
      "Duration",
      `${months} months (${finish < end ? labelMonth(game, finish) : "After this run ends"})`,
    ]);
  if (!complete && program.adoption > 0 && finishLabel)
    facts.push([
      finishLabel,
      finish < end ? labelMonth(game, finish) : "After this run ends",
    ]);
  if (solar) facts.push([solar.label, solar.cost]);
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
      {solar && (
        <Typography variant="body2" color="text.secondary">
          Rooftops produce less per MW because of shading and orientation, but
          the utility does not pay full installation cost nor maintenance.
        </Typography>
      )}
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
 * answers, so a stale reply can never enable an action. The worker reloads its data over the
 * network, which fails offline; the page already has that data loaded, so a failed worker falls
 * back to estimating here.
 */
function useEstimate<T>(
  request: EstimateRequest<T> | undefined,
  snapshot: GameType,
): { result?: T; error?: string } {
  const state = useWorkerRequest(
    request && {
      key: request.key,
      scope: snapshot,
      message: () => request.message,
      fallback: request.estimate,
    },
    {
      createWorker: () => createPolicyPreviewWorker(),
      debounceMs: 250,
      read: (data: { result?: T; error?: string } | undefined) =>
        data && !data.error ? { result: data.result as T } : undefined,
    },
  );
  if (state.status === "ready") return { result: state.result };
  if (state.status === "error") {
    return {
      error:
        state.reason === "startup"
          ? "Could not start the preview. Reopen the program to retry."
          : "Could not estimate this change. Reopen the program to retry.",
    };
  }
  return {};
}

/** Keep the standing program's status and yearly budget visible in the list. */
function preparednessStatus(preparedness: WildfirePreparednessType): string {
  return `${preparedness.active ? "On" : "Off"} · ${formatPercent(preparedness.effectiveness)} effective · ${formatMoneyConcise(preparedness.annualCost)}/yr`;
}

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
          {formatPercent(effectiveness)} effective
        </Typography>
        <LinearProgress
          variant="determinate"
          value={effectiveness * 100}
          aria-label="Wildfire preparedness effectiveness"
          aria-valuetext={`${formatPercent(effectiveness)} effective · ${progress}`}
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
                  {formatPercent(result.standardEffectiveness)} → {onLabel}{" "}
                  {formatPercent(result.preparedEffectiveness)}
                </Typography>
                <Typography>
                  Customer load disconnected:{" "}
                  {formatPercent(standard.disconnectedDemand)} →{" "}
                  {formatPercent(prepared.disconnectedDemand)}
                </Typography>
                {standard.selectedFacilityNames.length > 0 && (
                  <Typography>
                    {standard.selectedFacilityNames.join(", ")} limited to{" "}
                    {formatPercent(standard.outputMultiplier)} →{" "}
                    {formatPercent(prepared.outputMultiplier)} output
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

/** The catalog of programs, grouped by what kind of commitment each one is. */
function ProgramList({
  game,
  programs,
  policiesOn,
  preparedness,
  onOpen,
  onOpenWildfire,
}: {
  game: GameType;
  programs: Record<PolicyId, PolicyProgramType>;
  policiesOn: boolean;
  preparedness: WildfirePreparednessType | undefined;
  onOpen: (id: PolicyId) => void;
  onOpenWildfire: () => void;
}) {
  const finished = (id: PolicyId) =>
    !isOperatingPolicy(id) && buildoutComplete(programs[id].adoption);
  // Rows share the scenario pick list's card, so both catalogs scan the same way.
  const row = ({
    id,
    name,
    status,
    description,
    Icon,
    done,
    active,
    onOpen: open,
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
    <NavigableCardRow
      key={id}
      className="customerProgramItem"
      done={done}
      active={active}
      ariaLabel={`${name} · ${status}`}
      ariaDescribedBy={description ? `program-description-${id}` : undefined}
      onOpen={open}
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
      description={
        description && (
          <span id={`program-description-${id}`}>{description}</span>
        )
      }
    />
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
      onOpen: () => onOpen(id),
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
  return (
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
            onOpen: onOpenWildfire,
          }),
        ])}
      {policiesOn &&
        section("Completed", POLICY_IDS.filter(finished).map(choice))}
    </Box>
  );
}

/** One demand program: what it does, its settings, and an estimate of the change. */
function PolicyProgramDetail({
  game,
  selected,
  current,
  buildout,
  complete,
  cancelling,
  operating,
  effective,
  end,
  month,
  tier,
  onTierChange,
  startHour,
  onStartHourChange,
  result,
  error,
  onClose,
  onViewDemand,
}: {
  game: GameType;
  selected: PolicyId;
  current: PolicyProgramType;
  buildout: BuildoutPolicyId | undefined;
  complete: boolean;
  cancelling: boolean;
  operating: boolean;
  effective: number;
  end: number;
  month: number;
  tier: PolicyTier;
  onTierChange: (tier: PolicyTier) => void;
  startHour: number;
  onStartHourChange: (hour: number) => void;
  result: PolicyPreviewResult | undefined;
  error: string | undefined;
  onClose: () => void;
  onViewDemand: () => void;
}) {
  const peakBefore = result ? Math.max(...result.current) : 0;
  const peakAfter = result ? Math.max(...result.changed) : 0;
  return (
    <>
      <Typography>
        {complete
          ? `This one-time project is finished. Installed ${selected === "solar" ? "rooftop panels keep generating" : "upgrades keep saving energy"} with no further cost.`
          : POLICIES[selected].description}
      </Typography>
      {!complete && (
        <details className="customerProgramHowItWorks">
          <summary>How it works</summary>
          <Typography sx={{ mt: 1 }}>{POLICIES[selected].mechanism}</Typography>
        </details>
      )}
      {current.pending && (
        // A standing notice, not an interruption: it is already true when the card opens.
        <Alert severity="info" role="status">
          {pendingLabel(game, selected, current)}
        </Alert>
      )}
      {buildout ? (
        <BuildoutSummary
          game={game}
          id={buildout}
          program={current}
          effective={effective}
          end={end}
        />
      ) : (
        <>
          <RadioGroup
            row
            aria-label="Program status"
            value={tier}
            onChange={(e) => {
              const next = POLICY_TIERS.find((t) => t === e.target.value);
              if (next) onTierChange(next);
            }}
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
                onStartHourChange(Number(event.target.value))
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
          This run ends before another program change could take effect.
        </Alert>
      ) : (
        <>
          <Typography component="h3" variant="subtitle1">
            Estimated demand · {labelMonth(game, month)}
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
                Math.abs(peakAfter - peakBefore) < peakBefore * 0.001 ? (
                  <Typography variant="body2" sx={NOTE_SLOT}>
                    Little change in peak demand.{" "}
                    {operating
                      ? "Only eligible loads respond. Try a different daily window to target your peak."
                      : selected === "solar"
                        ? "Daylight savings may leave the evening peak unchanged."
                        : "Efficiency savings are largest for heating and cooling, so mild weather may leave the peak unchanged."}
                  </Typography>
                ) : (
                  <Typography variant="body2" sx={NOTE_SLOT} aria-hidden>
                    &nbsp;
                  </Typography>
                )}
              </Box>
              {result.after.cash < 0 && (
                <Alert severity="warning">
                  Projected cash is negative. Existing debt rules still apply.
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
  const cash = currentCash(game);
  const effective = game.date.monthsElapsed + 1;
  const end = activeScenario(game)?.durationMonths ?? 0;
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
        <CatalogTitleBar
          disableGutters
          icon={<GroupsIcon fontSize="small" aria-hidden />}
          title={
            // Phones abbreviate the title so it still shares a line with close
            <>
              <span className="programsTitleLong">Customer programs</span>
              <span className="programsTitleShort">Programs</span>
            </>
          }
          compactCash
          titleComponent="h1"
          titleId="program-title"
          cash={cash}
          onClose={onClose}
          closeLabel="Close customer programs"
        />
      </header>
      <div
        className="customerProgramsBody"
        role="region"
        aria-label={title ?? "Programs"}
      >
        {!selected ? (
          <ProgramList
            game={game}
            programs={programs}
            policiesOn={policiesOn}
            preparedness={preparedness}
            onOpen={open}
            onOpenWildfire={() => setSelected("wildfire")}
          />
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
              <PolicyProgramDetail
                game={game}
                selected={selected}
                current={current!}
                buildout={buildout}
                complete={complete}
                cancelling={cancelling}
                operating={operating}
                effective={effective}
                end={end}
                month={month}
                tier={tier}
                onTierChange={setTier}
                startHour={startHour}
                onStartHourChange={setStartHour}
                result={result}
                error={error}
                onClose={onClose}
                onViewDemand={onViewDemand}
              />
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
                          : "Start next month"}
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
        variant="outlined"
        startIcon={<GroupsIcon />}
        onClick={() => setOpen(true)}
      >
        Programs
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
