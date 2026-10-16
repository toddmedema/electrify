import type { TransmissionCorridorDefinitionType } from "../Types";
import { INTERTIE_CONSTRUCTION_REFERENCE_COST_PER_W } from "../Constants";

export const MULTIPLAYER_LINK_BUILD_COST_PER_W =
  INTERTIE_CONSTRUCTION_REFERENCE_COST_PER_W;

/** Share of each grid's forecast peak demand that its starting player links can carry. */
export const MULTIPLAYER_LINK_BUDGET_FRACTION = 0.25;
/** Annual operating cost of a player link, in dollars per watt of capacity. */
export const MULTIPLAYER_LINK_OPERATING_COST_PER_W = 0.005;
/** Longest menu or notification reason a player can report as their pause. */
export const MULTIPLAYER_MAX_ACTIVITY_REASON_LENGTH = 120;

/**
 * Peer trades clear at a gas-indexed price: a base plus gas burned at a typical heat rate
 * (MMBtu per MWh), never below the floor. A match opens at the floor.
 */
export const PEER_TRADE_MIN_PRICE_PER_MWH = 80;
export const PEER_TRADE_BASE_PRICE_PER_MWH = 30;
export const PEER_TRADE_GAS_HEAT_RATE = 10;
/** Each grid keeps this share of its own demand in reserve before offering peers surplus. */
export const PEER_TRADE_RESERVE_FRACTION = 0.02;

/** Player links derate in heat and sun like a typical existing intertie. */
export const PEER_CORRIDOR_DERATE: Pick<
  TransmissionCorridorDefinitionType,
  "heatDerateStartsC" | "heatDeratePerC" | "solarDerateFraction"
> = { heatDerateStartsC: 30, heatDeratePerC: 0.005, solarDerateFraction: 0.02 };

const PEER_CORRIDOR_PREFIX = "peer:";
/** A player link's corridor ID; both owners' lines share it. */
export const peerCorridorId = (edgeId: string) =>
  `${PEER_CORRIDOR_PREFIX}${edgeId}`;
export const isPeerCorridorId = (corridorId: string) =>
  corridorId.startsWith(PEER_CORRIDOR_PREFIX);
export const edgeIdFromPeerCorridor = (corridorId: string) =>
  isPeerCorridorId(corridorId)
    ? corridorId.slice(PEER_CORRIDOR_PREFIX.length)
    : undefined;
