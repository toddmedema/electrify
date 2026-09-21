import {
  EvidenceTargetType,
  GameType,
  MonthlyHistoryType,
  TickPresentFutureType,
} from "../Types";
import { getScenario } from "../data/Scenarios";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "./DateTime";
import {
  absoluteMonth,
  demandServed,
  reliabilityMonths,
  hasChronicBlackouts,
} from "./ObjectiveRules";
import {
  meaningfulDecisionCategoryCount,
  meaningfulDecisionRequirement,
} from "./MeaningfulDecisions";
import type { UpcomingStoryEventType } from "../components/views/StoryEventSelectors";
import { TICK_MINUTES } from "../Constants";
import { formatMoneyConcise } from "./Format";
import { selectProjection } from "./Projection";

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
}

// A month that fell a hair short must never print as a whole "100%": the reliability
// objective can require exactly 100% served, and a rounded-up reading would contradict the
// FAILED chip beside it. Rounding down keeps the number on the honest side of the threshold.
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

/** Presentation only: missing evidence never changes the canonical end-of-term evaluator. */
export function getMissionStatus(game: GameType) {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const duration = scenario?.durationMonths || 240;
  const monthsRemaining = Math.max(0, duration - game.date.monthsElapsed);
  const end = game.startingYear * 12 + duration;
  const currentMonth = absoluteMonth(game.date.year, game.date.monthNumber);
  const history = completedMissionHistory(game);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const requirements: MissionRequirement[] = [];
  const objective = scenario?.reliabilityObjective;
  if (objective) {
    const first = absoluteMonth(objective.year, objective.month);
    const count = objective.durationMonths || 1;
    const rows = reliabilityMonths(scenario!, history);
    const observed = new Set(
      rows.map((row) => absoluteMonth(row.year, row.month)),
    ).size;
    const elapsed = Math.max(0, Math.min(count, currentMonth - first));
    const missing = observed < elapsed;
    const failed = rows.some(
      (row) => demandServed(row) < objective.minimumDemandServed,
    );
    const minimum = rows.length
      ? Math.min(...rows.map(demandServed))
      : undefined;
    requirements.push({
      id: "reliability",
      label: objective.label,
      compact: `Demand served ≥ ${Math.round(objective.minimumDemandServed * 100)}% (${minimum === undefined ? "pending" : formatServed(minimum)})${missing || (monthsRemaining === 0 && observed < count) ? " · incomplete history" : ""}`,
      current:
        (minimum === undefined
          ? "No completed event months"
          : `Lowest ${formatServed(minimum)} · ${observed} of ${count} months counted`) +
        (missing || (monthsRemaining === 0 && observed < count)
          ? " · history incomplete, not verifiable"
          : ""),
      target: `Every required month needs ${Math.round(objective.minimumDemandServed * 100)}% served`,
      timing: `Completed months ${objective.month}/${objective.year}–${((first + count - 1) % 12) + 1}/${Math.floor((first + count - 1) / 12)}; checked at term end`,
      status: missing
        ? "unknown"
        : failed
          ? "failed"
          : currentMonth < first
            ? "pending"
            : observed === count
              ? "completed"
              : monthsRemaining === 0
                ? "unknown"
                : "in-progress",
      deadline: first + count,
    });
  }
  if (
    scenario?.minimumCustomerRetention !== undefined &&
    scenario.startingCustomers !== undefined
  ) {
    const threshold =
      scenario.startingCustomers * scenario.minimumCustomerRetention;
    requirements.push({
      id: "retention",
      label: "Retain the community",
      compact: `Customers ≥ ${Math.ceil(threshold).toLocaleString()} (${now ? Math.round(now.customers).toLocaleString() : "unavailable"})`,
      current: now
        ? `${Math.round(now.customers).toLocaleString()} current customers`
        : "Current customers unavailable",
      target: `Keep ${Math.ceil(threshold).toLocaleString()} customers · ${Math.round(scenario.minimumCustomerRetention * 100)}% of where you started`,
      timing: "Required at term end; current customers can still change",
      status: now ? "in-progress" : "unknown",
      deadline: end,
    });
  }
  const gate = meaningfulDecisionRequirement(game.difficulty);
  if (gate && !scenario?.tutorialSteps) {
    requirements.push({
      id: "decisions",
      label: "Meaningful decisions",
      compact: `Decisions ≥ ${gate.count} (${game.meaningfulDecisions.length}) · Categories ≥ ${gate.categories} (${meaningfulDecisionCategoryCount(game.meaningfulDecisions)})`,
      current: `${game.meaningfulDecisions.length} decisions across ${meaningfulDecisionCategoryCount(game.meaningfulDecisions)} categories`,
      target: `Needs ${gate.count} decisions across ${gate.categories} categories; reverting one removes it`,
      timing: "Required at term end",
      status: game.meaningfulDecisionGateWaived ? "waived" : "in-progress",
      deadline: end,
    });
  }
  requirements.push({
    id: "cash",
    label: "Keep the utility solvent",
    compact: `Cash ≥ $0 (${now ? formatMoneyConcise(now.cash) : "unavailable"})`,
    current: now
      ? `$${Math.round(now.cash).toLocaleString()} now (partial month)`
      : "Current cash unavailable",
    target: "Cash must be $0 or more at every month-end",
    timing:
      "Checked at month end; negative cash now is a warning, not a final outcome",
    status: "in-progress",
    deadline: currentMonth + 1,
  });
  const latest = history.slice(0, 3);
  const consecutive =
    latest.length === 3 &&
    latest.every(
      (row, index) =>
        absoluteMonth(row.year, row.month) === currentMonth - index - 1,
    );
  requirements.push({
    id: "survival",
    label: "Avoid chronic blackouts",
    compact: `Avoid 3 consecutive months < 90% served (${
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
    target: "Ends if under 90% served 3 months in a row",
    timing:
      "Checked at month end; current ticks are not completed-month results",
    status: consecutive
      ? hasChronicBlackouts(latest)
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
        Number(b.item.status === "failed") -
          Number(a.item.status === "failed") ||
        a.item.deadline - b.item.deadline ||
        a.index - b.index,
    )[0]?.item;
  return {
    label: scenario?.name || "Custom game",
    requirements,
    prominent,
    headline:
      requirements.find((item) => item.id === "reliability") ||
      requirements.find((item) => item.id === "retention") ||
      prominent,
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
/** Scan the existing operating sample only; no long-range forecast generation. */
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

// Warn about insolvency this far ahead. A projection that stays solvent to the horizon is quiet.
const CASH_RUNWAY_WARNING_MONTHS = 12;

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
 * on hand before being read: a month's drift since the projection was built is carried along
 * with them.
 */
export function cashRunwayMonths(game: GameType): number | undefined {
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  // Negative cash now has its own, more urgent warning; this one is about the months ahead
  if (!now || now.cash < 0) return undefined;
  const projection = selectProjection(game, now);
  const anchor = now.cash - projection.startingCash;
  for (let i = 0; i < projection.financeProjected.length; i++) {
    if (projection.financeProjected[i].cash + anchor < 0) {
      return i + 1;
    }
  }
  return undefined;
}

export function selectMissionRisk(
  game: GameType,
  upcoming: UpcomingStoryEventType[] = [],
): MissionRisk | undefined {
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
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
  const mission = getMissionStatus(game);
  if (
    mission.requirements.some(
      (row) => row.id === "reliability" && row.status === "failed",
    )
  )
    return {
      id: "reliability",
      label: "Required reliability window missed · All requirements",
      shortLabel: "Reliability missed",
      target: "mission-details",
    };
  const runway = cashRunwayMonths(game);
  if (
    runway !== undefined &&
    runway <= CASH_RUNWAY_WARNING_MONTHS &&
    runway < mission.monthsRemaining
  ) {
    const months = Math.max(1, Math.round(runway));
    return {
      id: "cash-runway",
      label: `Projected cash runs out in about ${months} ${months === 1 ? "month" : "months"} · Check finances`,
      shortLabel: `Cash out in ~${months} mo`,
      target: "finances",
    };
  }
  const projected = projectedShortfall(game.timeline, game.date.minute);
  if (projected)
    return {
      id: `projection:${game.date.year}:${game.date.monthNumber}`,
      label: "Shortfall expected later today · View supply and demand",
      shortLabel: "Projected shortfall",
      target: "supply-demand",
    };
  const event = upcoming
    .filter(
      (event) =>
        event.actionTarget &&
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
      target: event.actionTarget!,
    };
  return undefined;
}
