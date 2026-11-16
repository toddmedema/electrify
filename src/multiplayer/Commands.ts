import { isTerritoryTileId } from "../helpers/TerritoryTiles";
import { validPowerAgreementAction } from "../helpers/PowerAgreements";
import { isBuyingRule, isSellingRule } from "../helpers/TradingRules";
import { acquisitionQuote, validAcquisitionAction } from "../helpers/Expansion";
import { isTerritoryId } from "../data/Territories";
import {
  validLandPurchaseAction,
  landPurchaseQuote,
  hasTerritoryNetwork,
  territoryBuildAvailability,
} from "../helpers/Territories";
import { currentTick } from "../helpers/GameSelectors";
import { getBuildFacilityQuote } from "../data/Facilities";
import {
  validRetrofitFacility,
  validResilienceRecord,
} from "../helpers/BuildValidation";
import { withResilienceOptions } from "../helpers/Hazards";
import { validPolicyChange } from "../helpers/Policies";
import { validScenarioResponse } from "../helpers/ScenarioChoices";
import { isStorage } from "../Types";
import type { FacilityShoppingType, GameType } from "../Types";
import type { gameSlice } from "../reducers/Game";
import type * as GameActions from "../reducers/GameActions";

/** Real game action names, so renaming a reducer action fails type-checking here. */
type GameActionName = keyof typeof gameSlice.actions | keyof typeof GameActions;
type Validation = { error: string } | { payload: unknown };
type Validator = (game: GameType, payload: unknown) => Validation;

const facility: Validator = (game, payload) =>
  Number.isSafeInteger(payload) && game.facilities.some((f) => f.id === payload)
    ? { payload }
    : { error: "Plant not found" };

const line: Validator = (game, payload) =>
  !hasTerritoryNetwork(game) &&
  Number.isSafeInteger(payload) &&
  game.transmission?.lines.some((l) => l.id === payload)
    ? { payload }
    : { error: "Connection not found" };

const dispatchPosition =
  (length: (game: GameType) => number): Validator =>
  (game, payload) => {
    const move = payload as { spotInList?: number; delta?: number } | null;
    const size = length(game);
    return !move ||
      !Number.isSafeInteger(move.spotInList) ||
      !Number.isSafeInteger(move.delta) ||
      move.spotInList! < 0 ||
      move.spotInList! >= size ||
      Math.abs(move.delta!) >= size
      ? { error: "Choose a valid dispatch position" }
      : { payload };
  };

/** Co-op players can only build or upgrade their links to each other. */
const peerLine: Validator = (game, payload) => {
  const target = payload as { corridorId?: string; financed?: boolean };
  return hasTerritoryNetwork(game) ||
    !target ||
    !game.multiplayer?.peers?.some(
      (p) => p.corridor.id === target.corridorId,
    ) ||
    typeof target.financed !== "boolean"
    ? { error: "Choose another player's intertie" }
    : { payload };
};

/** Existing outside assets belong to one company; shared links still require both owners. */
const upgradeLine: Validator = (game, payload) => {
  const target = payload as { corridorId?: string; financed?: boolean } | null;
  return !hasTerritoryNetwork(game) &&
    target &&
    typeof target.financed === "boolean" &&
    game.transmission?.lines.some(
      (line) => line.corridorId === target.corridorId,
    )
    ? { payload }
    : { error: "Choose an owned connection" };
};

const policy: Validator = (_game, payload) =>
  validPolicyChange(payload) ? { payload } : { error: "Choose a valid policy" };

/** The host prices every build from its own catalog, never from the sender's quote. */
const buildFacility: Validator = (game, payload) => {
  const build = payload as {
    facility?: Partial<FacilityShoppingType>;
    financed?: boolean;
    territoryId?: unknown;
    tileId?: unknown;
  };
  if (!build || !build.facility || typeof build.financed !== "boolean")
    return { error: "That build is unavailable" };
  if (Object.prototype.hasOwnProperty.call(build, "operatingAreaId"))
    return {
      error: "Build for the company without an operating-area destination",
    };
  if (
    build.territoryId !== undefined &&
    (!hasTerritoryNetwork(game) || !isTerritoryId(build.territoryId))
  )
    return { error: "Choose a valid territory for this build" };
  const territoryId = isTerritoryId(build.territoryId)
    ? build.territoryId
    : "champlain";
  if (
    build.tileId !== undefined &&
    (!hasTerritoryNetwork(game) || !isTerritoryTileId(build.tileId, game))
  )
    return { error: "Choose a valid tile for this build" };
  const tileId = isTerritoryTileId(build.tileId, game)
    ? build.tileId
    : undefined;
  const requested = build.facility;
  const size = requested.peakWh ?? requested.peakW;
  if (
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 1e12
  )
    return { error: "Choose a valid facility size" };
  let quote = getBuildFacilityQuote(
    game,
    { ...requested, resilience: undefined },
    territoryId,
    tileId,
  );
  if (!quote) return { error: "That build is unavailable" };
  if (!validResilienceRecord(quote.fuel, requested.resilience))
    return { error: "Choose valid facility options" };
  if (!isStorage(quote) && requested.resilience)
    quote = withResilienceOptions(quote, game, requested.resilience);
  let selectedTileId = tileId;
  if (hasTerritoryNetwork(game)) {
    const availability = territoryBuildAvailability(
      game,
      quote,
      territoryId,
      tileId,
    );
    if (!availability.buildable)
      return {
        error: availability.reason ?? "That territory cannot host this build",
      };
    selectedTileId = availability.tileId;
  }
  return {
    payload: {
      facility: quote,
      financed: build.financed,
      ...(hasTerritoryNetwork(game)
        ? { territoryId, tileId: selectedTileId }
        : {}),
    },
  };
};

/** The co-op allowlist: every game action a player may send, with its payload check. */
const GAME_COMMAND_VALIDATORS = {
  acquireLand: (game, payload) =>
    validLandPurchaseAction(game, payload) &&
    (currentTick(game)?.cash ?? -1) >=
      landPurchaseQuote(game, payload.territoryId)!.price
      ? { payload }
      : { error: "This land purchase is unavailable or unaffordable" },
  acceptPowerAgreement: (game, payload) =>
    validPowerAgreementAction(game, payload)
      ? { payload }
      : { error: "This agreement quote has changed. Review it again." },
  acquireUtility: (game, payload) => {
    if (!validAcquisitionAction(payload))
      return { error: "Choose a valid acquisition" };
    const quote = acquisitionQuote(game, payload.targetId);
    if (!quote || quote.quoteKey !== payload.quoteKey)
      return { error: "This acquisition quote has changed. Review it again." };
    const due = payload.financed ? quote.financedCashDue : quote.cashDue;
    return (currentTick(game)?.cash ?? -1) >= due
      ? { payload }
      : { error: "Not enough cash for this acquisition" };
  },
  buildFacility,
  sellFacility: facility,
  togglePauseFacility: facility,
  reprioritizeFacility: dispatchPosition((game) => game.facilities.length),
  retrofitFacility: (_game, payload) =>
    validRetrofitFacility(payload)
      ? { payload }
      : { error: "Choose a valid facility upgrade" },
  cancelRetrofit: facility,
  buildTransmissionLine: peerLine,
  upgradeTransmissionLine: upgradeLine,
  cancelTransmissionLine: line,
  togglePauseTransmissionLine: line,
  reprioritizeTransmissionLine: dispatchPosition(
    (game) => game.transmission?.lines.length ?? 0,
  ),
  setBuyingRule: (_game, payload) =>
    isBuyingRule(payload)
      ? { payload }
      : { error: "Choose a valid buying rule" },
  setSellingRule: (_game, payload) =>
    isSellingRule(payload)
      ? { payload }
      : { error: "Choose a valid selling rule" },
  schedulePolicy: policy,
  cancelPolicy: policy,
  chooseScenarioResponse: (_game, payload) =>
    validScenarioResponse(payload)
      ? { payload }
      : { error: "Choose a valid response" },
} satisfies Partial<Record<GameActionName, Validator>>;

export type GameCommandName = keyof typeof GAME_COMMAND_VALIDATORS;
export const GAME_COMMANDS: ReadonlySet<string> = new Set(
  Object.keys(GAME_COMMAND_VALIDATORS),
);
export const isGameCommand = (name: string): name is GameCommandName =>
  GAME_COMMANDS.has(name);

/** Check a player's payload against their own grid; accepted payloads may be normalized. */
export function validateGameCommand(
  game: GameType,
  name: GameCommandName,
  payload: unknown,
): Validation {
  return GAME_COMMAND_VALIDATORS[name](game, payload);
}
