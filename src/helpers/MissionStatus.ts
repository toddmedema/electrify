import { activeScenario, currentTick } from "./GameSelectors";
import {
  EvidenceTargetType,
  GameType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "./DateTime";
import {
  absoluteMonth,
  demandServed,
  formatRequiredShare,
  hasChronicBlackouts,
  reliabilityThreshold,
  reliabilityRuleText,
  gameObjectiveResults,
} from "./ObjectiveRules";
import type { UpcomingStoryEventType } from "../components/views/StoryEventSelectors";
import { TICK_MINUTES } from "../Constants";
import { formatMoneyStable } from "./Format";
import { selectProjection } from "./Projection";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import {
  objectiveObservedText,
  objectiveTargetText,
  objectiveValueText,
  objectiveWindowText,
} from "./ObjectivePresentation";

export interface MissionRequirement {
  id: string;
  label: string;
  current: string;
  target: string;
  compact: string;
  timing: string;
  status:
    "pending" | "in-progress" | "completed" | "failed" | "unknown" | "waived";
  deadline: number;
  definition?: string;
  required?: boolean;
  reason?: string;
}

// Keep displayed monthly service on the honest side of the failure threshold.
function formatServed(fraction: number): string {
  const floored = Math.floor(fraction * 1000) / 10;
  return Number.isInteger(floored) ? `${floored}%` : `${floored.toFixed(1)}%`;
}

export function completedMissionHistory(game: GameType): MonthlyHistoryType[] {
  const current = absoluteMonth(game.date.year, game.date.monthNumber);
  return game.monthlyHistory
    .filter((row) => absoluteMonth(row.year, row.month) < current)
    .slice()
    .sort(
      (a, b) => absoluteMonth(b.year, b.month) - absoluteMonth(a.year, a.month),
    );
}

/** A presentation adapter for the canonical verdict, never another measurement or judgment. */
function objectiveRequirement(
  result: ObjectiveResult,
  startingYear: number,
  durationMonths: number,
): MissionRequirement {
  const objective = result.objective;
  const last =
    "throughMonth" in objective
      ? objective.throughMonth
      : objective.metric === "fuelRetirement"
        ? durationMonths - 1
        : objective.deadlineMonth;
  const first =
    "fromMonth" in objective ? objective.fromMonth : objective.deadlineMonth;
  const statuses = {
    pending: "pending",
    inProgress: "in-progress",
    completed: "completed",
    failed: "failed",
    unverifiable: "unknown",
  } as const;
  const target = objectiveTargetText(objective);
  const current = objectiveObservedText(result);
  const window = objectiveWindowText(objective, startingYear, durationMonths);
  const observed =
    result.observed === undefined
      ? "pending"
      : objectiveValueText(objective, result.observed, result.target);
  const compact = `${target} (${observed})`;
  return {
    id: result.id,
    label: result.label,
    definition: result.definition,
    required: result.required,
    reason: result.reason,
    current,
    target: `${target} · ${window}`,
    compact: `${result.required ? "" : "Optional · "}${compact}${result.status === "unverifiable" ? " · incomplete history" : ""}`,
    timing: `Completed months ${(first % 12) + 1}/${startingYear + Math.floor(first / 12)}–${(last % 12) + 1}/${startingYear + Math.floor(last / 12)}${result.required ? "" : "; optional, does not end the run"}`,
    status: statuses[result.status],
    deadline: startingYear * 12 + last + 1,
  };
}

/** Objectives render the same completed-month verdict used by live and headless termination. */
export function getMissionStatus(game: GameType) {
  const scenario = activeScenario(game);
  const duration = scenario?.durationMonths || 240;
  const monthsRemaining = Math.max(0, duration - game.date.monthsElapsed);
  const currentMonth = absoluteMonth(game.date.year, game.date.monthNumber);
  const history = completedMissionHistory(game);
  const now = currentTick(game);
  const requirements: MissionRequirement[] = gameObjectiveResults(game).map(
    (result) => objectiveRequirement(result, game.startingYear, duration),
  );
  requirements.push({
    id: "cash",
    label: "Keep the utility solvent",
    compact: `Cash ≥ $0 (${now ? formatMoneyStable(now.cash) : "unavailable"})`,
    current: now
      ? `${formatMoneyStable(now.cash)} now`
      : "Current cash unavailable",
    target: "Cash ≥$0 at every month-end",
    timing:
      "Checked at month end; negative cash now is a warning, not a final outcome",
    status: "in-progress",
    deadline: currentMonth + 1,
  });
  const latest = history.slice(0, 3);
  const firingThreshold = formatRequiredShare(
    reliabilityThreshold(game.difficulty),
  );
  const consecutive =
    latest.length === 3 &&
    latest.every(
      (row, index) =>
        absoluteMonth(row.year, row.month) === currentMonth - index - 1,
    );
  requirements.push({
    id: "survival",
    label: "Keep power flowing",
    compact: `Avoid 3 consecutive months < ${firingThreshold} served (${
      latest.length
        ? latest
            .slice()
            .reverse()
            .map((row) => formatServed(demandServed(row)))
            .join(", ")
        : "no completed months"
    })`,
    current: latest.length
      ? `Last ${latest.length === 1 ? "month" : `${latest.length} months`}: ${latest
          .slice()
          .reverse()
          .map((row) => formatServed(demandServed(row)))
          .join(" · ")}`
      : "No completed months",
    target: reliabilityRuleText(game.difficulty),
    timing:
      "Checked at month end; current ticks are not completed-month results",
    status: consecutive
      ? hasChronicBlackouts(latest, game.difficulty)
        ? "failed"
        : "in-progress"
      : "unknown",
    deadline: currentMonth + 1,
  });
  const prominent = requirements
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => item.status !== "completed" && item.status !== "waived",
    )
    .sort(
      (a, b) =>
        Number(b.item.status === "failed" && b.item.required !== false) -
          Number(a.item.status === "failed" && a.item.required !== false) ||
        Number(a.item.required === false) - Number(b.item.required === false) ||
        a.item.deadline - b.item.deadline ||
        a.index - b.index,
    )[0]?.item;
  const authored = requirements.filter(
    (item) => item.required && item.definition,
  );
  const nextAuthored = authored
    .filter((item) => item.status !== "completed" && item.status !== "waived")
    .sort((a, b) => a.deadline - b.deadline)[0];
  return {
    label: scenario?.name || "Custom game",
    requirements,
    prominent,
    headline: nextAuthored || authored[0] || prominent,
    monthsRemaining,
    finalNote:
      monthsRemaining === 0
        ? "Term complete. The recorded final outcome is authoritative; missing history is not verifiable."
        : undefined,
    scoreNote:
      "Score contributions are separate from these victory and survival requirements.",
  };
}

export interface MissionRisk {
  id: string;
  label: string;
  shortLabel: string;
  target: EvidenceTargetType;
}
const scanCache = new WeakMap<
  TickPresentFutureType[],
  { minute: number; result: TickPresentFutureType | undefined }
>();
/**
 * The first tick later in this month's operating sample where supply falls short of demand.
 * Scans the existing sample only; no long-range forecast generation.
 */
export function projectedShortfall(
  timeline: TickPresentFutureType[],
  minute: number,
): TickPresentFutureType | undefined {
  const cached = scanCache.get(timeline);
  if (cached?.minute === minute) return cached.result;
  const end = (Math.floor(minute / MINUTES_PER_MONTH) + 1) * MINUTES_PER_MONTH;
  const result = timeline.find(
    (tick) =>
      tick.minute > minute && tick.minute < end && tick.supplyW < tick.demandW,
  );
  scanCache.set(timeline, { minute, result });
  return result;
}

/**
 * Whole months until the projected cash first falls below zero; undefined when it never does.
 *
 * Judged from the forward projection Insights already runs rather than from the average of the
 * recent completed months. The average is what a single down payment, a restoration bill or a
 * seasonal swing looked like, and it took months of history before a rate change moved it. The
 * projection answers the question that is actually being asked -- where does the cash sit in
 * month six, given the rates, prices and fleet in force? -- and it already reflects a new rate
 * in the same call that sets one.
 *
 * The projected months start where the simulation started, so they are anchored to the balance
 * on hand before being read. Only deviations from the original within-month cash path are
 * carried along; ordinary operating cash flow is already included in the projected balances.
 */
export function cashRunwayMonths(game: GameType): number | undefined {
  const now = currentTick(game);
  // Negative cash now has its own, more urgent warning; this one is about the months ahead
  if (!now || now.cash < 0) return undefined;
  const projection = selectProjection(game, now);
  const expectedCash =
    getTimeFromTimeline(game.date.minute, projection.cashBaseline)?.cash ??
    projection.startingCash;
  const anchor = now.cash - expectedCash;
  for (let i = 0; i < projection.cashProjected.length; i++) {
    if (projection.cashProjected[i].cash + anchor < 0) {
      return i + 1;
    }
  }
  return undefined;
}

export function selectMissionRisk(
  game: GameType,
  upcoming: UpcomingStoryEventType[] = [],
  suppliedStatus?: ReturnType<typeof getMissionStatus>,
): MissionRisk | undefined {
  const now = currentTick(game);
  if (
    now &&
    now.minute <= game.date.minute &&
    game.date.minute - now.minute < TICK_MINUTES
  ) {
    if (now.supplyW < now.demandW)
      return {
        id: "shortage",
        label: "Now: supply is below demand · View supply and demand",
        shortLabel: "Supply & demand",
        target: "supply-demand",
      };
    if (now.cash < 0)
      return {
        id: "cash",
        label: "Now: cash is negative · Check finances before month end",
        shortLabel: "Check finances",
        target: "finances",
      };
  }
  const mission = suppliedStatus ?? getMissionStatus(game);
  const missed = mission.requirements.find(
    (row) =>
      row.required !== false && row.status === "failed" && row.definition,
  );
  if (missed)
    return {
      id: `objective:${missed.id}`,
      label: `${missed.label} missed · Scenario`,
      shortLabel: "Objective missed",
      target: "mission-details",
    };
  // A shortage later in today's operating sample is reported by the grid readout beside this
  // (see getGridHealth), the same way a shortage happening now is.
  const runway = cashRunwayMonths(game);
  if (runway !== undefined) {
    const months = Math.max(1, Math.round(runway));
    return {
      id: "cash-runway",
      label: `Projected cash runs out in about ${months} ${months === 1 ? "month" : "months"} · Check finances`,
      shortLabel: `Cash out in ~${months} mo`,
      target: "finances",
    };
  }
  const event = upcoming
    .filter(
      (event) =>
        event.startsMinute !== undefined &&
        event.startsMinute > game.date.minute,
    )
    .slice()
    .sort(
      (a, b) => a.startsMinute! - b.startsMinute! || a.key.localeCompare(b.key),
    )[0];
  if (event)
    return {
      id: `event:${event.key}`,
      label: `Announced event: ${event.title || event.label}`,
      shortLabel: `Upcoming: ${event.title || event.label}`,
      target: { card: "INSIGHTS", eventKey: event.key },
    };
  return undefined;
}
