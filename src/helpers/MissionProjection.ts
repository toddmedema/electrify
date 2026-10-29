import { MONTHS } from "../Constants";
import type {
  ObjectiveProgress,
  ObjectiveResult,
} from "../data/ScenarioObjectives";
import type { GameType, MonthlyHistoryType } from "../Types";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "./DateTime";
import { formatMoneyConcise } from "./Format";
import { activeScenario, currentTick } from "./GameSelectors";
import { completedMissionHistory } from "./MissionStatus";
import {
  absoluteMonth,
  gameObjectiveProgress,
  gameObjectiveResults,
  hasChronicBlackouts,
  objectiveContextForGame,
  scenarioObjectiveDefinitions,
} from "./ObjectiveRules";
import {
  objectiveValueText,
  objectiveWindowText,
} from "./ObjectivePresentation";
import type { ProjectionView } from "./Projection";
import {
  evaluateScenarioObjectives,
  objectiveTargetMet,
  recordObjectiveMonth,
} from "./ScenarioObjectives";

export interface RequirementProjection {
  id: string;
  label: string;
  required: boolean;
  status: "on-track" | "at-risk" | "unavailable" | "completed" | "failed";
  detail: string;
  /** Zero-based first projected breach, for prioritizing the next decision. */
  failureMonth?: number;
}

export interface MissionProjection {
  status: "win" | "loss" | "unknown";
  requirements: RequirementProjection[];
  through: string;
}

const monthIndex = (row: MonthlyHistoryType, game: GameType) =>
  absoluteMonth(row.year, row.month) - game.startingYear * 12;
const monthLabel = (month: number, game: GameType) =>
  `${MONTHS[month % 12]} ${game.startingYear + Math.floor(month / 12)}`;

type ProjectedObjective = ObjectiveResult & { failureMonth?: number };

function firstFailureMonth(
  result: ObjectiveResult,
  progress: ObjectiveProgress,
): number | undefined {
  if (result.status !== "failed") return undefined;
  const objective = result.objective;
  if (objective.metric === "customerRetention") return objective.deadlineMonth;
  if (
    objective.metric === "localFuelShare" ||
    objective.metric === "emissionsPerDeliveredMWh"
  )
    return objective.throughMonth;
  let cumulative = 0;
  return progress.entries
    .find((row) => row.id === result.id)
    ?.observations.find(([, numerator, denominator]) => {
      if (numerator === null || denominator === null || denominator <= 0)
        return false;
      cumulative += numerator;
      return !objectiveTargetMet(
        objective,
        objective.metric === "emissionsBudget"
          ? cumulative
          : numerator / denominator,
      );
    })?.[0];
}

const cashText = (value: number) =>
  value < 0 ? `−${formatMoneyConcise(-value)}` : formatMoneyConcise(value);

const objectiveCache = new WeakMap<
  ProjectionView,
  {
    progress: GameType["objectiveProgress"];
    history: GameType["monthlyHistory"];
    results: ProjectedObjective[];
  }
>();

/** Extend recorded evidence privately and use the same evaluator as month-end termination. */
function projectedObjectives(
  game: GameType,
  projection: ProjectionView,
  months: MonthlyHistoryType[],
): ProjectedObjective[] {
  const cached = objectiveCache.get(projection);
  if (
    cached &&
    cached.progress === game.objectiveProgress &&
    cached.history === game.monthlyHistory
  )
    return cached.results;
  const scenario = activeScenario(game)!;
  const definitions = scenarioObjectiveDefinitions(scenario, game);
  const context = objectiveContextForGame(game, scenario);
  let progress = gameObjectiveProgress(game)!;
  const assets = new Map(
    projection.objectiveAssets?.map((row) => [row.month, row]),
  );
  for (const row of months) {
    const month = monthIndex(row, game);
    progress = recordObjectiveMonth(
      progress,
      definitions,
      {
        ...assets.get(month),
        month,
        history: row,
      },
      context,
    );
  }
  const results = evaluateScenarioObjectives(definitions, progress, {
    ...context,
    completedMonths: Math.max(
      context.completedMonths,
      ...months.map((row) => monthIndex(row, game) + 1),
    ),
  }).map((result) => ({
    ...result,
    failureMonth: firstFailureMonth(result, progress),
  }));
  objectiveCache.set(projection, {
    progress: game.objectiveProgress,
    history: game.monthlyHistory,
    results,
  });
  return results;
}

function objectiveDetail(result: ObjectiveResult, game: GameType): string {
  if (result.observed === undefined || result.status === "unverifiable")
    return "Forecast does not cover every required month or measurement.";
  const prefix =
    result.metric === "monthlyReliability"
      ? "Lowest demand served"
      : result.metric === "customerRetention"
        ? "Customers retained at deadline"
        : result.metric === "monthlyBilledRate"
          ? "Highest billed rate"
          : result.metric === "monthEndDebt"
            ? "Highest debt"
            : "Projected value";
  // An hourly estimate needs little precision, except when rounding would conceal a miss.
  const rounded = Number(result.observed.toPrecision(3));
  const shown =
    objectiveTargetMet(result.objective, rounded) ===
    objectiveTargetMet(result.objective, result.observed)
      ? rounded
      : result.observed;
  return `${prefix}: ${objectiveValueText(result.objective, shown, result.target)} · ${objectiveWindowText(result.objective, game.startingYear, activeScenario(game)!.durationMonths)}.`;
}

/** All required goals plus month-end bankruptcy and the rolling three-month blackout rule. */
export function projectMission(
  game: GameType,
  projection: ProjectionView,
): MissionProjection {
  const scenario = activeScenario(game)!;
  const elapsed = game.date.monthsElapsed;
  const end = scenario.durationMonths;
  // The last hourly bucket can end partway through a calendar month. Never treat it as a close.
  const lastTick = projection.forecast.at(-1);
  const completeThrough = lastTick
    ? Math.floor(
        (lastTick.minute + projection.projectionStepMinutes) /
          MINUTES_PER_MONTH,
      ) - 1
    : elapsed - 1;
  const months = projection.financeProjected.filter((row) => {
    const month = monthIndex(row, game);
    return month >= elapsed && month < end && month <= completeThrough;
  });
  const predicted = projectedObjectives(game, projection, months);
  const requirements: RequirementProjection[] = gameObjectiveResults(game).map(
    (actual) => {
      const forecast = predicted.find((result) => result.id === actual.id);
      const status =
        actual.status === "failed" || actual.status === "completed"
          ? actual.status
          : forecast?.status === "failed"
            ? "at-risk"
            : actual.status === "unverifiable"
              ? "unavailable"
              : forecast?.status === "completed"
                ? "on-track"
                : "unavailable";
      return {
        id: actual.id,
        label: actual.label,
        required: actual.required,
        status,
        failureMonth: forecast?.failureMonth,
        detail:
          status === "failed"
            ? "A recorded goal has already been missed."
            : status === "completed"
              ? "The required window is complete."
              : status === "unavailable" || !forecast
                ? "Forecast does not cover every required month or measurement."
                : objectiveDetail(forecast, game),
      };
    },
  );
  const contiguous = months.every(
    (row, index) => monthIndex(row, game) === elapsed + index,
  );
  const fullTerm = contiguous && months.length === end - elapsed;
  const now = currentTick(game);
  const expectedCash =
    getTimeFromTimeline(game.date.minute, projection.cashBaseline)?.cash ??
    projection.startingCash;
  const cashAnchor = now ? now.cash - expectedCash : NaN;
  const bankrupt = months.find((row) => row.cash + cashAnchor < 0);
  const cashKnown =
    Number.isFinite(cashAnchor) &&
    months.every((row) => Number.isFinite(row.cash));
  const lowestCash = Math.min(...months.map((row) => row.cash + cashAnchor));
  requirements.push({
    id: "cash",
    label: "Keep the utility solvent",
    required: true,
    failureMonth: bankrupt ? monthIndex(bankrupt, game) : undefined,
    status: bankrupt
      ? "at-risk"
      : fullTerm && cashKnown
        ? "on-track"
        : "unavailable",
    detail: bankrupt
      ? `Cash below $0 at ${monthLabel(monthIndex(bankrupt, game), game)} month-end (${cashText(bankrupt.cash + cashAnchor)}).`
      : fullTerm && cashKnown
        ? `Lowest month-end cash: ${cashText(lowestCash)}.`
        : "Forecast does not cover every remaining month-end.",
  });
  const history = completedMissionHistory(game);
  const recordedBlackout =
    history.length >= 3 &&
    history
      .slice(0, 3)
      .every((row, i) => monthIndex(row, game) === elapsed - i - 1) &&
    hasChronicBlackouts(history, game.difficulty);
  const recent = history.slice(0, 2);
  const historyKnown =
    recent.length === Math.min(2, elapsed) &&
    recent.every((row, i) => monthIndex(row, game) === elapsed - i - 1);
  let trailing = recent;
  let blackout: MonthlyHistoryType | undefined;
  for (const row of months) {
    trailing = [row, ...trailing].slice(0, 3);
    const consecutive = trailing.every(
      (month, i) => monthIndex(month, game) === monthIndex(row, game) - i,
    );
    if (consecutive && hasChronicBlackouts(trailing, game.difficulty)) {
      blackout = row;
      break;
    }
  }
  const reliabilityKnown = [...recent, ...months].every(
    (row) =>
      Number.isFinite(row.supplyWh) &&
      Number.isFinite(row.demandWh) &&
      row.supplyWh >= 0 &&
      row.demandWh >= 0,
  );
  requirements.push({
    id: "survival",
    label: "Avoid chronic blackouts",
    required: true,
    failureMonth: blackout ? monthIndex(blackout, game) : undefined,
    status: recordedBlackout
      ? "failed"
      : blackout
        ? "at-risk"
        : fullTerm && historyKnown && reliabilityKnown
          ? "on-track"
          : "unavailable",
    detail: recordedBlackout
      ? "Recorded blackouts already reached three consecutive months."
      : blackout
        ? `Three consecutive months below the service threshold by ${monthLabel(monthIndex(blackout, game), game)}.`
        : fullTerm && historyKnown && reliabilityKnown
          ? "No three-month blackout streak projected."
          : "Not enough monthly coverage to rule out a blackout streak.",
  });
  const required = requirements.filter((row) => row.required);
  return {
    status: required.some(
      (row) => row.status === "at-risk" || row.status === "failed",
    )
      ? "loss"
      : required.every(
            (row) => row.status === "on-track" || row.status === "completed",
          )
        ? "win"
        : "unknown",
    requirements,
    through: monthLabel(Math.min(end - 1, completeThrough), game),
  };
}
