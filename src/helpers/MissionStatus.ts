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

export interface MissionRequirement {
  id: string;
  label: string;
  current: string;
  target: string;
  timing: string;
  status:
    "pending" | "in-progress" | "completed" | "failed" | "unknown" | "waived";
  deadline: number;
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
      current:
        (minimum === undefined
          ? "No completed event months"
          : `${(minimum * 100).toFixed(2)}% minimum served · ${observed}/${count} completed months`) +
        (missing || (monthsRemaining === 0 && observed < count)
          ? " · Missing required history: not verifiable"
          : currentMonth >= first && currentMonth < first + count
            ? " · Current month is partial and not evaluated"
            : ""),
      target: `Serve at least ${Math.round(objective.minimumDemandServed * 100)}% of demand in each required month`,
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
      current: now
        ? `${Math.round(now.customers).toLocaleString()} current customers`
        : "Current customers unavailable",
      target: `At least ${Math.ceil(threshold).toLocaleString()} customers (${Math.round(scenario.minimumCustomerRetention * 100)}% of starting customers)`,
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
      current: `${game.meaningfulDecisions.length} retained decisions across ${meaningfulDecisionCategoryCount(game.meaningfulDecisions)} categories`,
      target: `${gate.count} decisions across ${gate.categories} categories; reverting a decision removes it`,
      timing: "Required at term end",
      status: game.meaningfulDecisionGateWaived ? "waived" : "in-progress",
      deadline: end,
    });
  }
  requirements.push({
    id: "cash",
    label: "Keep the utility solvent",
    current: now
      ? `$${Math.round(now.cash).toLocaleString()} now (partial month)`
      : "Current cash unavailable",
    target: "Cash must be at least $0 at each month-end check",
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
    current: latest.length
      ? latest
          .map(
            (row) =>
              `${row.month}/${row.year}: ${(demandServed(row) * 100).toFixed(1)}% served`,
          )
          .join(" · ")
      : "No completed months",
    target:
      "Supply below 90% of demand in each of the latest three completed months ends the term",
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
        target: "supply-demand",
      };
    if (now.cash < 0)
      return {
        id: "cash",
        label: "Now: cash is negative · Check finances before month end",
        target: "finances",
      };
  }
  if (
    getMissionStatus(game).requirements.some(
      (row) => row.id === "reliability" && row.status === "failed",
    )
  )
    return {
      id: "reliability",
      label: "Required reliability window missed · All requirements",
      target: "mission-details",
    };
  const projected = projectedShortfall(game.timeline, game.date.minute);
  if (projected)
    return {
      id: `projection:${game.date.year}:${game.date.monthNumber}`,
      label:
        "Projected in this month's representative day: supply shortfall · View supply and demand",
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
      target: event.actionTarget!,
    };
  return undefined;
}
