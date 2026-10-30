import {
  activeScenario,
  currentCash,
  currentTick,
} from "../../helpers/GameSelectors";
import * as React from "react";
import { useToolState, useToolScroll } from "../base/GameToolMemory";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  LinearProgress,
  TextField,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import EnergySavingsLeafIcon from "@mui/icons-material/EnergySavingsLeaf";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import ScheduleIcon from "@mui/icons-material/Schedule";
import FactoryIcon from "@mui/icons-material/Factory";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import ElectricCarIcon from "@mui/icons-material/ElectricCar";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import { useAppDispatch, useAppSelector } from "../../Store";
import NavigableCardRow from "../base/NavigableCardRow";
import {
  cancelPolicy,
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
import { POLICIES, POLICY_IDS } from "../../data/Policies";
import {
  FLEXIBILITY_IDS,
  isFlexibilityPolicy,
  flexibilityMonths,
  flexibilityAvailable,
  flexibilityCapitalCost,
  flexibilityMonthlyCost,
} from "../../helpers/CustomerFlexibility";
import { electricVehicleEligibility } from "../../data/ElectricVehicles";
import { customerBatteryFleet } from "../../helpers/CustomerBatteries";
import { GENERATORS } from "../../data/Facilities";
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
import { generateForecastTimeline } from "../../reducers/Game";
import { HOURS_PER_YEAR_REAL, TICKS_PER_YEAR } from "../../Constants";
import { getSolarOutputFactor } from "../../helpers/Energy";
import {
  policyWindowLabel,
  suggestedPolicyStartHour,
} from "../../helpers/PolicyWindow";
const PROGRAM_ICONS: Record<PolicyId, typeof ScheduleIcon> = {
  efficiency: EnergySavingsLeafIcon,
  solar: SolarPowerIcon,
  timeOfUse: ScheduleIcon,
  curtailment: FactoryIcon,
  thermal: ThermostatIcon,
  evCharging: ElectricCarIcon,
  battery: BatteryChargingFullIcon,
};

const BUILDOUT_IDS: BuildoutPolicyId[] = ["efficiency", "solar"];

interface ProgramFact {
  label: string;
  value: string;
  detail?: string;
  wide?: boolean;
}

function ProgramFacts({
  facts,
  secondary = false,
}: {
  facts: ProgramFact[];
  secondary?: boolean;
}) {
  return (
    <Box
      component="dl"
      className={
        secondary
          ? "customerProgramFacts customerProgramFactsSecondary"
          : "customerProgramFacts"
      }
    >
      {facts.map(({ label, value, detail, wide }) => (
        <div
          key={label}
          className="customerProgramFact"
          data-wide={wide || undefined}
        >
          <Typography component="dt" variant="body2">
            {label}
          </Typography>
          <Typography component="dd">
            {value}
            {detail && (
              <Typography
                component="span"
                variant="body2"
                className="customerProgramFactDetail"
              >
                {detail}
              </Typography>
            )}
          </Typography>
        </div>
      ))}
    </Box>
  );
}

function ProgramDetails({
  children,
  label = "Program details",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <Box component="details" className="customerProgramDetails">
      <summary>{label}</summary>
      <div>{children}</div>
    </Box>
  );
}

function FlexibilitySummary({
  game,
  id,
  program,
  month,
}: {
  game: GameType;
  id: "thermal" | "evCharging" | "battery";
  program: PolicyProgramType;
  month: number;
}) {
  const year = game.startingYear + Math.floor(month / 12);
  const available = flexibilityAvailable(game, id, month);
  const fullRollout: GameType = {
    ...game,
    policies: {
      month: game.date.monthsElapsed,
      programs: {
        ...(game.policies?.programs ?? emptyPolicies().programs),
        [id]: {
          ...program,
          tier: "On",
          adoption: 1,
          installs: (program.installs ?? []).concat([
            [month, Math.max(0, 1 - program.adoption)],
          ]),
        },
      },
    },
  };
  const battery =
    id === "battery"
      ? customerBatteryFleet(
          program,
          month,
          game.startingYear,
          programCustomers(game),
          game.location,
        )
      : undefined;
  const facts: ProgramFact[] = [
    {
      label: "Installation cost",
      value: `${formatMoneyConcise(buildoutComplete(program.adoption) ? 0 : flexibilityCapitalCost(game, id, month) / flexibilityMonths(id))}/mo`,
      detail: `${flexibilityMonths(id)} months to full rollout`,
    },
    {
      label: "Participation payments",
      value: `${formatMoneyConcise(flexibilityMonthlyCost(game, id, game.date.monthsElapsed))}/mo`,
      detail: `${formatMoneyConcise(flexibilityMonthlyCost(fullRollout, id, month))}/mo at full rollout while on`,
    },
  ];
  const equipment: ProgramFact[] = [
    {
      label: "Local equipment",
      value: `${year} · ${available ? "Available" : "Not yet available"}`,
    },
    { label: "Rollout", value: formatPercent(program.adoption) },
  ];
  if (id === "evCharging")
    equipment.push({
      label: "Electric-car fleet",
      value: `${formatPercent(electricVehicleEligibility(year, game.location).fleetShare)} of local cars`,
      detail: "Compatible chargers only",
    });
  if (battery)
    equipment.push({
      label: "Enrolled storage",
      value: `${formatWatts(battery.powerW)} / ${formatWattHours(battery.capacityWh)}`,
      detail: "20% household reserve",
    });
  return (
    <>
      {!available && (
        <Alert severity="info">
          {id === "battery" && year >= 2013 && year < 2016
            ? "Home battery programs become available in 2016."
            : `No eligible equipment in ${year}.`}
        </Alert>
      )}
      <ProgramFacts facts={facts} />
      <ProgramDetails label="Equipment & rollout">
        <ProgramFacts facts={equipment} secondary />
      </ProgramDetails>
    </>
  );
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
  const snapshot = useEstimateSnapshot(game);
  const solar = React.useMemo(() => {
    const now = currentTick(snapshot);
    if (id !== "solar" || !now) return undefined;
    // A full year avoids presenting a single sunny or dark month as annual production.
    const ticks = generateForecastTimeline(
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
    const energy = (wh: number) => `${formatWattHours(wh)}/yr`;
    return {
      impact: `${formatWatts(peakW)} (est ${energy(annualWh * POLICIES.solar.derate)}) of rooftop panels`,
      label: `Facility comparable (${formatWatts(peakW)}/${energy(annualWh)})`,
      cost: `${formatMoneyConcise(facility.buildCost)} upfront + ${formatMoneyConcise(facility.annualOperatingCost / 12)}/mo`,
    };
  }, [snapshot, id]);
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
  const facts: ProgramFact[] = complete
    ? [
        { label: "Total spent", value: formatMoneyConcise(program.spent) },
        { label: "Result", value: impact, wide: true },
      ]
    : [
        {
          label: "Monthly cost",
          value: `${formatMoneyConcise(policyBudget(game, id, "On", effective))}/mo`,
        },
        { label: "Total cost", value: formatMoneyConcise(total) },
        {
          label: "Duration",
          value: `${months} months`,
          detail:
            program.adoption === 0
              ? finish < end
                ? `Finishes ${labelMonth(game, finish)}`
                : "Ends after this run"
              : undefined,
        },
        { label: "At completion", value: impact, wide: true },
      ];
  if (!complete && program.adoption > 0 && finishLabel)
    facts.splice(3, 0, {
      label: finishLabel,
      value: finish < end ? labelMonth(game, finish) : "After this run ends",
    });
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
          {!complete && <Typography variant="body2">{progress}</Typography>}
        </Box>
      )}
      <ProgramFacts facts={facts} />
      {solar && (
        <ProgramDetails label="Compare utility solar">
          <ProgramFacts
            facts={[{ label: solar.label, value: solar.cost, wide: true }]}
            secondary
          />
        </ProgramDetails>
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
  message: { game: GameType; month: number; change: PolicyChangeType };
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

/** The catalog of programs, grouped by the problem each one helps solve. */
function ProgramList({
  game,
  programs,
  policiesOn,
  onOpen,
}: {
  game: GameType;
  programs: Record<PolicyId, PolicyProgramType>;
  policiesOn: boolean;
  onOpen: (id: PolicyId) => void;
}) {
  const finished = (id: PolicyId) =>
    !isOperatingPolicy(id) &&
    !isFlexibilityPolicy(id) &&
    buildoutComplete(programs[id].adoption);
  // Rows share the scenario pick list's card, so both catalogs scan the same way.
  const row = ({
    id,
    name,
    status,
    Icon,
    done,
    active,
    onOpen: open,
  }: {
    id: string;
    name: string;
    status: string;
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
    />
  );
  const choice = (id: PolicyId) => {
    const done = finished(id);
    return row({
      id,
      name: POLICIES[id].name,
      status: choiceStatus(game, id, programs[id]),
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
      {policiesOn &&
        section(
          "Reduce overall demand",
          BUILDOUT_IDS.filter((id) => !finished(id)).map(choice),
        )}
      {policiesOn &&
        section(
          "Offset peak demand",
          [...POLICY_IDS.filter(isOperatingPolicy), ...FLEXIBILITY_IDS].map(
            choice,
          ),
        )}
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
  effective,
  end,
  month,
  tier,
  startHour,
  onStartHourChange,
  result,
  error,
}: {
  game: GameType;
  selected: PolicyId;
  current: PolicyProgramType;
  buildout: BuildoutPolicyId | undefined;
  complete: boolean;
  cancelling: boolean;
  effective: number;
  end: number;
  month: number;
  tier: PolicyTier;
  startHour: number;
  onStartHourChange: (hour: number) => void;
  result: PolicyPreviewResult | undefined;
  error: string | undefined;
}) {
  return (
    <>
      <Typography>
        {complete
          ? `Installed ${selected === "solar" ? "rooftop panels keep generating" : "upgrades keep saving energy"} with no further cost.`
          : POLICIES[selected].description}
      </Typography>
      {current.pending && (
        // A standing notice, not an interruption: it is already true when the card opens.
        <Alert severity="info" role="status">
          {pendingLabel(game, selected, current)}
        </Alert>
      )}
      {isFlexibilityPolicy(selected) && (
        <FlexibilitySummary
          game={game}
          id={selected}
          program={current}
          month={effective}
        />
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
          <Box className="customerProgramSettings">
            <Typography variant="body2" color="text.secondary">
              Changes start {labelMonth(game, effective)}
            </Typography>
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
                  htmlInput: { style: { minHeight: 28 } },
                }}
                helperText={
                  selected === "timeOfUse"
                    ? `Use shifts to ${policyWindowLabel((startHour + 4) % 24, 3).replace("–", "-")}`
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
          </Box>
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
          ) : (
            <>
              <Typography variant="body2">
                Current plan ━ · With this change ┄
              </Typography>
              {result ? (
                <PolicyDemandChart
                  current={result.current}
                  changed={result.changed}
                />
              ) : (
                <PolicyDemandChartPlaceholder />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

type Selection = PolicyId;

export function ProgramsScreen({
  onClose,
  embedded = false,
  pricing,
  onBackChange,
}: {
  onClose: () => void;
  embedded?: boolean;
  pricing?: React.ReactNode;
  onBackChange?: React.Dispatch<React.SetStateAction<(() => void) | undefined>>;
}) {
  const game = useAppSelector((s) => s.game);
  const dispatch = useAppDispatch();
  const manualOpen = useAppSelector((s) => !!s.ui.manualHelpEntry);
  const activeCard = useAppSelector((s) => s.card?.name);
  const token = React.useId();
  const [selected, setSelected] = useToolState<Selection | undefined>(
    "programs.selection",
    undefined,
  );
  const [tier, setTier] = useToolState<PolicyTier>("programs.tier", "Off");
  const [startHour, setStartHour] = useToolState("programs.startHour", 17);
  const bodyRef = useToolScroll<HTMLDivElement>(
    `programs.scroll.${selected ?? "list"}`,
  );
  React.useEffect(() => {
    onBackChange?.(() => (selected ? () => setSelected(undefined) : undefined));
    return () => onBackChange?.(undefined);
  }, [onBackChange, selected, setSelected]);
  const screenRef = React.useRef<HTMLDivElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const lastSelection = React.useRef<Selection>();
  React.useLayoutEffect(() => {
    if (!embedded) return;
    if (selected) {
      lastSelection.current = selected;
      headingRef.current?.focus({ preventScroll: true });
    } else if (lastSelection.current) {
      const name = POLICIES[lastSelection.current].name;
      Array.from(
        bodyRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      )
        .find((button) =>
          button.getAttribute("aria-label")?.startsWith(`${name} ·`),
        )
        ?.focus({ preventScroll: true });
    }
  }, [bodyRef, embedded, selected]);
  React.useEffect(() => {
    if (embedded && !selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        embedded &&
        event.target instanceof Node &&
        !screenRef.current?.contains(event.target)
      ) {
        const otherTool =
          event.target instanceof Element &&
          event.target.closest("[data-game-tool]");
        if (otherTool || activeCard !== "PROGRAMS") return;
      }
      if (event.key === "Escape" && !manualOpen && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        if (embedded) setSelected(undefined);
        else onClose();
      }
    };
    // Foreground menus and dialogs consume Escape before it reaches the decision behind them.
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, manualOpen, embedded, selected, activeCard, setSelected]);
  // A docked overview may stay open while playing. Freeze time only while reviewing an
  // individual decision; the standalone screen retains its existing pause behavior.
  const reviewingDecision = !embedded || !!selected;
  React.useEffect(() => {
    if (!reviewingDecision) return;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token, reviewingDecision]);
  const snapshot = useEstimateSnapshot(game);
  const policiesOn = policyAvailable(game);
  const cash = currentCash(game);
  const effective = game.date.monthsElapsed + 1;
  const end = activeScenario(game)?.durationMonths ?? 0;
  const programs = game.policies?.programs ?? emptyPolicies().programs;
  const policy = selected;
  const current = policy ? programs[policy] : undefined;
  const buildout =
    policy && !isOperatingPolicy(policy) && !isFlexibilityPolicy(policy)
      ? (policy as BuildoutPolicyId)
      : undefined;
  // The estimate always shows the end of the program rather than its first month. For a
  // build-out that is its unpaused completion from next month (when a start or resume would
  // finish, or when a pause cuts off what would otherwise have finished then); an operating
  // offer has no end, so its first effective month. Either way it is capped at the run's last
  // month.
  const completion =
    policy && isFlexibilityPolicy(policy)
      ? effective +
        Math.max(
          0,
          Math.ceil((1 - current!.adoption) * flexibilityMonths(policy)) - 1,
        )
      : buildout
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
            ...(isOperatingPolicy(policy) || isFlexibilityPolicy(policy)
              ? { startHour }
              : {}),
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
  const operating = policy
    ? isOperatingPolicy(policy) || isFlexibilityPolicy(policy)
    : false;
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
      isOperatingPolicy(id) || isFlexibilityPolicy(id)
        ? (program.pending?.tier ?? "On")
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
  const title = selected ? POLICIES[selected].name : undefined;
  const content = (
    <>
      {!embedded && (
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
      )}
      <div
        ref={bodyRef}
        className="customerProgramsBody"
        role="region"
        aria-label={
          embedded
            ? title
              ? "Program details"
              : "Customer programs"
            : (title ?? "Programs")
        }
      >
        {!selected ? (
          <>
            {pricing}
            <ProgramList
              game={game}
              programs={programs}
              policiesOn={policiesOn}
              onOpen={open}
            />
          </>
        ) : (
          <Box className="customerProgramDetail">
            <Box className="customerProgramHeading">
              <Typography
                component="h2"
                variant="h6"
                tabIndex={-1}
                ref={headingRef}
              >
                {title}
              </Typography>
              <Typography
                component="span"
                variant="body2"
                className="customerProgramState"
              >
                {operating
                  ? current!.tier
                  : programStatus(game, selected, current!)}
              </Typography>
            </Box>
            <PolicyProgramDetail
              game={game}
              selected={selected}
              current={current!}
              buildout={buildout}
              complete={complete}
              cancelling={cancelling}
              effective={effective}
              end={end}
              month={month}
              tier={tier}
              startHour={startHour}
              onStartHourChange={setStartHour}
              result={result}
              error={error}
            />
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
          {policy &&
            operating &&
            current!.tier === "On" &&
            !current!.pending && (
              <Button
                variant={unchanged ? "contained" : "outlined"}
                disabled={effective >= end}
                onClick={() => {
                  dispatch(
                    schedulePolicy({
                      id: policy,
                      tier: "Off",
                      month: effective,
                      startHour,
                    }),
                  );
                  setSelected(undefined);
                }}
              >
                Turn off next month
              </Button>
            )}
          {!complete && (!operating || !unchanged) && (
            <Button
              variant="contained"
              disabled={
                // Undoing a scheduled change needs no estimate.
                (!cancelling && (unchanged || !result)) ||
                effective >= end ||
                (policy &&
                  isFlexibilityPolicy(policy) &&
                  tier === "On" &&
                  !flexibilityAvailable(game, policy, effective) &&
                  current!.adoption === 0)
              }
              onClick={() => {
                if (cancelling)
                  dispatch(cancelPolicy({ id: policy!, ...current!.pending! }));
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
    </>
  );
  return embedded ? (
    <div
      ref={screenRef}
      className="customerProgramsEmbedded"
      data-customer-programs="true"
      data-program-decision={selected ? "true" : undefined}
    >
      {content}
    </div>
  ) : (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      aria-labelledby="program-title"
      data-customer-programs="true"
      className="customerProgramsScreen"
    >
      {content}
    </Dialog>
  );
}
