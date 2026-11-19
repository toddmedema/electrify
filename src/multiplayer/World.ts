import { upgradeSave } from "../SaveUpgrade";
import {
  getFacilityTile,
  hasTerritoryNetwork,
  getTerritoryTiles,
  legacyTerritoryTiles,
  createTerritoryTileOwnership,
  connectedPeerTerritoryTiles,
  getTerritoryTile,
  territoryVisibilityDistance,
  visibleTerritoryTiles,
  territoryHexDistance,
  isAdjacentToOwnedTerritoryTile,
} from "../helpers/TerritoryTiles";
import {
  territoryGameAtPurchase,
  type TerritoryPurchaseContext,
} from "../helpers/TerritoryValidation";
import { landPurchaseQuote } from "../helpers/Territories";
import { isLandTerritoryId } from "../data/Territories";
import { currencyForLocation } from "../helpers/Currency";
import { formatMoneyFull } from "../helpers/Format";
import { isUtilityExpansionGame } from "../helpers/ExpansionContext";
import {
  MULTIPLAYER_LINK_BUDGET_FRACTION,
  MULTIPLAYER_LINK_BUILD_COST_PER_W,
  MULTIPLAYER_LINK_OPERATING_COST_PER_W,
  MULTIPLAYER_MAX_ACTIVITY_REASON_LENGTH,
  PEER_CORRIDOR_DERATE,
  PEER_TRADE_MIN_PRICE_PER_MWH,
  edgeIdFromPeerCorridor,
  peerCorridorId,
  isPeerCorridorId,
} from "../data/Multiplayer";
import {
  copyCommitmentMetadata,
  serializeCommitmentMetadata,
  restoreCommitmentMetadata,
  validCommitmentMetadata,
} from "../helpers/Commitment";
import cloneDeep from "lodash.clonedeep";
import { DIFFICULTY_IDS, TICK_MINUTES, TICK_MS } from "../Constants";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  GameCommandName,
  isGameCommand,
  validateGameCommand,
} from "./Commands";
import { CUSTOM_SCENARIO_ID, getScenario } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { getScenarioLocation, isValidLocation } from "../helpers/Locations";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { MINUTES_PER_MONTH, summarizeHistory } from "../helpers/DateTime";
import {
  retainedWildfireFirebreaks,
  validTerritoryWeather,
} from "../helpers/TerritoryWildfire";
import { publicRateCap } from "../helpers/Customers";
import { storyHash } from "../data/WorldEvents";
import manifest from "../data/RunCompatibility.json";
import { selectWeatherLocation } from "../data/Weather";
import { currentTick } from "../helpers/GameSelectors";
import reducer, {
  basePeerTradePrice,
  delta,
  gameSlice,
  initGame,
  start,
  tickStatePhases,
  SharedImportClearing,
  upgradeTransmissionLine,
} from "../reducers/Game";
import * as gameActions from "../reducers/GameActions";
import { clearPeerMarket } from "./Market";
import { allocateIntertieFlows } from "../helpers/Transmission";
import type {
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "./Types";
import type {
  CompanyResultType,
  GameType,
  LocationType,
  PeerPlan,
  ScenarioType,
  SpeedType,
} from "../Types";
import { parseSave, serializeSave, validTransmissionLine } from "../SaveGame";
import { intertiesEnabledForScenario } from "../data/AdjacentMarkets";
import { accessContextForGame } from "../data/IntertieAccess";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";

export const RULES = manifest.multiplayerCompatibilityId;
export const EDGE_COST_PER_W = MULTIPLAYER_LINK_BUILD_COST_PER_W;
const SPEEDS: SpeedType[] = ["PAUSED", "SLOW", "NORMAL", "FAST", "ULTRA"];
const validSpeed = (value: unknown): value is SpeedType =>
  SPEEDS.includes(value as SpeedType);
const validActivityReason = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= MULTIPLAYER_MAX_ACTIVITY_REASON_LENGTH;
/** A company still playing: its run has not ended, so it shares the clock and the market. */
const isActive = (world: World, seatId: string) => !world.outcomes[seatId];
const activeSeats = (world: World) =>
  world.seats.filter((seat) => isActive(world, seat.id));
/** The match is over once every company's run has ended. */
const matchComplete = (world: World) => activeSeats(world).length === 0;
/** Every shared command names a real game action; Commands.ts holds the allowlist. */
const COMMAND_ACTIONS = { ...gameActions, ...gameSlice.actions };
const commandAction = (name: GameCommandName, payload: unknown) =>
  (COMMAND_ACTIONS[name] as (payload: unknown) => UnknownAction)(payload);

function markReady(world: World, sender: string, allowReady: boolean) {
  if (!allowReady) return "Wait for every player to reconnect";
  if (matchComplete(world)) return "This match is complete";
  if (!world.ready.includes(sender)) world.ready.push(sender);
  if (activeSeats(world).every((seat) => world.ready.includes(seat.id))) {
    world.readyRequired = false;
    world.ready = [];
  }
}

/** A safety stop needs fresh consent; ordinary player pauses preserve everyone's choice. */
export function pauseWorld(world: World, reason: string) {
  world.readyRequired = true;
  world.ready = [];
  world.reason = reason;
  syncClock(world);
}

// Shell lifecycle blockers are ephemeral; restoring a checkpoint requires fresh consent.
const shellBlockers = new WeakMap<World, readonly string[]>();
/** A detached snapshot of live shell blockers for replication baselines and state hashes. */
export function worldBlockers(world: World): string[] {
  return [...(shellBlockers.get(world) || [])];
}
/**
 * Copy ephemeral shell blockers into this world's clock calculation.
 * They remain outside persisted checkpoints so resume always obtains fresh consent.
 */
export function setWorldBlockers(world: World, reasons: readonly string[]) {
  shellBlockers.set(world, [...reasons]);
  syncClock(world);
}

/** Derive the effective clock from active companies, readiness, pending choices and shell blockers.
 * Retired companies cannot hold time; a running match uses the slowest remaining player request. */
function syncClock(world: World) {
  const active = activeSeats(world);
  const blockers = shellBlockers.get(world) || [];
  const pausedBy = active.filter(
    (seat) =>
      world.activities[seat.id] || world.selectedSpeeds[seat.id] === "PAUSED",
  );
  // A scenario choice stops the shared clock until each company still playing has answered.
  const choosing = active.filter((seat) =>
    pendingScenarioChoice(world.grids[world.seats.indexOf(seat)]),
  );
  world.speed =
    world.readyRequired ||
    blockers.length ||
    pausedBy.length ||
    choosing.length ||
    !active.length
      ? "PAUSED"
      : active.reduce<SpeedType>(
          (slowest, seat) =>
            TICK_MS[world.selectedSpeeds[seat.id]] > TICK_MS[slowest]
              ? world.selectedSpeeds[seat.id]
              : slowest,
          "ULTRA",
        );
  world.paused = world.speed === "PAUSED";
  if (!active.length) world.reason = "Match complete";
  else if (!world.readyRequired)
    world.reason = [
      ...blockers,
      ...choosing.map((seat) => `${seat.name}: Choosing a response`),
      ...pausedBy.map((seat) =>
        world.activities[seat.id]
          ? `${seat.name}: ${world.activities[seat.id]}`
          : `${seat.name} paused`,
      ),
    ].join(" · ");
}
function cloneGrid(game: GameType): GameType {
  const result = cloneDeep(game);
  game.timeline.forEach((tick, i) =>
    copyCommitmentMetadata(tick, result.timeline[i]),
  );
  return result;
}
function commandResult(before: GameType, after: GameType): GameType {
  const result = cloneGrid(after);
  const recorded = currentTick(before),
    updated = currentTick(result);
  // A build/slider reforecast estimates future human supply as zero. Keep the completed
  // shared tick's energy and settlement intact; immediate company transfers still book here.
  if (recorded && updated) {
    const { cash, netWorth } = updated;
    const ownership =
      before.customerMarketSize !== after.customerMarketSize ||
      before.utilityExpansion?.acquisitions.length !==
        after.utilityExpansion?.acquisitions.length
        ? {
            entitlementImportCapacityW: updated.entitlementImportCapacityW,
            customers: updated.customers,
          }
        : {};
    const previousReceipts = new Set(
      before.worldEvents.occurrences.map((event) => event.key),
    );
    // Reforecasting estimates customer sales and peer energy again, but a response's new
    // receipts are actual company transfers. Retain those transfers in the settled frame so
    // month-close revenue, affordability and expenses agree with its changed cash balance.
    const transfers = after.worldEvents.occurrences.reduce(
      (sum, event) => {
        if (
          previousReceipts.has(event.key) ||
          event.startsMinute !== after.date.minute ||
          (event.attributes.scenarioChoice !== true &&
            event.attributes.ruleEvent !== true)
        )
          return sum;
        sum.grant += Number(event.attributes.upfrontGrant ?? 0);
        sum.cost += Number(event.attributes.cost ?? 0);
        return sum;
      },
      { grant: 0, cost: 0 },
    );
    // The reducer froze the recorded tick's nested objects; the live grid is mutated in place.
    Object.assign(updated, cloneDeep(recorded), {
      cash,
      netWorth,
      revenue: recorded.revenue + transfers.grant,
      revenueGrants: (recorded.revenueGrants ?? 0) + transfers.grant,
      expensesOM: recorded.expensesOM + transfers.cost,
      ...ownership,
    });
  }
  result.transmission?.lines.forEach((line) => {
    const previous = before.transmission?.lines.find((l) => l.id === line.id);
    if (previous) line.currentFlowW = previous.currentFlowW;
  });
  return result;
}
/** The scenario a match plays: authored and not a tutorial, or a custom game. */
export function matchScenario(spec: MatchSpec): {
  scenario: ScenarioType;
  location: LocationType;
} {
  const scenario =
    spec && typeof spec === "object"
      ? getScenario(spec.scenarioId, spec.customScenario)
      : undefined;
  const location = getScenarioLocation(scenario);
  if (
    !scenario ||
    scenario.tutorialSteps ||
    scenario.id !== spec.scenarioId ||
    (scenario.mod !== undefined &&
      (!validScenarioMod(scenario.mod, scenario) ||
        scenario.mod.parameters.difficulty !== spec.difficulty)) ||
    (scenario.id === CUSTOM_SCENARIO_ID && scenario.rules !== undefined) ||
    (spec.scenarioId === CUSTOM_SCENARIO_ID) !== !!spec.customScenario ||
    !DIFFICULTY_IDS.includes(spec.difficulty) ||
    !isValidLocation(location)
  )
    throw new Error("Choose a scenario or custom game to play together");
  return { scenario, location };
}

export function createWorld(
  spec: MatchSpec,
  seats: Seat[],
  matchId: string,
  epoch: string,
): World {
  if (
    seats.length < 2 ||
    seats.length > 4 ||
    new Set(seats.map((s) => s.id)).size !== seats.length
  )
    throw new Error("A shared game needs two to four players");
  // A running match owns its selection; later library edits cannot replace its snapshot.
  spec = cloneDeep(spec);
  const { scenario, location } = matchScenario(spec);
  // Every company plays the scenario as authored, on one seed, so weather and stories match.
  const seed = scenario.seed ?? storyHash(matchId) >>> 0;
  selectWeatherLocation(location.id);
  const grids = seats.map((seat) => {
    let game = reducer(undefined, start(scenario.id));
    game = reducer(
      game,
      delta({
        customScenario: spec.customScenario,
        difficulty: spec.difficulty,
        multiplayer: { seat: seat.id },
      }),
    );
    game = reducer(
      game,
      initGame({
        facilities: scenario.facilities,
        cash: scenario.cash,
        customers: scenario.startingCustomers || getStartingCustomers(location),
        location,
        seed,
      }),
    );
    const result = cloneGrid(game);
    // Keep explicitly authored existing assets; player links replace optional outside markets.
    result.transmission = {
      ...result.transmission,
      buyingRule: "SHORTAGES",
      sellingRule: "PROFITABLE",
      lines: (result.transmission?.lines || []).filter(
        (line) =>
          scenario.startingInterties?.includes(line.corridorId) ||
          (isUtilityExpansionGame(result) && line.buildCost === 0),
      ),
    };
    result.inGame = true;
    result.speed = "NORMAL";
    result.runIdentity = undefined;
    return result;
  });
  const budgets = grids.map(
    (g) =>
      Math.max(...g.timeline.map((t) => t.demandW)) *
      MULTIPLAYER_LINK_BUDGET_FRACTION,
  );
  const edges: World["edges"] = [];
  seats.forEach((a, i) =>
    seats.slice(i + 1).forEach((b, offset) => {
      const capacityW =
        Math.round(
          Math.min(budgets[i], budgets[i + 1 + offset]) /
            (seats.length - 1) /
            1000,
        ) * 1000;
      edges.push({
        id: `${i}-${i + 1 + offset}`,
        a: a.id,
        b: b.id,
        capacityW,
        annualOperatingCost: isUtilityExpansionGame(grids[i])
          ? 0
          : capacityW * MULTIPLAYER_LINK_OPERATING_COST_PER_W,
        ratingW: capacityW,
        flowW: 0,
      });
    }),
  );
  grids.forEach((game, i) => {
    game.multiplayer!.peers = seats
      .filter((s) => s.id !== seats[i].id)
      .map((seat) => {
        const edge = edges.find(
          (e) =>
            [e.a, e.b].includes(seat.id) && [e.a, e.b].includes(seats[i].id),
        )!;
        const corridor = {
          id: peerCorridorId(edge.id),
          adjacentMarketId: seat.id,
          name: seat.name,
          routeType: "EXISTING" as const,
          capacityW: edge.capacityW,
          buildCost: isUtilityExpansionGame(game)
            ? 0
            : (edge.capacityW * EDGE_COST_PER_W) / 2,
          annualOperatingCost: isUtilityExpansionGame(game)
            ? 0
            : edge.annualOperatingCost / 2,
          yearsToBuild: 0.5,
          ...PEER_CORRIDOR_DERATE,
        };
        game.transmission!.lines.push({
          id:
            game.transmission!.lines.reduce(
              (largest, line) => Math.max(largest, line.id),
              0,
            ) + 1,
          corridorId: corridor.id,
          name: seat.name,
          capacityW: corridor.capacityW,
          buildCost: corridor.buildCost,
          annualOperatingCost: corridor.annualOperatingCost,
          yearsToBuildLeft: 0,
          minuteCreated: 0,
          financed: false,
          loanAmountLeft: 0,
          loanMonthlyPayment: 0,
          interestRate: 0,
          currentFlowW: 0,
        });
        return {
          id: seat.id,
          name: seat.name,
          locationId: location.id,
          corridor,
        };
      });
  });
  return {
    schema: 3,
    gameSchema: SAVE_SCHEMA_VERSION,
    rules: RULES,
    spec,
    outcomes: {},
    matchId,
    epoch,
    revision: 0,
    seats,
    grids,
    edges,
    selectedSpeeds: Object.fromEntries(seats.map((s) => [s.id, "PAUSED"])),
    activities: {},
    speed: "PAUSED",
    readyRequired: true,
    paused: true,
    reason: "Paused",
    ready: [],
    sequences: {},
    receipts: {},
    pricePerMWh: PEER_TRADE_MIN_PRICE_PER_MWH,
  };
}

/** Commands run while paused too; the clock is the only thing pause stops. */
export function applyCommand(
  world: World,
  sender: string,
  envelope: CommandEnvelope,
  allowReady = true,
): string | undefined {
  const previous = world.sequences[sender] || 0;
  const error = applyCommandOnce(world, sender, envelope, allowReady);
  syncClock(world);
  if ((world.sequences[sender] || 0) > previous)
    world.receipts[sender] = { sequence: envelope.sequence, error };
  return error;
}
function applyCommandOnce(
  world: World,
  sender: string,
  envelope: CommandEnvelope,
  allowReady: boolean,
): string | undefined {
  const index = world.seats.findIndex((s) => s.id === sender);
  if (
    index < 0 ||
    !envelope ||
    envelope.matchId !== world.matchId ||
    envelope.epoch !== world.epoch
  )
    return "This command belongs to another session";
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1)
    return "Invalid command sequence";
  const last = world.sequences[sender] || 0;
  if (envelope.sequence <= last)
    return world.receipts[sender]?.sequence === envelope.sequence
      ? world.receipts[sender]?.error
      : undefined;
  if (envelope.sequence !== last + 1)
    return "A command is missing; reconnect before continuing";
  world.sequences[sender] = envelope.sequence;
  world.revision++;
  const command = envelope.command;
  if (!command || typeof command !== "object") return "Invalid command";
  if (command.kind === "speed" || command.kind === "pause") {
    const speed = command.kind === "pause" ? "PAUSED" : command.speed;
    if (!validSpeed(speed)) return "Choose a valid game speed";
    if (world.readyRequired && speed !== "PAUSED") {
      const error = markReady(world, sender, allowReady);
      if (error) return error;
    }
    world.selectedSpeeds[sender] = speed;
    return;
  }
  if (command.kind === "activity") {
    if (command.reason !== null && !validActivityReason(command.reason))
      return "Invalid pause reason";
    if (command.reason === null) delete world.activities[sender];
    else world.activities[sender] = command.reason;
    return;
  }
  if (command.kind === "ready") {
    const error = markReady(world, sender, allowReady);
    if (!error && world.selectedSpeeds[sender] === "PAUSED")
      world.selectedSpeeds[sender] = "NORMAL";
    return error;
  }
  // A retired company can still change its speed or menus, but its grid no longer moves.
  if (!isActive(world, sender)) return "Your company's run has ended";
  const game = world.grids[index];
  selectWeatherLocation(game.location.id);
  if (command.kind === "action") {
    if (!isGameCommand(command.name)) return "That game action is unavailable";
    let name: GameCommandName = command.name;
    const buying = name === "acquireLand" || name === "acquireTile";
    // Quotes see the current host ledger, including claims made since the sender's last view.
    const quotingGame = buying ? territoryGameForWorld(world, index) : game;
    const validation = validateGameCommand(quotingGame, name, command.payload);
    if ("error" in validation) return validation.error;
    if (name === "acquireLand") {
      const quote = landPurchaseQuote(
        quotingGame,
        (
          validation.payload as {
            territoryId: import("../Types").LandTerritoryId;
          }
        ).territoryId,
      )!;
      name = "acquireTile";
      validation.payload = { tileId: quote.tileId, quoteKey: quote.quoteKey };
    }
    if (
      name === "upgradeTransmissionLine" &&
      isPeerCorridorId(
        (validation.payload as { corridorId: string }).corridorId,
      )
    )
      return coSignUpgrade(
        world,
        sender,
        validation.payload as { corridorId: string; financed: boolean },
      );
    const before = game.facilities.length;
    const updated = commandResult(
      game,
      reducer(quotingGame, commandAction(name, validation.payload)),
    );
    // Projection data is for the quote/reducer pass, never another persisted source of claims.
    world.grids[index] = buying
      ? { ...updated, multiplayer: game.multiplayer }
      : updated;
    if (
      name === "buildFacility" &&
      world.grids[index].facilities.length === before
    )
      return "Not enough cash or no site available";
    if (
      name === "acquireTile" &&
      world.grids[index].territoryNetwork?.tilePurchases?.length ===
        game.territoryNetwork?.tilePurchases?.length
    )
      return "This land tile is no longer available";
    return;
  }
  if (command.kind === "rate") {
    // The same range the single-player rate slider offers for this scenario and date.
    const scenario = getScenario(game.scenarioId, game.customScenario)!;
    const max = publicRateCap(
      scenario.dollarsPerkWh,
      game.date,
      game.startingYear,
      game.seed,
    );
    if (
      !Number.isFinite(command.value) ||
      command.value < 0 ||
      command.value > max
    )
      return `Choose a rate between ${formatMoneyFull(0, currencyForLocation(game.location, game.startingYear))} and ${formatMoneyFull(max, currencyForLocation(game.location, game.startingYear))}/kWh`;
    world.grids[index] = commandResult(
      game,
      reducer(game, delta({ dollarsPerkWh: command.value })),
    );
    return;
  }
  return "Unknown command";
}

/** A shared link upgrades only once both owners agree; each pays for their own half. */
function coSignUpgrade(
  world: World,
  sender: string,
  target: { corridorId: string; financed: boolean },
): string | undefined {
  const edge = world.edges.find(
    (e) => peerCorridorId(e.id) === target.corridorId,
  )!;
  const partner = world.seats.find(
    (seat) => seat.id === (edge.a === sender ? edge.b : edge.a),
  )!;
  if (!isActive(world, partner.id))
    return `${partner.name}'s company has retired`;
  const own = world.grids[world.seats.findIndex((s) => s.id === sender)];
  if (
    own.transmission?.lines.find((l) => l.corridorId === target.corridorId)
      ?.upgrade
  )
    return "Connection is already upgrading";
  if (!edge.approval) {
    edge.approval = sender;
    edge.approvalFinanced = target.financed;
    return;
  }
  if (edge.approval === sender) {
    delete edge.approval;
    delete edge.approvalFinanced;
    return;
  }
  const owners = [edge.a, edge.b].map((id) =>
    world.seats.findIndex((s) => s.id === id),
  );
  const upgraded = owners.map((owner) => {
    const grid = world.grids[owner];
    selectWeatherLocation(grid.location.id);
    return commandResult(
      grid,
      reducer(
        grid,
        upgradeTransmissionLine({
          corridorId: target.corridorId,
          financed:
            world.seats[owner].id === sender
              ? target.financed
              : !!edge.approvalFinanced,
        }),
      ),
    );
  });
  if (
    upgraded.some(
      (grid) =>
        !grid.transmission?.lines.find(
          (l) => l.corridorId === target.corridorId,
        )?.upgrade,
    )
  )
    return "Both companies need enough cash for their half";
  owners.forEach((owner, i) => {
    world.grids[owner] = upgraded[i];
  });
  delete edge.approval;
  delete edge.approvalFinanced;
}

export function stepWorld(world: World): void {
  syncClock(world);
  if (world.paused) return;
  const active = world.seats.flatMap((seat, i) =>
    isActive(world, seat.id) ? [i] : [],
  );
  const minute = world.grids[active[0]].date.minute;
  if (active.some((i) => world.grids[i].date.minute !== minute))
    throw new Error("Shared clock diverged");
  world.pricePerMWh = Math.max(
    ...active.map((i) => basePeerTradePrice(currentTick(world.grids[i])!)),
  );
  const sharedImportRounds: SharedImportClearing[] | undefined =
    world.grids.some((grid) => grid.utilityExpansion) ? [] : undefined;
  // Frozen legacy footprints are physical firebreaks for every seat. Only the monthly check uses them.
  const firebreaks =
    sharedImportRounds && (minute + TICK_MINUTES) % MINUTES_PER_MONTH === 0
      ? retainedWildfireFirebreaks(world.grids)
      : undefined;
  const tradingPlan = (plan: PeerPlan, i: number) => {
    plan = { ...plan };
    const grid = world.grids[i];
    if (grid.transmission?.sellingRule === "NONE") plan.offerW = 0;
    if (grid.transmission?.buyingRule === "NONE") {
      plan.shortageW = 0;
      plan.storageChargeW = 0;
    }
    return plan;
  };
  const phases = world.grids.map((g, i) => {
    // A retired company neither buys nor sells; its frozen grid only keeps its seat.
    if (!active.includes(i))
      return {
        phase: undefined,
        plan: {
          offerW: 0,
          shortageW: 0,
          pricePerMWh: world.pricePerMWh,
          temperatureC: 0,
          solarIrradianceWM2: 0,
          emissionsAt: () => 0,
        },
      };
    selectWeatherLocation(g.location.id);
    g.multiplayer!.pricePerMWh = world.pricePerMWh;
    const phase = tickStatePhases(
      g,
      undefined,
      undefined,
      sharedImportRounds,
      firebreaks,
    );
    const planned = phase.next();
    if (
      planned.done ||
      (sharedImportRounds
        ? !("kind" in planned.value) || planned.value.kind !== "ready"
        : !("offerW" in planned.value))
    )
      throw new Error("A grid could not prepare its shared tick");
    // With shared regional supply, all grids first stop at supplier readiness.
    return {
      phase,
      plan:
        "offerW" in planned.value
          ? tradingPlan(planned.value, i)
          : {
              offerW: 0,
              shortageW: 0,
              pricePerMWh: world.pricePerMWh,
              temperatureC: 0,
              solarIrradianceWM2: 0,
              emissionsAt: () => 0,
            },
    };
  });
  if (sharedImportRounds)
    phases.forEach(({ phase }, i) => {
      if (!phase) return;
      selectWeatherLocation(world.grids[i].location.id);
      const planned = phase.next();
      if (planned.done || !("offerW" in planned.value))
        throw new Error("A grid did not plan after readiness");
      phases[i].plan = tradingPlan(planned.value, i);
    });
  // Construction advances during planning, so completed upgrades apply to this settlement.
  world.edges.forEach((edge) => {
    const lines = world.grids.flatMap(
      (g) =>
        g.transmission?.lines.filter(
          (l) => l.corridorId === peerCorridorId(edge.id),
        ) ?? [],
    );
    edge.disabled =
      lines.length !== 2 ||
      lines.some((l) => l.paused) ||
      !isActive(world, edge.a) ||
      !isActive(world, edge.b);
    edge.capacityW = Math.min(...lines.map((l) => l.capacityW));
    edge.annualOperatingCost = lines.reduce(
      (sum, l) => sum + l.annualOperatingCost,
      0,
    );
  });
  // Each refresh uses the same settlement owner and a fresh regional budget. The barrier
  // leaves every company settled before reserve, history and month-opening work continues.
  let round = 0;
  let plans = phases.map((p) => p.plan);
  while (true) {
    const settlements = clearPeerMarket(
      world.seats.map((s) => s.id),
      plans,
      world.edges,
    );
    phases.forEach(({ phase }, i) => {
      if (!phase) return;
      selectWeatherLocation(world.grids[i].location.id);
      const settled = phase.next(settlements[i]);
      if (
        sharedImportRounds
          ? settled.done ||
            !("kind" in settled.value) ||
            settled.value.kind !== "settled"
          : !settled.done
      )
        throw new Error("A grid did not finish its shared settlement");
    });
    if (!sharedImportRounds) break;
    const clearing = sharedImportRounds[round++];
    const reserved = [...clearing.reservations];
    for (const { tick, offers, limitW } of clearing.headroom) {
      const headroom = allocateIntertieFlows(
        offers,
        limitW,
        0,
        reserved,
      ).importedW;
      const watts = headroom.reduce((sum, value) => sum + value, 0);
      tick.availableSupplyW = (tick.availableSupplyW ?? tick.supplyW) + watts;
      tick.reserveW = (tick.reserveW ?? tick.supplyW - tick.demandW) + watts;
      headroom.forEach((value, i) =>
        reserved.push({ offer: offers[i], watts: value }),
      );
    }
    let nextPlans = 0;
    plans = phases.map(({ phase, plan }, i) => {
      if (!phase) return plan;
      selectWeatherLocation(world.grids[i].location.id);
      const next = phase.next();
      if (next.done) return plan;
      if (!("kind" in next.value) || next.value.kind !== "ready")
        throw new Error("A grid did not prepare its next refresh");
      nextPlans++;
      return plan;
    });
    if (!nextPlans) break;
    if (nextPlans !== active.length) throw new Error("Shared refresh diverged");
    plans = phases.map(({ phase, plan }, i) => {
      if (!phase) return plan;
      selectWeatherLocation(world.grids[i].location.id);
      const next = phase.next();
      if (next.done || !("offerW" in next.value))
        throw new Error("A grid did not plan its next refresh");
      return tradingPlan(next.value, i);
    });
  }
  phases.forEach(({ phase }, i) => {
    if (!phase) return;
    const grid = world.grids[i];
    let capacity = currentTick(grid)!.transmissionCapacityW || 0;
    grid.transmission?.lines.forEach((line) => {
      const edgeId = edgeIdFromPeerCorridor(line.corridorId);
      const edge = world.edges.find((e) => e.id === edgeId);
      if (edge) {
        line.currentFlowW =
          edge.a === world.seats[i].id ? -edge.flowW : edge.flowW;
        capacity += edge.ratingW;
      }
    });
    currentTick(grid)!.transmissionCapacityW = capacity;
  });
  if (active.some((i) => world.grids[i].date.minute !== minute + TICK_MINUTES))
    throw new Error("Shared clock diverged");
  // A company whose run ended at this rollover retires: its clock, links and votes stop here.
  active.forEach((i) => {
    const seat = world.seats[i];
    const ending = world.grids[i].multiplayer!.ending;
    if (!ending) return;
    world.outcomes[seat.id] = ending;
    delete world.activities[seat.id];
    world.ready = world.ready.filter((id) => id !== seat.id);
    world.grids[i].transmission?.lines.forEach((line) => {
      line.currentFlowW = 0;
    });
  });
  world.revision++;
  syncClock(world);
}

/** One row per company whose run has ended, for the co-op result table. */
function companyResults(world: World): CompanyResultType[] {
  return world.seats.flatMap((seat, i) => {
    const outcome = world.outcomes[seat.id];
    if (!outcome) return [];
    const grid = world.grids[i];
    const summary = summarizeHistory(grid.monthlyHistory);
    return [
      {
        ...outcome,
        id: seat.id,
        name: seat.name,
        cash: currentTick(grid)?.cash ?? 0,
        kgco2e: summary.kgco2e,
        reliability:
          summary.demandWh > 0 ? summary.supplyWh / summary.demandWh : 1,
        objectiveResults: cloneDeep(gameObjectiveResults(grid)),
      },
    ];
  });
}

/** Share physical ownership only within a synchronous publication. */
export function roomViewBuilder(world: World) {
  let ownership: ReturnType<typeof worldTerritoryOwnership> | undefined;
  return (seatId: string): RoomView =>
    buildRoomView(
      world,
      seatId,
      (ownership ??= worldTerritoryOwnership(world)),
    );
}

export function roomView(world: World, seatId: string): RoomView {
  return roomViewBuilder(world)(seatId);
}

function buildRoomView(
  world: World,
  seatId: string,
  ownership: ReturnType<typeof worldTerritoryOwnership>,
): RoomView {
  const index = world.seats.findIndex((s) => s.id === seatId);
  if (index < 0) throw new Error("Player is not in this match");
  const game = territoryGameForWorld(
    world,
    index,
    world.grids,
    undefined,
    ownership,
  );
  const visible = hasTerritoryNetwork(game) ? visibleTerritoryTiles(game) : [];
  const visibleIds = new Set(visible.map(({ tile }) => tile.id));
  const visibleCells = new Set(
    visible.map(({ tile }) => `${tile.q},${tile.r}`),
  );
  const visibleRegions = new Set(visible.map(({ tile }) => tile.territoryId));
  const tileOwners = { ...ownership.tileOwners };
  const owns = ownership.owns[index];
  // Each company can acquire the same utility. Prefer local property, then roster order.
  for (const { tile } of visible) {
    if (owns(tile) || tileOwners[tile.id]) continue;
    const owner = world.grids.findIndex(
      (grid, owner) =>
        owner !== index &&
        grid.utilityExpansion?.acquisitions.some(
          ({ targetId }) => targetId === tile.territoryId,
        ),
    );
    if (owner >= 0 && !tile.id.includes(":legacy-"))
      tileOwners[tile.id] = {
        seat: world.seats[owner].id,
        name: world.seats[owner].name,
      };
  }
  game.multiplayer = {
    ...game.multiplayer!,
    // Compute sight with complete host footprints, then publish only discovered cells.
    legacyTiles: game.multiplayer!.legacyTiles?.filter(({ tile }) =>
      visibleCells.has(`${tile.q},${tile.r}`),
    ),
    peers: game.multiplayer!.peers?.map((peer) => {
      const other =
        world.grids[world.seats.findIndex((seat) => seat.id === peer.id)];
      const tick = currentTick(other)!;
      const edgeId = edgeIdFromPeerCorridor(peer.corridor.id);
      const edge = world.edges.find((e) => e.id === edgeId)!;
      const retired = !isActive(world, peer.id);
      return {
        ...peer,
        retired,
        ratingW: retired ? 0 : edge.ratingW,
        availableSupplyW: retired
          ? 0
          : Math.max(0, tick.exportedW || 0, tick.supplyW - tick.demandW),
        upgradeRequestedBy: world.seats.find(
          (seat) => seat.id === edge.approval,
        )?.name,
        upgradeRequestedBySelf: edge.approval === seatId,
      };
    }),
    results: Object.keys(world.outcomes).length
      ? companyResults(world)
      : undefined,
    landOwners: Object.fromEntries(
      Object.entries(ownership.landOwners).filter(([id]) =>
        visibleRegions.has(id as import("../Types").TerritoryId),
      ),
    ),
    tileOwners: Object.fromEntries(
      Object.entries(tileOwners).filter(([id]) =>
        visibleIds.has(id as import("../Types").TerritoryTileId),
      ),
    ),
    ...(hasTerritoryNetwork(game)
      ? {
          tileFacilities: Object.fromEntries(
            world.grids.flatMap((grid, owner) =>
              grid.facilities.flatMap((facility) => {
                const tile = getFacilityTile(facility, grid);
                if (
                  !tile ||
                  tileOwners[tile.id]?.seat !== world.seats[owner].id ||
                  !ownership.owns[owner](tile) ||
                  !visibleIds.has(tile.id)
                )
                  return [];
                return [
                  [
                    tile.id,
                    {
                      seat: world.seats[owner].id,
                      name: facility.name,
                      peakW: facility.peakW,
                      yearsToBuildLeft: facility.yearsToBuildLeft,
                      ...(facility.fuel !== undefined
                        ? { fuel: facility.fuel }
                        : {}),
                      ...(facility.peakWh !== undefined
                        ? { peakWh: facility.peakWh }
                        : {}),
                    },
                  ],
                ];
              }),
            ),
          ),
        }
      : {}),
    clock: {
      activeSpeed: world.speed,
      selectedSpeed: world.selectedSpeeds[seatId],
      reason: world.reason,
      readyRequired: world.readyRequired,
      ready: world.ready.includes(seatId),
      // Retired companies no longer hold the clock, so they leave the speed control.
      players: activeSeats(world).map((seat) => ({
        id: seat.id,
        name: seat.name,
        selectedSpeed: world.selectedSpeeds[seat.id],
        pauseReason:
          (pendingScenarioChoice(world.grids[world.seats.indexOf(seat)])
            ? "Choosing a response"
            : undefined) ||
          world.activities[seat.id] ||
          (world.readyRequired && !world.ready.includes(seat.id)
            ? "Paused"
            : undefined),
      })),
    },
  };
  return {
    // Filter host-only geography before cloning the seat's detached view.
    game: cloneGrid(game),
    speed: world.speed,
    readyRequired: world.readyRequired,
    disconnected: [],
    matchId: world.matchId,
    epoch: world.epoch,
    revision: world.revision,
    reason: world.reason,
    ready: [...world.ready],
    lastSequence: world.sequences[seatId] || 0,
    receipt: world.receipts[seatId],
    grids: world.grids.map((g, i) => ({
      seat: world.seats[i],
      selectedSpeed: world.selectedSpeeds[world.seats[i].id],
      pauseReason: world.activities[world.seats[i].id],
      ...(!isActive(world, world.seats[i].id) && { retired: true }),
    })),
  };
}

/** All grids and dispatch plans are saved together, at one structural version. */
export function checkpointWorld(world: World): World {
  return {
    ...world,
    commitments: world.grids.map(
      (g) => serializeCommitmentMetadata(g.timeline) || null,
    ),
  };
}

const INCOMPLETE_SAVE =
  "This co-op save is incomplete or uses an unsupported format. Your original save is preserved.";
const INVALID_GRIDS = "Multiplayer save contains invalid grids or connections";

/** Current structure, a playable match spec and a two-to-four player roster. */
function validRoster(world: World) {
  if (
    !world ||
    world.schema !== 3 ||
    world.rules !== RULES ||
    typeof world.matchId !== "string" ||
    !world.matchId ||
    typeof world.epoch !== "string" ||
    !world.epoch ||
    !Number.isFinite(world.pricePerMWh) ||
    world.pricePerMWh < 0 ||
    world.gameSchema !== SAVE_SCHEMA_VERSION ||
    !Array.isArray(world.seats) ||
    world.seats.length < 2 ||
    world.seats.length > 4 ||
    !world.seats.every(
      (s) => !!s && typeof s.id === "string" && typeof s.name === "string",
    ) ||
    new Set(world.seats.map((s) => s.id)).size !== world.seats.length
  )
    return false;
  try {
    matchScenario(world.spec);
    return true;
  } catch {
    return false;
  }
}

const OUTCOMES = ["bankrupt", "fired", "completed"];
/** Every ended run belongs to a seat and records how and when it ended. */
function validOutcomes(world: World, ids: Set<string>) {
  return (
    !!world.outcomes &&
    typeof world.outcomes === "object" &&
    Object.entries(world.outcomes).every(
      ([id, ending]) =>
        ids.has(id) &&
        !!ending &&
        OUTCOMES.includes(ending.outcome) &&
        typeof ending.title === "string" &&
        ending.title.length <= 200 &&
        (ending.reason === undefined ||
          (typeof ending.reason === "string" && ending.reason.length <= 500)) &&
        Number.isSafeInteger(ending.month) &&
        ending.month >= 0,
    )
  );
}

/** Command bookkeeping, revision and one grid per seat with one link per pair. */
function validShape(world: World) {
  return (
    !!world.sequences &&
    typeof world.sequences === "object" &&
    !!world.receipts &&
    typeof world.receipts === "object" &&
    Number.isSafeInteger(world.revision) &&
    world.revision >= 0 &&
    Array.isArray(world.grids) &&
    world.grids.length === world.seats.length &&
    Array.isArray(world.edges) &&
    world.edges.length === (world.seats.length * (world.seats.length - 1)) / 2
  );
}

/** Every grid plays the match's scenario for its seat; companies still playing share a clock. */
function validGridHeaders(world: World) {
  const { scenario, location } = matchScenario(world.spec);
  const clock = world.grids.find((g, i) => !world.outcomes?.[world.seats[i].id])
    ?.date?.minute;
  return world.grids.every(
    (g, i) =>
      !!g?.multiplayer &&
      g.scenarioId === world.spec.scenarioId &&
      g.difficulty === world.spec.difficulty &&
      JSON.stringify(g.customScenario) ===
        JSON.stringify(world.spec.customScenario) &&
      g.startingYear === scenario.startingYear &&
      JSON.stringify(g.location) === JSON.stringify(location) &&
      g.multiplayer.seat === world.seats[i].id &&
      g.seed === world.grids[0].seed &&
      !!g.timeline?.length &&
      Number.isFinite(g.date?.minute) &&
      (world.outcomes?.[world.seats[i].id]
        ? clock === undefined || g.date.minute <= clock
        : g.date.minute === clock) &&
      Number.isFinite(currentTick(g)?.cash),
  );
}

function validClock(world: World, ids: Set<string>) {
  return (
    !!world.selectedSpeeds &&
    typeof world.selectedSpeeds === "object" &&
    Object.keys(world.selectedSpeeds).length === ids.size &&
    world.seats.every((s) => validSpeed(world.selectedSpeeds[s.id])) &&
    Object.keys(world.selectedSpeeds).every((id) => ids.has(id)) &&
    !!world.activities &&
    typeof world.activities === "object" &&
    Object.entries(world.activities).every(
      ([id, reason]) => ids.has(id) && validActivityReason(reason),
    )
  );
}

function validReceipts(world: World, ids: Set<string>) {
  return (
    Object.entries(world.sequences).every(
      ([id, sequence]) =>
        ids.has(id) && Number.isSafeInteger(sequence) && sequence >= 0,
    ) &&
    Object.entries(world.receipts).every(
      ([id, receipt]) =>
        ids.has(id) &&
        !!receipt &&
        Number.isSafeInteger(receipt.sequence) &&
        receipt.sequence >= 0 &&
        (receipt.error === undefined || typeof receipt.error === "string"),
    )
  );
}

/** A saved grid is a valid single-player save plus exactly this match's peer links. */
function validGrid(
  world: World,
  initial: World,
  i: number,
  peers?: TerritoryPurchaseContext,
) {
  const g = world.grids[i];
  const scenario = getScenario(g.scenarioId, g.customScenario)!;
  const expectedConnections = initial.grids[i].transmission!.lines;
  const nativeLines = isUtilityExpansionGame(g)
    ? (g.transmission?.lines ?? []).filter((line) =>
        [
          "vt-champlain-valley",
          "vt-champlain-ridge",
          "vt-champlain-regional",
          "vt-valley-regional",
          "vt-ridge-regional",
        ].includes(line.corridorId),
      )
    : [];
  const lineCount =
    expectedConnections.filter(
      (line) => !isUtilityExpansionGame(g) || isPeerCorridorId(line.corridorId),
    ).length + nativeLines.length;
  return (
    !!parseSave(
      serializeSave({
        ...g,
        multiplayer: undefined,
        transmission: intertiesEnabledForScenario(scenario, g.location)
          ? {
              buyingRule: g.transmission!.buyingRule,
              sellingRule: g.transmission!.sellingRule,
              lines: nativeLines,
              acceptedAgreements: g.transmission!.acceptedAgreements,
              inheritedAgreementTerms: g.transmission!.inheritedAgreementTerms,
              agreementAccounts: g.transmission!.agreementAccounts,
            }
          : undefined,
      }),
      peers,
    ) &&
    g.multiplayer?.peers?.length === world.seats.length - 1 &&
    g.transmission?.lines.length === lineCount &&
    new Set(g.multiplayer.peers.map((peer) => peer.id)).size ===
      world.seats.length - 1 &&
    new Set(g.transmission.lines.map((line) => line.corridorId)).size ===
      lineCount &&
    new Set(g.transmission.lines.map((line) => line.id)).size === lineCount &&
    g.multiplayer.peers.every((peer) => {
      const expected = initial.grids[i].multiplayer!.peers!.find(
        (p) => p.id === peer.id,
      );
      return (
        !!expected &&
        peer.name === expected.name &&
        peer.locationId === expected.locationId &&
        !!peer.corridor &&
        [
          peer.corridor.capacityW,
          peer.corridor.buildCost,
          peer.corridor.annualOperatingCost,
        ].every((n) => Number.isFinite(n) && n >= 0) &&
        peer.corridor.capacityW > 0 &&
        Object.keys(peer.corridor).length ===
          Object.keys(expected.corridor).length &&
        Object.entries(expected.corridor).every(
          ([key, value]) =>
            ["capacityW", "buildCost", "annualOperatingCost"].includes(key) ||
            peer.corridor[key as keyof typeof peer.corridor] === value,
        )
      );
    }) &&
    g.transmission.lines.every(
      (line) =>
        (!hasTerritoryNetwork(g) ||
          !isPeerCorridorId(line.corridorId) ||
          (!line.paused &&
            line.minuteCreated === 0 &&
            line.yearsToBuildLeft === 0)) &&
        (expectedConnections.some(
          (expected) => expected.corridorId === line.corridorId,
        ) ||
          nativeLines.includes(line)) &&
        validTransmissionLine(line, g.date.year, accessContextForGame(g)),
    )
  );
}

/** One link per distinct pair of seats, flowing within its rating. */
function validEdges(world: World, ids: Set<string>, initial: World) {
  const pairs = new Set<string>();
  return world.edges.every((edge) => {
    const pair = [edge.a, edge.b].sort().join(":");
    const expected = initial.edges.find((e) => e.id === edge.id);
    const endpoints = [edge.a, edge.b].map(
      (id) => world.grids[world.seats.findIndex((s) => s.id === id)],
    );
    const corridors = endpoints.map(
      (grid) =>
        grid?.multiplayer?.peers?.find(
          (peer) => peer.corridor.id === peerCorridorId(edge.id),
        )?.corridor,
    );
    const lines = endpoints.map((grid) =>
      grid?.transmission?.lines.find(
        (line) => line.corridorId === peerCorridorId(edge.id),
      ),
    );
    if (
      !expected ||
      pair !== [expected.a, expected.b].sort().join(":") ||
      corridors.some((corridor) => !corridor) ||
      lines.some((line) => !line) ||
      !(["capacityW", "buildCost", "annualOperatingCost"] as const).every(
        (key) => corridors[0]?.[key] === corridors[1]?.[key],
      ) ||
      edge.capacityW !== Math.min(...lines.map((line) => line!.capacityW)) ||
      edge.annualOperatingCost !==
        lines.reduce((sum, line) => sum + line!.annualOperatingCost, 0) ||
      !ids.has(edge.a) ||
      !ids.has(edge.b) ||
      edge.a === edge.b ||
      pairs.has(pair) ||
      !Number.isFinite(edge.capacityW) ||
      edge.capacityW <= 0 ||
      !Number.isFinite(edge.ratingW) ||
      edge.ratingW < 0 ||
      edge.ratingW > edge.capacityW ||
      !Number.isFinite(edge.flowW) ||
      Math.abs(edge.flowW) > edge.ratingW + 1 ||
      !Number.isFinite(edge.annualOperatingCost) ||
      edge.annualOperatingCost < 0 ||
      (edge.approval && edge.approval !== edge.a && edge.approval !== edge.b) ||
      (edge.approvalFinanced !== undefined &&
        typeof edge.approvalFinanced !== "boolean")
    )
      return false;
    pairs.add(pair);
    return true;
  });
}

/** Reattach each grid's saved dispatch plans to the restored timeline. */
function restoreCommitments(world: World, result: World) {
  if (
    !Array.isArray(world.commitments) ||
    world.commitments.length !== world.grids.length
  )
    throw new Error("Multiplayer save is missing its dispatch plans");
  world.commitments.forEach((saved, i) => {
    if (saved === null) return;
    if (!validCommitmentMetadata(saved, result.grids[i].timeline.length))
      throw new Error("Multiplayer save has invalid dispatch plans");
    restoreCommitmentMetadata(result.grids[i].timeline, saved);
  });
  delete result.commitments;
}

/**
 * Hands each saved company to the player resuming it, in saved order. Every reference to a
 * seat's id or name moves with it, so the result validates as though it had been saved so.
 */
function reassignSeats(world: World, seats: Seat[]) {
  if (
    seats.length !== world.seats.length ||
    new Set(seats.map((s) => s.id)).size !== seats.length ||
    !seats.every(
      (s) =>
        /^[a-zA-Z0-9-]{1,64}$/.test(s?.id) &&
        typeof s.name === "string" &&
        s.name.length <= 200,
    )
  )
    throw new Error("Every saved company needs one player");
  const ids = new Map(world.seats.map((seat, i) => [seat.id, seats[i].id]));
  const names = new Map(seats.map((seat) => [seat.id, seat.name]));
  const id = (old: string) => ids.get(old) ?? old;
  const rekey = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [id(k), v]));
  world.seats = seats.map((seat) => ({ ...seat }));
  world.outcomes = rekey(world.outcomes);
  world.selectedSpeeds = rekey(world.selectedSpeeds);
  world.activities = rekey(world.activities);
  world.ready = world.ready.map(id);
  world.edges.forEach((edge) => {
    edge.a = id(edge.a);
    edge.b = id(edge.b);
    if (edge.approval) edge.approval = id(edge.approval);
  });
  world.grids.forEach((grid) => {
    const multiplayer = grid.multiplayer!;
    multiplayer.seat = id(multiplayer.seat);
    multiplayer.peers?.forEach((peer) => {
      const line = grid.transmission?.lines.find(
        (l) => l.corridorId === peer.corridor.id,
      );
      peer.id = id(peer.id);
      peer.name = names.get(peer.id)!;
      peer.corridor.adjacentMarketId = peer.id;
      peer.corridor.name = peer.name;
      if (line) line.name = peer.name;
    });
  });
}

/** Validate and detach a live checkpoint without changing its epoch or player state. */
export function hydrateWorld(value: unknown): World {
  savedMatchSpec(value);
  const world = upgradeTerritoryWorld(value) as World;
  const ids = new Set(world?.seats?.map?.((s) => s?.id));
  if (
    !validRoster(world) ||
    !validShape(world) ||
    !validOutcomes(world, ids) ||
    !validGridHeaders(world)
  )
    throw new Error(INCOMPLETE_SAVE);
  const result = cloneDeep(world);
  if (!validClock(world, ids))
    throw new Error(
      "Multiplayer save contains invalid player speeds or pauses",
    );
  if (!validReceipts(world, ids))
    throw new Error("Multiplayer save contains invalid command receipts");
  const initial = createWorld(
    world.spec,
    world.seats,
    world.matchId,
    world.epoch,
  );
  const history = territoryPurchaseHistory(world);
  if (
    !history ||
    !world.grids.every((_grid, i) =>
      validGrid(world, initial, i, history[i]),
    ) ||
    !validEdges(world, ids, initial) ||
    !validSharedLand(world)
  )
    throw new Error(INVALID_GRIDS);
  if (world.grids.some(hasTerritoryNetwork)) {
    const firebreaks = retainedWildfireFirebreaks(world.grids);
    if (
      firebreaks.size &&
      !world.grids.every((grid) =>
        validTerritoryWeather(grid.territoryWeather, grid, firebreaks),
      )
    )
      throw new Error(INVALID_GRIDS);
  }
  restoreCommitments(world, result);
  return result;
}

/** Both endpoints must really exist and operate; renderer projections never grant sight. */
function territoryGameForWorld(
  world: World,
  index: number,
  grids = world.grids,
  minute?: number,
  ownership = worldTerritoryOwnership(world, grids),
): GameType {
  const game = grids[index];
  const active = (seat: string) => {
    const owner = world.seats.findIndex((entry) => entry.id === seat);
    return (
      owner >= 0 &&
      (!world.outcomes[seat] ||
        (minute !== undefined && minute < world.grids[owner].date.minute))
    );
  };
  return {
    ...game,
    multiplayer: {
      ...world.grids[index].multiplayer!,
      tileOwners: ownership.tileOwners,
      legacyTiles: grids.flatMap((grid, owner) =>
        owner === index
          ? []
          : legacyTerritoryTiles(grid).map((tile) => {
              const facility = grid.facilities.find(
                (plant) => plant.tileId === tile.id,
              );
              return {
                tile,
                seat: world.seats[owner].id,
                name: world.seats[owner].name,
                ...(facility
                  ? {
                      facility: {
                        name: facility.name,
                        peakW: facility.peakW,
                        yearsToBuildLeft: facility.yearsToBuildLeft,
                        ...(facility.fuel !== undefined
                          ? { fuel: facility.fuel }
                          : {}),
                        ...(facility.peakWh !== undefined
                          ? { peakWh: facility.peakWh }
                          : {}),
                      },
                    }
                  : {}),
              };
            }),
      ),
      landOwners: ownership.landOwners,
      peers: world.grids[index].multiplayer?.peers?.map((peer) => {
        const other = world.seats.findIndex((seat) => seat.id === peer.id);
        const connected =
          other >= 0 &&
          active(world.seats[index].id) &&
          active(peer.id) &&
          [index, other].every((owner) =>
            grids[owner].transmission?.lines.some(
              (line) =>
                line.corridorId === peer.corridor.id &&
                !line.paused &&
                line.yearsToBuildLeft <= 0 &&
                line.capacityW > 0 &&
                line.minuteCreated <= (minute ?? game.date.minute),
            ),
          );
        return {
          ...peer,
          retired: !active(peer.id),
          connected,
          territoryTileIds:
            connected && hasTerritoryNetwork(grids[other])
              ? ownership.ownedTiles[other].map((tile) => tile.id)
              : [],
        };
      }),
    },
  };
}

const replayRecords = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
  );

/** Admit only reachable receipts, preserving each ledger's order across shared clock instants.
 * Same-minute decisions may interleave; a circular or future claim cannot bootstrap discovery. */
function territoryPurchaseHistory(
  world: World,
): TerritoryPurchaseContext[] | undefined {
  const contexts: Map<
    import("../Types").TerritoryTileId,
    ReturnType<typeof connectedPeerTerritoryTiles>
  >[] = world.grids.map(() => new Map());
  if (!world.grids.some(hasTerritoryNetwork)) return contexts;
  // Replay needs historical anchors before the context-aware grid validation can run.
  if (
    world.grids.some(
      (grid) =>
        !replayRecords(grid.facilities) ||
        !replayRecords(grid.territoryNetwork?.landPurchases) ||
        !replayRecords(grid.territoryNetwork?.legacyTiles) ||
        grid.territoryNetwork!.legacyTiles!.some(
          ({ id, q, r }) =>
            typeof id !== "string" ||
            !Number.isSafeInteger(q) ||
            !Number.isSafeInteger(r),
        ) ||
        !replayRecords(grid.utilityExpansion?.acquisitions) ||
        !replayRecords(grid.transmission?.lines) ||
        (grid.transmission?.acceptedAgreements !== undefined &&
          !replayRecords(grid.transmission.acceptedAgreements)) ||
        !replayRecords(grid.multiplayer?.peers) ||
        grid.multiplayer!.peers!.some(
          ({ id, corridor }) =>
            typeof id !== "string" || typeof corridor?.id !== "string",
        ),
    )
  )
    return undefined;
  const ledgers = world.grids.map(
    (grid) => grid.territoryNetwork?.tilePurchases,
  );
  if (
    ledgers.some(
      (entries, i) =>
        !Array.isArray(entries) ||
        entries.some(
          (receipt) =>
            !receipt ||
            !getTerritoryTile(receipt.tileId, {
              facilities: world.grids[i].facilities,
              territoryNetwork: world.grids[i].territoryNetwork,
            }) ||
            !Number.isSafeInteger(receipt.minute) ||
            receipt.minute < 0 ||
            receipt.minute > world.grids[i].date.minute ||
            receipt.minute % TICK_MINUTES !== 0,
        ),
    )
  )
    return undefined;
  const admitted = ledgers.map(
    () => [] as NonNullable<(typeof ledgers)[number]>,
  );
  const positions = ledgers.map(() => 0);
  while (ledgers.some((entries, i) => positions[i] < entries!.length)) {
    const minute = Math.min(
      ...ledgers.map(
        (entries, i) => entries![positions[i]]?.minute ?? Infinity,
      ),
    );
    let progress = false;
    for (let i = 0; i < ledgers.length; i++) {
      const receipt = ledgers[i]![positions[i]];
      if (!receipt || receipt.minute !== minute) continue;
      const historical = world.grids.map((grid, owner) =>
        territoryGameAtPurchase(grid, minute, admitted[owner]),
      );
      const game = territoryGameForWorld(world, i, historical, minute);
      const tile = getTerritoryTile(receipt.tileId, game)!;
      if (
        receipt.legacy === true
          ? territoryVisibilityDistance(game, tile) === undefined
          : !isAdjacentToOwnedTerritoryTile(game, tile)
      )
        continue;
      const anchor = connectedPeerTerritoryTiles(game).find(
        (peerTile) => territoryHexDistance(peerTile, tile) <= 3,
      );
      if (anchor) contexts[i].set(tile.id, [anchor]);
      admitted[i].push(receipt);
      positions[i]++;
      progress = true;
    }
    if (!progress) return undefined;
  }
  return contexts;
}

export function restoreWorld(
  value: unknown,
  epoch: string,
  seats?: Seat[],
): World {
  const result = hydrateWorld(value);
  if (seats) reassignSeats(result, seats);
  result.epoch = epoch;
  // A restored renderer starts on the grid view, so prior menus cannot keep it stuck paused.
  result.activities = {};
  result.selectedSpeeds = Object.fromEntries(
    result.seats.map((seat) => [seat.id, "PAUSED"]),
  );
  pauseWorld(result, "Paused");
  result.sequences = {};
  result.receipts = {};
  return result;
}

function worldOwnedTerritoryTiles(
  grid: GameType,
  owns = createTerritoryTileOwnership(grid),
) {
  const tiles = new Map([
    ...getTerritoryTiles().map((tile) => [tile.id, tile] as const),
    ...legacyTerritoryTiles(grid).map((tile) => [tile.id, tile] as const),
    ...(grid.territoryNetwork?.tilePurchases ?? []).flatMap(({ tileId }) => {
      const tile = getTerritoryTile(tileId, grid);
      return tile ? [[tile.id, tile] as const] : [];
    }),
  ]);
  return [...tiles.values()].filter(owns);
}

/** Host-only projection from validated receipts. Historical replay supplies its own grids. */
function worldTerritoryOwnership(world: World, grids = world.grids) {
  const owns = grids.map(createTerritoryTileOwnership);
  const ownedTiles = grids.map((grid, index) =>
    hasTerritoryNetwork(grid)
      ? worldOwnedTerritoryTiles(grid, owns[index])
      : [],
  );
  const tileOwners = Object.fromEntries(
    ownedTiles.flatMap((tiles, index) =>
      tiles
        .filter(
          (tile) =>
            isLandTerritoryId(tile.territoryId) || tile.id.includes(":legacy-"),
        )
        .map(
          (tile) =>
            [
              tile.id,
              { seat: world.seats[index].id, name: world.seats[index].name },
            ] as const,
        ),
    ),
  );
  const landOwners = Object.fromEntries(
    grids.flatMap((grid, index) =>
      (grid.territoryNetwork?.landPurchases ?? []).map(
        (receipt) =>
          [
            receipt.territoryId,
            { seat: world.seats[index].id, name: world.seats[index].name },
          ] as const,
      ),
    ),
  );
  return { owns, ownedTiles, tileOwners, landOwners };
}

/** Recognized published worlds follow ordered migrations; arbitrary runtime identities never do. */
function upgradeTerritoryWorld(value: unknown): unknown {
  const old = value as Partial<World> | null;
  if (
    !old ||
    old.schema !== 3 ||
    !(
      (old.gameSchema === 13 &&
        old.rules ===
          "coop-2-34d99333d49691071b390dc49bfe6c73e43562c61b9fcbf7974f5996b10deaca") ||
      (old.gameSchema === 14 &&
        old.rules ===
          "coop-2-b4c8f4641c919057a7b569242464c24e26bcec444ef68954be2796b7734bbbb8") ||
      (old.gameSchema === 15 &&
        old.rules ===
          "coop-2-c12bab1ee04886f40ff0274d35e968e07cf7c3306f9e5ea006140bb973163fe4") ||
      (old.gameSchema === 16 &&
        old.rules ===
          "coop-2-06e4afd05778c47de20788acd02787291d3f09456465a0a89ace5fbeadd2d018") ||
      (old.gameSchema === 17 &&
        old.rules ===
          "coop-2-b590dfc2a358c3d4fd7c14330f8a5e92181b38944a04098dc416dcfbbf904907") ||
      (old.gameSchema === 20 &&
        old.rules ===
          "coop-2-cf979e3b45deb328dd12a266f291e16398174095d47beca6df0d4f9da1dbd577")
    ) ||
    !Array.isArray(old.grids) ||
    !old.grids.every(
      (grid) =>
        !!grid &&
        typeof grid === "object" &&
        (old.gameSchema === 15 ||
          old.gameSchema === 16 ||
          old.gameSchema === 17 ||
          old.gameSchema === 20 ||
          isUtilityExpansionGame(grid)),
    )
  )
    return value;
  const result = cloneDeep(old) as World;
  for (let i = 0; i < result.grids.length; i++) {
    const upgraded = upgradeSave({
      schemaVersion: old.gameSchema,
      game: result.grids[i],
    });
    if (!upgraded) return value;
    result.grids[i] = upgraded.game as GameType;
  }
  result.gameSchema = SAVE_SCHEMA_VERSION;
  result.rules = RULES;
  return result;
}
function validSharedLand(world: World): boolean {
  const retained = world.grids.flatMap(
    (grid) => grid.territoryNetwork?.landPurchases ?? [],
  );
  if (
    ![...new Set(retained.map((receipt) => receipt.territoryId))].every(
      (id) => {
        const claims = retained.filter((receipt) => receipt.territoryId === id);
        return (
          claims.length <= 1 ||
          (id === "green-uplands" &&
            claims.every((receipt) => receipt.legacy === true))
        );
      },
    )
  )
    return false;
  // Grandfathered retained rights may overlap each other, but no new purchase may alias them.
  const retainedCoordinates = new Set(
    world.grids.flatMap((grid) => {
      const purchases = new Set(
        grid.territoryNetwork?.tilePurchases?.map(({ tileId }) => tileId),
      );
      return worldOwnedTerritoryTiles(grid)
        .filter((tile) => !purchases.has(tile.id))
        .map((tile) => `${tile.q},${tile.r}`);
    }),
  );
  const seen = new Set<string>();
  for (const grid of world.grids)
    for (const receipt of grid.territoryNetwork?.tilePurchases ?? []) {
      const tile = getFacilityTile({ tileId: receipt.tileId }, grid);
      if (
        !tile ||
        seen.has(`${tile.q},${tile.r}`) ||
        retainedCoordinates.has(`${tile.q},${tile.r}`) ||
        retained.some(({ territoryId }) => territoryId === tile.territoryId)
      )
        return false;
      seen.add(`${tile.q},${tile.r}`);
    }
  return true;
}

/** Check the envelope before the worker attempts to load another version's scenario data. */
export function savedMatchSpec(value: unknown): MatchSpec {
  const raw = upgradeTerritoryWorld(value) as {
    schema?: number;
    gameSchema?: number;
    spec?: MatchSpec;
    rules?: string;
  } | null;
  if (
    !raw?.spec ||
    raw.schema !== 3 ||
    raw.gameSchema !== SAVE_SCHEMA_VERSION ||
    raw.rules !== RULES
  )
    throw new Error(INCOMPLETE_SAVE);
  matchScenario(raw.spec);
  return raw.spec;
}
