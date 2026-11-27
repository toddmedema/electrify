import { TICK_MINUTES } from "../Constants";
import { isConventionalHydro } from "../data/HydroSites";
import { peerCorridorId } from "../data/Multiplayer";
import {
  COAL_REPOWER_OPTIONS,
  validCompletedCoalRepower,
} from "../helpers/CoalRepower";
import { getDateFromMinute } from "../helpers/DateTime";
import {
  GAS_CONVERSION_FIRST_YEAR,
  GAS_CONVERSION_MINUTES,
} from "../helpers/GasConversion";
import {
  multiplayerClaimQuote,
  multiplayerTerritoryTile,
} from "../helpers/MultiplayerTerritory";
import {
  territoryHexDistance,
  tileFitsFacility,
} from "../helpers/TerritoryTiles";
import {
  isStorage,
  type FacilityOperatingType,
  type GameType,
  type TerritoryTileId,
} from "../Types";
import type { Edge, World } from "./Types";

const validMinute = (minute: number, limit: number) =>
  Number.isSafeInteger(minute) &&
  minute >= 0 &&
  minute <= limit &&
  minute % TICK_MINUTES === 0;

/** The original plant and upgrades that retain its site may keep its inherited capacity. */
function retainsOpeningCapacity(
  game: GameType,
  facility: FacilityOperatingType,
  opening: FacilityOperatingType,
) {
  if (
    facility.peakW > opening.peakW ||
    (facility.peakWh ?? 0) > (opening.peakWh ?? 0) ||
    facility.hydroSiteId !== opening.hydroSiteId
  )
    return false;
  const sameEquipmentAge =
    facility.minuteCreated === opening.minuteCreated &&
    facility.minuteOperational === opening.minuteOperational;
  if (
    sameEquipmentAge &&
    facility.name === opening.name &&
    facility.fuel === opening.fuel &&
    facility.gasCycle === opening.gasCycle
  )
    return true;
  if (isStorage(facility) || facility.fuel !== "Natural Gas") return false;

  const combined =
    facility.name === COAL_REPOWER_OPTIONS.coalToGasCC.name &&
    facility.gasCycle === "combined";
  const latestGasConversionStart = game.date.minute - GAS_CONVERSION_MINUTES;
  const couldConvertPeaker =
    combined &&
    latestGasConversionStart >= facility.minuteCreated &&
    getDateFromMinute(latestGasConversionStart, game.startingYear).year >=
      GAS_CONVERSION_FIRST_YEAR;
  if (sameEquipmentAge)
    return (
      opening.fuel === "Natural Gas" &&
      opening.gasCycle === "simple" &&
      facility.peakW === opening.peakW &&
      couldConvertPeaker
    );

  if (
    opening.fuel !== "Coal" ||
    facility.minuteCreated !== facility.minuteOperational
  )
    return false;
  // Coal can commission a combined-cycle plant directly or a peaker that can later be converted.
  const peaker =
    facility.name === COAL_REPOWER_OPTIONS.coalToGasPeaker.name &&
    facility.gasCycle === "simple";
  return (
    (combined &&
      validCompletedCoalRepower(
        game,
        "coalToGasCC",
        opening.peakW,
        facility.minuteCreated,
        facility.peakW,
      )) ||
    ((peaker || couldConvertPeaker) &&
      validCompletedCoalRepower(
        game,
        "coalToGasPeaker",
        opening.peakW,
        facility.minuteCreated,
        facility.peakW,
      ))
  );
}

/** Regenerate the immutable opening, then replay each company's connected claim ledger. */
export function validTerritorialOwnership(world: World, initial: World) {
  if (world.spec.territorialVersion !== 1)
    return world.grids.every(
      (grid) => grid.multiplayer?.territorial === undefined,
    );
  const taken = new Set<TerritoryTileId>();
  for (const [index, grid] of world.grids.entries()) {
    const opening = initial.grids[index];
    const multiplayer = grid.multiplayer!;
    const state = multiplayer.territorial;
    const expected = opening.multiplayer!.territorial!;
    if (
      !state ||
      grid.seed !== opening.seed ||
      !Array.isArray(state.claims) ||
      !Array.isArray(grid.facilities) ||
      Object.keys(state).length !== Object.keys(expected).length ||
      Object.entries(expected).some(
        ([key, value]) =>
          key !== "claims" &&
          JSON.stringify(state[key as keyof typeof state]) !==
            JSON.stringify(value),
      ) ||
      multiplayer.tileOwners !== undefined ||
      multiplayer.tileFacilities !== undefined ||
      multiplayer.landOwner !== undefined ||
      multiplayer.landOwners !== undefined ||
      multiplayer.legacyTiles !== undefined ||
      multiplayer.clock !== undefined ||
      multiplayer.results !== undefined
    )
      return false;
    for (const tileId of expected.startingTileIds) {
      if (taken.has(tileId)) return false;
      taken.add(tileId);
    }
  }
  for (const [index, grid] of world.grids.entries()) {
    const multiplayer = grid.multiplayer!;
    const state = multiplayer.territorial!;
    const replay = { ...state, claims: [] as typeof state.claims };
    const quotingGrid = {
      ...grid,
      multiplayer: { ...multiplayer, territorial: replay },
    };
    const rights = new Map<TerritoryTileId, number>(
      state.startingTileIds.map((tileId) => [tileId, 0]),
    );
    let lastMinute = 0;
    for (const receipt of state.claims) {
      if (
        !receipt ||
        taken.has(receipt.tileId) ||
        !Number.isFinite(receipt.price) ||
        receipt.price <= 0 ||
        !validMinute(receipt.minute, grid.date.minute) ||
        receipt.minute < lastMinute ||
        multiplayerClaimQuote(quotingGrid, receipt.tileId)?.price !==
          receipt.price
      )
        return false;
      lastMinute = receipt.minute;
      taken.add(receipt.tileId);
      rights.set(receipt.tileId, receipt.minute);
      replay.claims.push(receipt);
    }
    const opening = initial.grids[index];
    const occupied = new Set<TerritoryTileId>();
    for (const facility of grid.facilities) {
      const tile = multiplayerTerritoryTile(grid, facility?.tileId);
      if (
        !tile ||
        occupied.has(tile.id) ||
        !validMinute(facility.minuteCreated, grid.date.minute)
      )
        return false;
      const acquired = rights.get(tile.id);
      if (acquired === undefined || acquired > facility.minuteCreated)
        return false;
      if (
        (!tileFitsFacility(tile, facility) ||
          (isConventionalHydro(facility) &&
            facility.hydroSiteId !== tile.hydroSiteId)) &&
        !opening.facilities.some(
          (plant) =>
            plant.tileId === tile.id &&
            plant.id === facility.id &&
            retainsOpeningCapacity(grid, facility, plant),
        )
      )
        return false;
      occupied.add(tile.id);
    }
  }
  return true;
}

function ownedAt(grid: GameType, tileId: TerritoryTileId, minute: number) {
  const state = grid.multiplayer!.territorial!;
  return (
    state.startingTileIds.includes(tileId as typeof state.homeTileId) ||
    state.claims.some(
      (receipt) => receipt.tileId === tileId && receipt.minute <= minute,
    )
  );
}

function validProposalRevision(revision: number | undefined, limit: number) {
  return (
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 1 &&
    revision <= limit
  );
}

/** A crossing uses two paid properties, with only a proposal or two installed line halves. */
export function validTerritorialCrossing(
  world: World,
  edge: Edge,
  expected: Edge,
  grids: GameType[],
) {
  if (
    edge.a !== expected.a ||
    edge.b !== expected.b ||
    typeof edge.disabled !== "boolean" ||
    (edge.approval === undefined
      ? edge.approvalRevision !== undefined
      : !validProposalRevision(edge.approvalRevision, world.revision))
  )
    return false;
  const [a, b] = grids;
  const active = !world.outcomes[edge.a] && !world.outcomes[edge.b];
  const proposal = edge.proposal;
  const crossing = edge.crossing;
  if (
    (proposal !== undefined && (!proposal || typeof proposal !== "object")) ||
    (crossing !== undefined && (!crossing || typeof crossing !== "object"))
  )
    return false;
  const corridorId = peerCorridorId(edge.id);
  const lines = grids.map((grid) =>
    grid.transmission?.lines.find((line) => line.corridorId === corridorId),
  );
  if (!crossing || proposal) {
    if (
      edge.approval !== undefined ||
      edge.approvalFinanced !== undefined ||
      !edge.disabled ||
      edge.flowW !== 0 ||
      edge.ratingW !== 0
    )
      return false;
    if (proposal === undefined) return crossing === undefined;
    if (
      !crossing ||
      !active ||
      (proposal.seat !== edge.a && proposal.seat !== edge.b) ||
      typeof proposal.financed !== "boolean" ||
      !validProposalRevision(proposal.revision, world.revision) ||
      Object.keys(proposal).length !== 4
    )
      return false;
  }
  if (Object.keys(crossing!).length !== 2) return false;
  const [here, there] = [
    multiplayerTerritoryTile(a, crossing!.a),
    multiplayerTerritoryTile(b, crossing!.b),
  ];
  const minute = proposal?.minute ?? lines[0]?.minuteCreated;
  if (
    !here ||
    !there ||
    minute === undefined ||
    !validMinute(minute, Math.min(a.date.minute, b.date.minute)) ||
    territoryHexDistance(here, there) !== 1 ||
    !ownedAt(a, here.id, minute) ||
    !ownedAt(b, there.id, minute)
  )
    return false;
  if (proposal) return true;
  const inactive =
    !active || lines.some((line) => !line || line.yearsToBuildLeft > 0);
  if (
    lines.some(
      (line, index) =>
        !line ||
        line.paused ||
        line.name !==
          world.seats.find(
            (seat) => seat.id === (index === 0 ? edge.b : edge.a),
          )?.name ||
        line.minuteCreated !== minute ||
        line.currentFlowW !== (index === 0 ? -edge.flowW : edge.flowW),
    )
  )
    return false;
  if (inactive)
    return (
      edge.disabled &&
      edge.ratingW === 0 &&
      edge.flowW === 0 &&
      edge.approval === undefined &&
      edge.approvalFinanced === undefined
    );
  return (
    !edge.disabled &&
    edge.ratingW > 0 &&
    (edge.approval === undefined
      ? edge.approvalFinanced === undefined
      : (edge.approval === edge.a || edge.approval === edge.b) &&
        typeof edge.approvalFinanced === "boolean" &&
        lines.every((line) => !line?.upgrade))
  );
}
