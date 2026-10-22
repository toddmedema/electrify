import cloneDeep from "lodash.clonedeep";
import type { UnknownAction } from "@reduxjs/toolkit";
import { TICK_MINUTES } from "../Constants";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { getScenario } from "../data/Scenarios";
import { copyCommitmentMetadata } from "../helpers/Commitment";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import {
  optionalScenarioChoice,
  pendingScenarioChoice,
} from "../helpers/ScenarioChoices";
import gameReducer, {
  buildFacility,
  buildTransmissionLine,
  delta,
  hasChronicBlackouts,
  reprioritizeFacility,
  sellFacility,
  setTradingPolicy,
  tickState,
  togglePauseFacility,
  upgradeTransmissionLine,
} from "../reducers/Game";
import {
  chooseScenarioResponse,
  schedulePolicy,
} from "../reducers/GameActions";
import type { GameType } from "../Types";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import {
  checkMonth,
  checkWeatherHazards,
  InvariantCollector,
} from "./Invariants";
import {
  createGame,
  type InitialBuildType,
  type ScheduledSimActionType,
} from "./Simulator";

export const OFFICIAL_EXECUTION_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];

/** The existing live tick fixture preserves private commitment metadata while detaching state. */
export function copyOfficialGame(game: GameType): GameType {
  const copy = cloneDeep(game);
  game.timeline.forEach((frame, index) =>
    copyCommitmentMetadata(frame, copy.timeline[index]),
  );
  return copy;
}
export function officialCommand(
  game: GameType,
  action: UnknownAction,
): GameType {
  return copyOfficialGame(gameReducer(game, action));
}
export function officialQuote(game: GameType, build: InitialBuildType) {
  const quotes =
    build.peakWh !== undefined
      ? STORAGE(game, build.peakWh)
      : GENERATORS(
          game,
          build.peakW,
          game.timeline.map((frame) => frame.windKph),
          game.timeline.map((frame) => frame.solarIrradianceWM2),
          game.timeline
            .map((frame) => frame.windOffshoreKph)
            .filter((wind): wind is number => wind !== undefined),
          game.timeline.map((frame) => frame.windAirborneKph),
        );
  const quote = quotes.find(
    (item) => item.available && item.name === build.name,
  );
  if (!quote)
    throw new Error(
      `No legal ${build.name} quote in official ${game.scenarioId}`,
    );
  return quote;
}
function applyScheduled(
  game: GameType,
  action: ScheduledSimActionType,
): GameType {
  switch (action.type) {
    case "rate":
      return officialCommand(
        game,
        delta({ dollarsPerkWh: action.dollarsPerkWh }),
      );
    case "build":
      return officialCommand(
        game,
        buildFacility({
          facility: officialQuote(game, action.build),
          financed: action.build.financed,
        }),
      );
    case "sell":
      return officialCommand(game, sellFacility(action.facilityId));
    case "toggle":
      return officialCommand(game, togglePauseFacility(action.facilityId));
    case "reprioritize": {
      const spotInList = game.facilities.findIndex(
        (item) => item.id === action.facilityId,
      );
      return officialCommand(
        game,
        reprioritizeFacility({ spotInList, delta: spotInList === 0 ? 1 : -1 }),
      );
    }
    case "policy":
      return officialCommand(
        game,
        schedulePolicy({
          id: action.id,
          tier: action.tier,
          month: action.month + 1,
        }),
      );
    case "trading":
      return officialCommand(game, setTradingPolicy(action.policy));
    case "intertie":
      return officialCommand(
        game,
        buildTransmissionLine({
          corridorId: action.corridorId,
          financed: action.financed,
          tier: action.tier,
        }),
      );
    case "intertie-upgrade":
      return officialCommand(
        game,
        upgradeTransmissionLine({
          corridorId: action.corridorId,
          financed: action.financed,
        }),
      );
  }
}
export interface OfficialExecutionObserver {
  beforeTick?: (game: GameType, nextMinute: number) => void;
  monthClose?: (game: GameType) => void;
  choice?: (game: GameType, phase: "pending" | "answered", id: string) => void;
  throughMonth?: number;
}

/** Executes the unchanged balanced CEO commitments through real reducer APIs, never a second
 * economic model. Observers can inspect reached states without editing clock, history or goals. */
export function playOfficialExecution(
  scenarioId: number,
  observer: OfficialExecutionObserver = {},
) {
  const scenario = getScenario(scenarioId)!;
  const plan = STANDARD_BALANCE_PLAYS[scenarioId];
  let game = createGame({
    ...plan,
    scenarioId,
    difficulty: "CEO",
    seed: 12345,
  });
  const collector = new InvariantCollector();
  const applyMonth = () => {
    for (const action of plan.scheduledActions ?? [])
      if (action.month === game.date.monthsElapsed)
        game = applyScheduled(game, action);
  };
  applyMonth();
  let offeredMonth = -1;
  const throughMonth = observer.throughMonth ?? scenario.durationMonths;
  while (game.date.monthsElapsed < throughMonth) {
    const pending = pendingScenarioChoice(game);
    if (pending) {
      observer.choice?.(game, "pending", pending.id);
      const requested = plan.scenarioResponses?.[pending.id];
      const difficulty = game.difficulty;
      const option = pending.options.find((item) =>
        requested ? item.id === requested : item.cost(difficulty) === 0,
      );
      if (!option)
        throw new Error(`No explicit or free response to ${pending.id}`);
      game = officialCommand(
        game,
        chooseScenarioResponse({ decisionId: pending.id, optionId: option.id }),
      );
      if (pendingScenarioChoice(game)?.id === pending.id)
        throw new Error(`Rejected response ${pending.id}/${option.id}`);
      observer.choice?.(game, "answered", pending.id);
    }
    const offer =
      offeredMonth === game.date.monthsElapsed
        ? undefined
        : optionalScenarioChoice(game);
    offeredMonth = game.date.monthsElapsed;
    const option = offer?.options.find(
      (item) => item.id === plan.scenarioResponses?.[offer.id],
    );
    if (offer && option)
      game = officialCommand(
        game,
        chooseScenarioResponse({ decisionId: offer.id, optionId: option.id }),
      );
    const month = game.date.monthsElapsed;
    observer.beforeTick?.(game, game.date.minute + TICK_MINUTES);
    tickState(game);
    if (game.date.monthsElapsed === month) continue;
    checkMonth(
      collector,
      game.monthlyHistory[0],
      `official ${scenarioId} month ${game.date.monthsElapsed}`,
    );
    checkWeatherHazards(
      collector,
      game,
      `official ${scenarioId} month ${game.date.monthsElapsed}`,
    );
    const failure = gameObjectiveResults(game).find(
      (result) => result.required && result.status === "failed",
    );
    if (
      (currentTick(game)?.cash ?? -1) < 0 ||
      hasChronicBlackouts(game.monthlyHistory, game.difficulty) ||
      failure
    )
      throw new Error(
        `Official ${scenarioId} route ended at month ${game.date.monthsElapsed}: ${failure?.reason ?? "economic failure"}`,
      );
    observer.monthClose?.(game);
    if (
      plan.sellFacilityId !== undefined &&
      plan.sellAtMonth === game.date.monthsElapsed
    )
      game = officialCommand(game, sellFacility(plan.sellFacilityId));
    if (game.date.monthsElapsed < throughMonth) applyMonth();
  }
  return { game, violations: collector.getViolations() };
}
