import type { GameType } from "../Types";
import {
  frontierCoordinates,
  territoryCoordinateHash,
} from "../data/Territories";
import { MUNICIPAL_UTILITIES } from "../data/MunicipalUtilities";
import {
  POWER_AGREEMENT_BLOCKS,
  UTILITY_AREAS,
} from "../data/UtilityExpansion";
import { claimedUtilityLogo, type UtilityLogoId } from "../data/UtilityLogos";
import { shuffledUtilityLogos } from "./UtilityLogoAssignment";

const NPC_UTILITIES = [
  ...Object.keys(UTILITY_AREAS),
  ...MUNICIPAL_UTILITIES.map(({ city }) => `municipal:${city.id}`),
  "regional-supplier",
  "quebec-hydro",
];

export function utilityBranding(
  seed: number,
  selected: UtilityLogoId | undefined,
  players: NonNullable<GameType["multiplayer"]>["utilityLogos"],
  seat?: string,
) {
  const shuffled = shuffledUtilityLogos(seed);
  const player =
    (seat && players && claimedUtilityLogo(players, seat)) ||
    selected ||
    shuffled[0];
  const assigned = new Set([player, ...Object.values(players ?? {})]);
  const pool = shuffled.filter((id) => !assigned.has(id));
  // With four players the remaining palette can repeat across NPCs.
  const npcs = new Map(
    NPC_UTILITIES.map((key, index) => [key, pool[index % pool.length]]),
  );
  const frontierLogos =
    pool.length > NPC_UTILITIES.length
      ? pool.slice(NPC_UTILITIES.length)
      : pool;
  return {
    forOwner(owner?: string): UtilityLogoId | undefined {
      if (owner === "you") return player;
      if (owner?.startsWith("peer:") && players)
        return claimedUtilityLogo(players, owner.slice(5));
      if (owner?.startsWith("municipal:frontier:")) {
        const coordinates = frontierCoordinates(
          owner.slice("municipal:".length),
        );
        if (coordinates) {
          const { q, r } = coordinates;
          // Older maps can retain an open-ended frontier. Discovery order cannot
          // change a town's logo, and the pool excludes every player mark.
          return frontierLogos[
            territoryCoordinateHash(q, r, `utility-logo:${seed}`) %
              frontierLogos.length
          ];
        }
      }
      return owner ? npcs.get(owner) : undefined;
    },
    forTrade(id: string): UtilityLogoId {
      const block = POWER_AGREEMENT_BLOCKS.find(
        (entry) => id === entry.id || id.startsWith(`${entry.id}:`),
      );
      const supplier =
        block && "sellerUtilityId" in block
          ? block.sellerUtilityId
          : block && "marketId" in block
            ? "quebec-hydro"
            : "regional-supplier";
      return npcs.get(supplier)!;
    },
  };
}

export function gameUtilityBranding({
  seed,
  utilityLogo,
  multiplayer,
}: Pick<GameType, "seed" | "utilityLogo" | "multiplayer">) {
  return utilityBranding(
    seed,
    utilityLogo,
    multiplayer?.utilityLogos,
    multiplayer?.seat,
  );
}
