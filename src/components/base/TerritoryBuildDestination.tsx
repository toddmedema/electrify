import { pendingTileConnections } from "../../helpers/TerritoryConnections";
import * as React from "react";
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { getTerritoryDefinition } from "../../data/Territories";
import { ownedTerritories } from "../../helpers/Territories";
import {
  createTerritoryTileOwnership,
  facilityOnTile,
  getTerritoryTile,
  getTerritoryTiles,
  isGeneralBuildingLand,
  territoryTilePowerLimit,
} from "../../helpers/TerritoryTiles";
import { formatWatts } from "../../helpers/Format";
import type {
  FacilityShoppingType,
  GameType,
  TerritoryId,
  TerritoryTileId,
} from "../../Types";
import type { TerritorySiteKind } from "../../data/Territories";
import { territoryMapLabel } from "./TerritoryMapLayout";
import { useToolState } from "./GameToolMemory";

export const TERRITORY_BUILD_MEMORY_KEY = "build.territory";
export const TERRITORY_TILE_BUILD_MEMORY_KEY = "build.tile";

export function territoryName(id: TerritoryId): string {
  return territoryMapLabel(id);
}

export function useTerritoryBuildDestination() {
  return useToolState<TerritoryId>(TERRITORY_BUILD_MEMORY_KEY, "champlain");
}

export function useTerritoryBuildTile() {
  return useToolState<TerritoryTileId | undefined>(
    TERRITORY_TILE_BUILD_MEMORY_KEY,
    undefined,
  );
}

const SITE_NAMES: Record<TerritorySiteKind, string> = {
  industrial: "thermal generation",
  wind: "wind",
  "open-land": "solar and storage",
  general: "general construction",
  hydro: "hydropower",
  geothermal: "geothermal",
};

/** Human-readable terrain and site identity; internal tile IDs stay out of player copy. */
export function territoryBuildTileName(
  tileId: TerritoryTileId,
  game?: Pick<GameType, "facilities">,
  facility?: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): string {
  const tile = getTerritoryTile(tileId, game);
  if (!tile || tile.city) return "Building site";
  const peers = getTerritoryTiles(game).filter(
    (other) =>
      !other.city &&
      other.territoryId === tile.territoryId &&
      other.terrain === tile.terrain &&
      other.siteKind === tile.siteKind,
  );
  const terrain = tile.terrain[0].toUpperCase() + tile.terrain.slice(1);
  const number =
    peers.length > 1
      ? ` ${peers.findIndex((other) => other.id === tile.id) + 1}`
      : "";
  const ordinary = isGeneralBuildingLand(tile);
  const site = ordinary
    ? "general construction"
    : tile.terrain === "ocean"
      ? "offshore wind"
      : SITE_NAMES[tile.siteKind];
  const limit = ` · ${formatWatts(territoryTilePowerLimit(tile, facility))} max${ordinary && !facility ? "; varies by technology" : ""}`;
  return `${terrain} site${number} · ${site}${limit}`;
}

export default function TerritoryBuildDestination({
  game,
  value,
  onChange,
  tileId,
  onTileChange,
}: {
  game: GameType;
  value: TerritoryId;
  onChange: (id: TerritoryId) => void;
  tileId?: TerritoryTileId;
  onTileChange: (id: TerritoryTileId | undefined) => void;
}) {
  const id = React.useId();
  const owned = new Set(ownedTerritories(game));
  const destinations = new Set([...owned, value]);
  const ownsTile = createTerritoryTileOwnership(game);
  const pending = pendingTileConnections(game);
  const freeTiles = getTerritoryTiles(game).filter(
    (tile) =>
      !tile.city &&
      tile.territoryId === value &&
      ownsTile(tile) &&
      !pending.has(tile.id) &&
      !facilityOnTile(game, tile.id) &&
      (!tile.hydroSiteId ||
        !game.commissionedHydroSiteIds?.includes(tile.hydroSiteId)),
  );
  const validTileId = freeTiles.some((tile) => tile.id === tileId)
    ? tileId
    : undefined;
  React.useEffect(() => {
    if (tileId !== undefined && validTileId === undefined)
      onTileChange(undefined);
  }, [tileId, validTileId, onTileChange]);
  return (
    <div className="territoryBuildDestination">
      <FormControl fullWidth size="small">
        <InputLabel id={`${id}-label`}>Build destination</InputLabel>
        <Select
          labelId={`${id}-label`}
          label="Build destination"
          value={value}
          onChange={(event) => {
            onTileChange(undefined);
            onChange(event.target.value as TerritoryId);
          }}
        >
          {[...destinations].map((destination) => {
            const territory = getTerritoryDefinition(destination);
            if (
              !territory ||
              (destination !== value &&
                !Object.values(territory.sites).some((site) => site.count > 0))
            )
              return null;
            return (
              <MenuItem
                key={destination}
                value={destination}
                disabled={!owned.has(destination)}
              >
                {territoryName(destination)}
                {!owned.has(destination) ? " · not owned" : ""}
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>
      <FormControl fullWidth size="small" sx={{ mt: 2 }}>
        <InputLabel id={`${id}-tile-label`} shrink>
          Build tile
        </InputLabel>
        <Select
          labelId={`${id}-tile-label`}
          label="Build tile"
          value={validTileId ?? ""}
          displayEmpty
          notched
          onChange={(event) =>
            onTileChange(
              event.target.value
                ? (event.target.value as TerritoryTileId)
                : undefined,
            )
          }
        >
          <MenuItem value="">Choose a free tile automatically</MenuItem>
          {freeTiles.map((tile) => (
            <MenuItem
              key={tile.id}
              value={tile.id}
              sx={{ whiteSpace: "normal" }}
            >
              {territoryBuildTileName(tile.id, game)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="textSecondary">
        One project per tile. Cities have no building slot. All owned facilities
        serve your company power pool.
      </Typography>
    </div>
  );
}
