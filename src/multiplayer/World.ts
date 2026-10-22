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
import { summarizeHistory } from "../helpers/DateTime";
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
  upgradeTransmissionLine,
} from "../reducers/Game";
import * as gameActions from "../reducers/GameActions";
import { clearPeerMarket } from "./Market";
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
  ScenarioType,
  SpeedType,
} from "../Types";
import { parseSave, serializeSave, validTransmissionLine } from "../SaveGame";
import { intertiesEnabledForScenario } from "../data/AdjacentMarkets";
import { accessContextForGame } from "../data/IntertieAccess";
import { SAVE_SCHEMA_VERSION } from "../SaveUpgrade";

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

function syncClock(world: World) {
  const active = activeSeats(world);
  const pausedBy = active.filter(
    (seat) =>
      world.activities[seat.id] || world.selectedSpeeds[seat.id] === "PAUSED",
  );
  // A scenario choice stops the shared clock until each company still playing has answered.
  const choosing = active.filter((seat) =>
    pendingScenarioChoice(world.grids[world.seats.indexOf(seat)]),
  );
  world.speed =
    world.readyRequired || pausedBy.length || choosing.length || !active.length
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
  // shared tick's energy and settlement intact; only the immediate purchase changes cash.
  if (recorded && updated) {
    const { cash, netWorth } = updated;
    // The reducer froze the recorded tick's nested objects; the live grid is mutated in place.
    Object.assign(updated, cloneDeep(recorded), { cash, netWorth });
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
    scenario.mod !== undefined ||
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
      tradingPolicy: "BALANCED",
      lines: (result.transmission?.lines || []).filter((line) =>
        scenario.startingInterties?.includes(line.corridorId),
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
        annualOperatingCost: capacityW * MULTIPLAYER_LINK_OPERATING_COST_PER_W,
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
          buildCost: (edge.capacityW * EDGE_COST_PER_W) / 2,
          annualOperatingCost: edge.annualOperatingCost / 2,
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
    const name = command.name;
    if (!isGameCommand(name)) return "That game action is unavailable";
    const validation = validateGameCommand(game, name, command.payload);
    if ("error" in validation) return validation.error;
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
    world.grids[index] = commandResult(
      game,
      reducer(game, commandAction(name, validation.payload)),
    );
    if (
      name === "buildFacility" &&
      world.grids[index].facilities.length === before
    )
      return "Not enough cash or no site available";
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
      return `Choose a rate between $0.00 and ${max.toFixed(2)}/kWh`;
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
    const phase = tickStatePhases(g);
    const planned = phase.next();
    if (planned.done)
      throw new Error("A grid could not prepare its shared tick");
    const plan = { ...planned.value };
    const policy = g.transmission?.tradingPolicy;
    if (policy === "CLOSED" || policy === "RELIABILITY_FIRST") plan.offerW = 0;
    if (policy === "CLOSED" || policy === "SURPLUS_ONLY") plan.shortageW = 0;
    return { phase, plan };
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
  const settlements = clearPeerMarket(
    world.seats.map((s) => s.id),
    phases.map((p) => p.plan),
    world.edges,
  );
  phases.forEach(({ phase }, i) => {
    if (!phase) return;
    selectWeatherLocation(world.grids[i].location.id);
    if (!phase.next(settlements[i]).done)
      throw new Error("A grid settled more than once");
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
      },
    ];
  });
}

export function roomView(world: World, seatId: string): RoomView {
  const index = world.seats.findIndex((s) => s.id === seatId);
  if (index < 0) throw new Error("Player is not in this match");
  const game = cloneGrid(world.grids[index]);
  game.multiplayer = {
    ...game.multiplayer!,
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
          world.activities[seat.id] ||
          (pendingScenarioChoice(world.grids[world.seats.indexOf(seat)])
            ? "Choosing a response"
            : undefined) ||
          (world.readyRequired && !world.ready.includes(seat.id)
            ? "Paused"
            : undefined),
      })),
    },
  };
  return {
    game,
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
    typeof world.rules !== "string" ||
    !world.rules ||
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
function validGrid(world: World, initial: World, i: number) {
  const g = world.grids[i];
  const scenario = getScenario(g.scenarioId, g.customScenario)!;
  const expectedConnections = initial.grids[i].transmission!.lines.filter(
    (line) =>
      !g.legacyWildfireIntertieAccess || isPeerCorridorId(line.corridorId),
  );
  const lineCount = expectedConnections.length;
  return (
    !!parseSave(
      serializeSave({
        ...g,
        multiplayer: undefined,
        transmission: intertiesEnabledForScenario(scenario, g.location)
          ? { tradingPolicy: g.transmission!.tradingPolicy, lines: [] }
          : undefined,
      }),
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
        expectedConnections.some(
          (expected) => expected.corridorId === line.corridorId,
        ) && validTransmissionLine(line, g.date.year, accessContextForGame(g)),
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

export function restoreWorld(
  value: unknown,
  epoch: string,
  seats?: Seat[],
): World {
  const world = upgradeWorld(value);
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
  if (
    !world.grids.every((_grid, i) => validGrid(world, initial, i)) ||
    !validEdges(world, ids, initial)
  )
    throw new Error(INVALID_GRIDS);
  restoreCommitments(world, result);
  if (seats) reassignSeats(result, seats);
  result.rules = RULES;
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

/** Upgrade a whole checkpoint as a copy; no grid reaches play until all pass validation. */
function upgradeWorld(value: unknown): World {
  savedMatchSpec(value);
  if (!value || typeof value !== "object") throw new Error(INCOMPLETE_SAVE);
  const raw = value as Omit<World, "schema" | "gameSchema"> & {
    schema: number;
    gameSchema?: number;
  };
  if (![2, 3].includes(raw.schema) || !Array.isArray(raw.grids))
    throw new Error(INCOMPLETE_SAVE);
  // Schema 2 predates per-grid versions; its grids used solo structure 2.
  const gameSchema = raw.schema === 2 ? 2 : raw.gameSchema;
  if (!Number.isInteger(gameSchema) || gameSchema! < 0)
    throw new Error(INCOMPLETE_SAVE);
  const world = cloneDeep(raw) as World;
  world.schema = 3;
  world.gameSchema = SAVE_SCHEMA_VERSION;
  world.grids = world.grids.map((grid) => {
    if (!grid || typeof grid !== "object") throw new Error(INVALID_GRIDS);
    const scenario = getScenario(grid.scenarioId, grid.customScenario);
    if (!scenario || !grid.transmission) throw new Error(INVALID_GRIDS);
    const parsed = parseSave({
      ...serializeSave({
        ...grid,
        multiplayer: undefined,
        transmission: intertiesEnabledForScenario(scenario, grid.location)
          ? { tradingPolicy: grid.transmission.tradingPolicy, lines: [] }
          : undefined,
      }),
      schemaVersion: gameSchema,
    });
    if (!parsed) throw new Error(INVALID_GRIDS);
    // Peer topology is checked against the complete roster after solo migrations.
    return {
      ...parsed.game,
      // Schema 5 adds authored outside connections; older matches retain their peer-only topology.
      ...(gameSchema! < 5 && grid.scenarioId === 111
        ? { legacyWildfireIntertieAccess: true }
        : {}),
      multiplayer: grid.multiplayer,
      transmission: grid.transmission,
    };
  });
  return world;
}

/** Check the envelope before the worker attempts to load another version's scenario data. */
export function savedMatchSpec(value: unknown): MatchSpec {
  const raw = value as {
    schema?: number;
    gameSchema?: number;
    spec?: MatchSpec;
  } | null;
  if ((raw?.schema ?? 0) > 3 || (raw?.gameSchema ?? 0) > SAVE_SCHEMA_VERSION)
    throw new Error(
      "This multiplayer save needs a newer game. Refresh to update. Your original save is preserved.",
    );
  if (!raw?.spec || ![2, 3].includes(raw.schema!))
    throw new Error(INCOMPLETE_SAVE);
  return raw.spec;
}
