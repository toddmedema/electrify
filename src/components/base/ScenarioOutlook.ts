import { MONTHS } from "../../Constants";
import { GameType, ScenarioType } from "../../Types";
import { MissionProjection } from "../../helpers/MissionProjection";
import {
  gameObjectiveResults,
  reliabilityThreshold,
  formatRequiredShare,
} from "../../helpers/ObjectiveRules";
import { objectiveValueText } from "../../helpers/ObjectivePresentation";
import { ProjectionView } from "../../helpers/Projection";
import {
  projectScore,
  ScoreProjectionType,
} from "../../helpers/ScoreProjection";

/** Before the first close, score the shared forecast rather than hiding the chart. */
export function scenarioScoreProjection(
  game: Pick<GameType, "monthlyHistory" | "startingYear" | "seed">,
  scenario: ScenarioType,
  forecast?: ProjectionView,
): ScoreProjectionType | null {
  const recorded = projectScore(
    scenario,
    game.monthlyHistory,
    game.startingYear,
    game.seed,
  );
  if (recorded) return recorded;
  if (!forecast?.financeProjected.length) return null;
  const estimated = projectScore(
    scenario,
    forecast.financeProjected.slice(0, scenario.durationMonths).reverse(),
    game.startingYear,
    game.seed,
  )!;
  return {
    actual: [0],
    projected: [...estimated.actual, ...estimated.projected],
    final: estimated.final,
  };
}

/** One dated failure list; the goal table continues to report recorded evidence. */
export function scenarioLossSummary(
  game: GameType,
  outlook: MissionProjection | undefined,
): { text: string; firstMonth?: number } {
  if (!outlook) return { text: "Updating forecast…" };
  const risks = outlook.requirements
    .filter(
      (row) =>
        row.required && (row.status === "at-risk" || row.status === "failed"),
    )
    .sort(
      (a, b) =>
        Number(b.status === "failed") - Number(a.status === "failed") ||
        (a.failureMonth ?? Infinity) - (b.failureMonth ?? Infinity),
    );
  if (!risks.length)
    return {
      text:
        outlook.status === "win" ? "Projected win." : "Forecast incomplete.",
    };
  const objectives = new Map(
    gameObjectiveResults(game).map((row) => [row.id, row]),
  );
  const descriptions = risks.map((risk) => {
    let phrase: string;
    const result = objectives.get(risk.id);
    if (risk.id === "cash") phrase = "Cash below $0";
    else if (risk.id === "survival")
      phrase = `Demand served <${formatRequiredShare(reliabilityThreshold(game.difficulty))} for 3 consecutive months`;
    else if (result) {
      const objective = result.objective;
      const target = objectiveValueText(objective, result.target);
      switch (objective.metric) {
        case "customerRetention":
          phrase = `Customers retained <${target}`;
          break;
        case "emissionsBudget":
          phrase = `Emissions >${target}`;
          break;
        case "emissionsPerDeliveredMWh":
          phrase = `Emissions intensity >${target}`;
          break;
        case "localFuelShare":
          phrase = `${objective.fuels.join("/")} share <${target}`;
          break;
        case "fuelRetirement":
          phrase = `${objective.fuel} still owned`;
          break;
        case "monthlyBilledRate":
          phrase = `Billed rate >${target}`;
          break;
        case "monthEndDebt":
          phrase = `Debt >${target}`;
          break;
      }
    } else phrase = risk.label;
    const month = risk.failureMonth;
    return month === undefined
      ? `${phrase}.`
      : `${phrase} at ${MONTHS[month % 12]} ${game.startingYear + Math.floor(month / 12)}.`;
  });
  const months = risks.flatMap((risk) =>
    risk.failureMonth === undefined ? [] : [risk.failureMonth],
  );
  return {
    text: descriptions.join(" "),
    firstMonth: months.length ? Math.min(...months) : game.date.monthsElapsed,
  };
}
