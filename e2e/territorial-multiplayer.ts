import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";
import type { FrontierTerritoryId, GameType } from "../src/Types";
import { HEX_NEIGHBORS } from "../src/helpers/HexNeighbors";
import {
  multiplayerClaimQuote,
  multiplayerOwnedTileIds,
  multiplayerTerritoryClaimable,
  multiplayerTerritoryTiles,
} from "../src/helpers/MultiplayerTerritory";
import { closeTileSurface, selectTerritoryMapTile } from "./layout";

type Actor = Pick<Page, "getByRole">;
export const territorialMap = (page: Actor) =>
  page.getByRole("region", { name: "Territorial map workspace", exact: true });

/** Pick the shortest neutral land route to the peer, then claim it through the map. */
export async function claimToPeerBorder(
  page: Page,
  peerId: string,
  readGame: () => Promise<GameType>,
  beforeFirstClaim?: (surface: Locator) => Promise<void>,
) {
  const opening = await readGame();
  const tiles = new Map(
    multiplayerTerritoryTiles(opening).map((tile) => [tile.id, tile]),
  );
  const queue = [...multiplayerOwnedTileIds(opening)];
  const parents = new Map<FrontierTerritoryId, FrontierTerritoryId | undefined>(
    queue.map((id) => [id, undefined]),
  );
  let path: FrontierTerritoryId[] | undefined;
  for (const id of queue) {
    const { q, r } = tiles.get(id)!;
    for (const [dq, dr] of HEX_NEIGHBORS) {
      const neighbor = `frontier:${q + dq}:${r + dr}` as const;
      const owner = opening.multiplayer!.tileOwners?.[neighbor]?.seat;
      if (owner === peerId) {
        path = [];
        for (
          let next: FrontierTerritoryId | undefined = id;
          next;
          next = parents.get(next)
        ) {
          if (parents.get(next)) path.unshift(next);
        }
        break;
      }
      const tile = tiles.get(neighbor);
      if (
        !tile ||
        owner ||
        parents.has(neighbor) ||
        !multiplayerTerritoryClaimable(tile)
      )
        continue;
      parents.set(neighbor, id);
      queue.push(neighbor);
    }
    if (path) break;
  }
  if (!path)
    throw new Error(`No claimable route to ${peerId} on seed ${opening.seed}`);
  if (!path.length) {
    const available = [...tiles.values()].find((tile) =>
      multiplayerClaimQuote(opening, tile.id),
    );
    if (!available) throw new Error("No neighboring neutral land to claim");
    path.push(available.id);
  }

  const map = territorialMap(page);
  const surface = page.locator(".tileWorkspaceInspector:visible");
  for (const [index, id] of path.entries()) {
    expect(multiplayerClaimQuote(await readGame(), id)).toBeDefined();
    const target = await selectTerritoryMapTile(page, tiles.get(id)!, map);
    const claim = surface.getByRole("button", { name: /^Claim for / });
    await expect(claim).toBeEnabled();
    if (index === 0) await beforeFirstClaim?.(surface);
    await claim.click();
    await expect(target).toHaveAttribute("data-owned", "true");
    if (await surface.isVisible()) await closeTileSurface(surface);
  }
}
