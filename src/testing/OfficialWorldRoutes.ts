import "../Store";
import { createHash } from "crypto";
import cloneDeep from "lodash.clonedeep";
import { SAVE_SCHEMA_VERSION } from "../SaveUpgrade";
import { TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { getScenario } from "../data/Scenarios";
import { currentTick } from "../helpers/GameSelectors";
import { publicRateCap } from "../helpers/Customers";
import { getScenarioLocation } from "../helpers/Locations";
import {
  gameObjectiveResults,
  reliabilityMonths,
  reliabilityFailure,
  runFailure,
} from "../helpers/ObjectiveRules";
import type { GameType } from "../Types";
import {
  pendingScenarioChoice,
  optionalScenarioChoice,
} from "../helpers/ScenarioChoices";
import type { Command, World } from "../multiplayer/Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "../multiplayer/World";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import { checkMonth, InvariantCollector } from "./Invariants";
import { coopSeats } from "./MultiplayerFixtures";
import { loadSimData } from "./SimData";
import {
  projectUpstreamWildfireFacilities,
  projectUpstreamWildfireGame,
} from "./UpstreamWildfireComparison";
const codec = require("../../electron/steam-multiplayer.cjs");
export const OFFICIAL_WORLD_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
] as const;
export function canonicalOfficialWorld(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value === 0
        ? 0
        : Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonicalOfficialWorld);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonicalOfficialWorld(v)]),
    );
  return value;
}
export const officialWorldHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalOfficialWorld(value)))
    .digest("hex");
/** The upstream #602 oracle predates the new compact progress representation.
 * Its original Game fields remain exact; the caller separately checks every new
 * observation against the oracle's original completed-month supply/demand. */
const gameHash = (game: GameType) =>
  officialWorldHash(
    game.scenarioId === 111 ? projectUpstreamWildfireGame(game) : game,
  );
const facilitiesHash = (game: GameType) =>
  officialWorldHash(
    game.scenarioId === 111
      ? projectUpstreamWildfireFacilities(game.facilities)
      : game.facilities,
  );
function legacyObjectiveObservation(game: GameType) {
  const scenario = getScenario(game.scenarioId, game.customScenario)!;
  return {
    reliabilityMonths: reliabilityMonths(scenario, game.monthlyHistory),
    reliabilityFailure: reliabilityFailure(scenario, game.monthlyHistory),
    runFailure: runFailure(
      game,
      scenario,
      game.monthlyHistory,
      currentTick(game)!,
      !!scenario.tutorialSteps,
    ),
  };
}
function stateHash(world: World) {
  const { rules: _sourceRules, ...physical } = world;
  if (world.gameSchema !== SAVE_SCHEMA_VERSION || SAVE_SCHEMA_VERSION !== 6)
    throw new Error("Expected the verified schema5-to-6 save migration");
  // The original2fc archive used schema3; the redesigned111 upstream archive
  // used schema5. Certify current schema6 explicitly and project only that
  // version field; every other World field remains in its independent hash.
  const sourceShape = {
    ...physical,
    gameSchema: world.spec.scenarioId === 111 ? 5 : 3,
  };
  return officialWorldHash(
    world.spec.scenarioId === 111
      ? {
          ...sourceShape,
          grids: physical.grids.map((game) =>
            projectUpstreamWildfireGame(game),
          ),
        }
      : sourceShape,
  );
}
function command(world: World, seat: string, action: Command) {
  const error = applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: action,
  });
  expect(error).toBeUndefined();
}
function routePlan(scenarioId: number) {
  const play = STANDARD_BALANCE_PLAYS[scenarioId];
  const rate = play.scheduledActions?.find((action) => action.type === "rate");
  return {
    initialBuild: [108, 110, 111, 114].includes(scenarioId)
      ? {
          name: "Natural Gas Peaker",
          peakW: (
            { 108: 350e6, 110: 700e6, 111: 100e6, 114: 200e6 } as Record<
              number,
              number
            >
          )[scenarioId],
          financed: true,
        }
      : play.initialBuild,
    scheduledActions: (play.scheduledActions ?? []).filter(
      (a) => !["intertie", "intertie-upgrade", "trading"].includes(a.type),
    ),
    sellFacilityId: play.sellFacilityId,
    sellAtMonth: play.sellAtMonth,
    rate: rate?.type === "rate" ? rate.dollarsPerkWh : undefined,
    // Co-op replaces outside markets with player links, so no outside intertie commands are sent.
    choices: "first option for company0, second option for company1" as const,
  };
}
/** Only real quoted builds, public rate commands and explicit per-company responses. */
export function playOfficialWorldRoute(
  scenarioId: number,
  variant: "paired" | "split-shutdown" = "paired",
  observeWildfireProgress?: (
    game: GameType,
    companyIndex: number,
    month: number,
  ) => void,
) {
  const scenario = getScenario(scenarioId)!;
  loadSimData(getScenarioLocation(scenario)!);
  const plan = routePlan(scenarioId);
  const world = createWorld(
    { scenarioId, difficulty: "Employee" },
    coopSeats(2),
    `issue-605-official-${scenarioId}`,
    "initial",
  );
  const initial = cloneDeep(world);
  initial.grids.forEach((game, index) =>
    observeWildfireProgress?.(game, index, 0),
  );
  for (const [index, seat] of world.seats.entries()) {
    const game = world.grids[index];
    if (plan.initialBuild) {
      const build =
        variant === "split-shutdown" && index === 1
          ? { name: "Oil", peakW: 300e6, financed: true }
          : plan.initialBuild;
      if (build.peakW === undefined)
        throw new Error("World route expects a generator build");
      const facility = GENERATORS(
        game,
        build.peakW,
        game.timeline.map((t) => t.windKph),
        game.timeline.map((t) => t.solarIrradianceWM2),
      ).find((f) => f.name === build.name && f.available)!;
      expect(facility).toBeDefined();
      command(world, seat.id, {
        kind: "action",
        name: "buildFacility",
        payload: { facility, financed: build.financed },
      });
      expect(world.grids[index].facilities).toContainEqual(
        expect.objectContaining({ name: build.name, peakW: build.peakW }),
      );
    }
    if (plan.rate !== undefined)
      command(world, seat.id, {
        kind: "rate",
        value: Math.min(
          plan.rate,
          publicRateCap(
            scenario.dollarsPerkWh,
            game.date,
            game.startingYear,
            game.seed,
          ),
        ),
      });
  }
  if (variant === "split-shutdown")
    command(world, world.seats[1].id, {
      kind: "action",
      name: "setTradingPolicy",
      payload: "CLOSED",
    });
  for (const seat of world.seats) command(world, seat.id, { kind: "ready" });
  const decisions: unknown[] = [];
  const receipts: unknown[] = [];
  const seen = new Set<string>();
  const optionalAnswered = new Set<string>();
  const phaseCheckpoints: unknown[] = [];
  const checkpointMonths = new Set<number>();
  let nativeCheckpoint: unknown;
  let steps = 0;
  const actionMonths = new Map<string, number>();
  while (
    Object.keys(world.outcomes).length < world.seats.length &&
    steps < (scenario.durationMonths + 1) * TICKS_PER_MONTH
  ) {
    for (const [index, seat] of world.seats.entries()) {
      if (world.outcomes[seat.id]) continue;
      const game = world.grids[index];
      if (actionMonths.get(seat.id) !== game.date.monthsElapsed) {
        actionMonths.set(seat.id, game.date.monthsElapsed);
        for (const action of plan.scheduledActions.filter(
          (a) => a.month === game.date.monthsElapsed,
        )) {
          const current = world.grids[index];
          switch (action.type) {
            case "rate":
              if (action.month > 0)
                command(world, seat.id, {
                  kind: "rate",
                  value: Math.min(
                    action.dollarsPerkWh,
                    publicRateCap(
                      scenario.dollarsPerkWh,
                      current.date,
                      current.startingYear,
                      current.seed,
                    ),
                  ),
                });
              break;
            case "reprioritize": {
              const spotInList = current.facilities.findIndex(
                (f) => f.id === action.facilityId,
              );
              command(world, seat.id, {
                kind: "action",
                name: "reprioritizeFacility",
                payload: { spotInList, delta: spotInList === 0 ? 1 : -1 },
              });
              break;
            }
            case "toggle":
              command(world, seat.id, {
                kind: "action",
                name: "togglePauseFacility",
                payload: action.facilityId,
              });
              break;
            case "sell":
              command(world, seat.id, {
                kind: "action",
                name: "sellFacility",
                payload: action.facilityId,
              });
              break;
            case "policy":
              command(world, seat.id, {
                kind: "action",
                name: "schedulePolicy",
                payload: {
                  id: action.id,
                  tier: action.tier,
                  month: action.month + 1,
                },
              });
              break;
            case "build": {
              if (action.build.peakW === undefined)
                throw new Error("Expected generator");
              const facility = GENERATORS(
                current,
                action.build.peakW,
                current.timeline.map((t) => t.windKph),
                current.timeline.map((t) => t.solarIrradianceWM2),
              ).find((f) => f.name === action.build.name && f.available)!;
              expect(facility).toBeDefined();
              command(world, seat.id, {
                kind: "action",
                name: "buildFacility",
                payload: { facility, financed: action.build.financed },
              });
              break;
            }
            default:
              throw new Error("External market command in peer World route");
          }
        }
        if (
          plan.sellFacilityId !== undefined &&
          plan.sellAtMonth === game.date.monthsElapsed
        )
          command(world, seat.id, {
            kind: "action",
            name: "sellFacility",
            payload: plan.sellFacilityId,
          });
      }
      const required = pendingScenarioChoice(world.grids[index]);
      const optional = optionalAnswered.has(seat.id)
        ? undefined
        : optionalScenarioChoice(game);
      const choice = required ?? optional;
      if (!choice) continue;
      const option = choice.options[Math.min(index, choice.options.length - 1)];
      if (!nativeCheckpoint) {
        const saved = codec.parse(codec.stringify(checkpointWorld(world)));
        const restored = restoreWorld(saved, "restored");
        expect(restored.grids.map((g) => g.worldEvents)).toEqual(
          world.grids.map((g) => g.worldEvents),
        );
        nativeCheckpoint = {
          month: game.date.monthsElapsed,
          pending: world.grids.map((g) => pendingScenarioChoice(g)?.id),
          histories: world.grids.map((g) =>
            officialWorldHash(g.monthlyHistory),
          ),
          progress: world.grids.map((g) => g.objectiveProgress),
        };
      }
      const before = currentTick(world.grids[index])!.cash;
      command(world, seat.id, {
        kind: "action",
        name: "chooseScenarioResponse",
        payload: { decisionId: choice.id, optionId: option.id },
      });
      expect(pendingScenarioChoice(world.grids[index])?.id).not.toBe(choice.id);
      if (optional && !required) optionalAnswered.add(seat.id);
      decisions.push({
        seat: seat.id,
        month: game.date.monthsElapsed,
        id: choice.id,
        option: option.id,
        beforeCash: before,
        afterCash: currentTick(world.grids[index])!.cash,
        loads: cloneDeep(world.grids[index].loadAdditions),
        occurrences: cloneDeep(world.grids[index].worldEvents.occurrences),
      });
    }
    expect(world.paused).toBe(false);
    stepWorld(world);
    steps++;
    const month = world.grids[0].date.monthsElapsed;
    if (
      scenarioId === 111 &&
      [35, 36, 37, 38, 60].includes(month) &&
      !checkpointMonths.has(month)
    ) {
      checkpointMonths.add(month);
      const restored = restoreWorld(
        codec.parse(codec.stringify(checkpointWorld(world))),
        "restored",
      );
      expect(restored.grids.map((g) => g.monthlyHistory)).toEqual(
        world.grids.map((g) => g.monthlyHistory),
      );
      expect(restored.grids.map((g) => g.worldEvents)).toEqual(
        world.grids.map((g) => g.worldEvents),
      );
      world.grids.forEach((game, index) =>
        observeWildfireProgress?.(game, index, month),
      );
      phaseCheckpoints.push({
        month,
        worldHash: stateHash(world),
        companies: world.grids.map((g) => ({
          monthlyHistoryHash: officialWorldHash(g.monthlyHistory),
          facilitiesHash: facilitiesHash(g),
          gameHash: gameHash(g),
          objectiveObservation: legacyObjectiveObservation(g),
          recentMonths: g.monthlyHistory.slice(0, 3),
          occurrences: g.worldEvents.occurrences,
        })),
      });
    }
    for (const [index, grid] of world.grids.entries())
      for (const receipt of grid.worldEvents.occurrences) {
        const key = `${index}:${receipt.key}`;
        if (seen.has(key)) continue;
        seen.add(key);
        receipts.push({
          seat: world.seats[index].id,
          month: grid.date.monthsElapsed,
          receipt: cloneDeep(receipt),
          active: cloneDeep(grid.worldEvents.active),
          facilitiesHash: facilitiesHash(grid),
        });
      }
  }
  expect(Object.keys(world.outcomes)).toHaveLength(2);
  for (const grid of world.grids) {
    expect(grid.scenarioId).toBe(scenarioId);
    expect(grid.customScenario).toBeUndefined();
    expect(grid.runIdentity).toBeUndefined();
    const violations = new InvariantCollector();
    for (const month of grid.monthlyHistory)
      checkMonth(violations, month, `${month.year}-${month.month}`);
    expect(violations.getViolations()).toEqual([]);
  }
  return canonicalOfficialWorld({
    scenarioId,
    variant,
    plan,
    spec: world.spec,
    initialWorldHash: stateHash(initial),
    finalWorldHash: stateHash(world),
    initialCompanies: initial.grids.map((g, i) => ({
      seat: initial.seats[i].id,
      scenarioId: g.scenarioId,
      seed: g.seed,
      difficulty: g.difficulty,
      location: g.location,
      startingYear: g.startingYear,
      facilitiesHash: facilitiesHash(g),
      completeGameHash: gameHash(g),
    })),
    companies: world.grids.map((g, i) => ({
      seat: world.seats[i].id,
      months: g.monthlyHistory.length,
      monthlyHistoryHash: officialWorldHash(g.monthlyHistory),
      finalFacilitiesHash: facilitiesHash(g),
      completeGameHash: gameHash(g),
      ...(scenarioId === 111
        ? { objectiveObservation: legacyObjectiveObservation(g) }
        : {
            objectiveProgress: g.objectiveProgress,
            objectiveResults: gameObjectiveResults(g),
          }),
      occurrences: g.worldEvents.occurrences,
    })),
    decisions,
    receipts,
    nativeCheckpoint,
    ...(scenarioId === 111 ? { phaseCheckpoints } : {}),
    outcomes: world.outcomes,
  });
}
