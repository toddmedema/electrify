import type { GameType, FacilityOperatingType } from "../Types";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import {
  activeWeatherHazardsFor,
  COLD_DEFINITION_ID,
  facilityHazardStatus,
  HAIL_DEFINITION_ID,
} from "./Hazards";
import { formatDays } from "./Format";
import {
  combustibleTile,
  wildfireTileConditions,
  type FireGroundCondition,
} from "./TerritoryWildfire";

export type TerrainWeather = "dry" | "parched" | FireGroundCondition;

export interface TileDisaster {
  ground?: TerrainWeather;
  hail?: "impact" | "damage";
  frost?: "regional" | "derate";
  condition: string;
  facilityImpact?: string;
}

const groundLabels: Record<TerrainWeather, string> = {
  dry: "Dry forest",
  parched: "Parched forest",
  burning: "Wildfire burning",
  scorched: "Scorched by wildfire",
};

export function readTerritoryDisasters(game: GameType) {
  const minute = game.date.minute;
  const ground = wildfireTileConditions(game.territoryWeather, minute);
  const dryness = game.territoryWeather?.dryness ?? 0;
  const regionalCold = (game.worldEvents?.active ?? []).some(
    (event) =>
      event.definitionId === COLD_DEFINITION_ID &&
      event.attributes.regional === true &&
      event.startsMinute <= minute &&
      event.endsMinute > minute,
  );
  return (
    tile: TerritoryTileDefinition,
    facility?: FacilityOperatingType,
  ): TileDisaster | undefined => {
    const fire = combustibleTile(tile)
      ? ground.get(`${tile.q},${tile.r}`)
      : undefined;
    const terrain =
      fire ??
      (tile.terrain === "forest" && !tile.city
        ? dryness >= 0.65
          ? "parched"
          : dryness >= 0.35
            ? "dry"
            : undefined
        : undefined);
    const outages = facility
      ? activeWeatherHazardsFor(game, facility, minute)
      : [];
    const hailEvent = outages.find(
      (event) => event.definitionId === HAIL_DEFINITION_ID,
    );
    const hail = hailEvent
      ? minute < hailEvent.startsMinute + 60
        ? "impact"
        : "damage"
      : undefined;
    const frost = outages.some(
      (event) => event.definitionId === COLD_DEFINITION_ID,
    )
      ? "derate"
      : regionalCold && !tile.city && tile.terrain !== "ocean"
        ? "regional"
        : undefined;
    const condition = [
      terrain && groundLabels[terrain],
      hail && (hail === "impact" ? "Hail strike" : "Hail repairs in progress"),
      frost && "Extreme cold",
    ]
      .filter(Boolean)
      .join(" · ");
    if (!condition) return undefined;
    const outage =
      facility && outages.length
        ? facilityHazardStatus(game, facility)
        : undefined;
    const combined =
      new Set(outages.map(({ definitionId }) => definitionId)).size > 1;
    return {
      ground: terrain,
      hail,
      frost,
      condition,
      facilityImpact: outage
        ? `${combined ? "Combined weather impact" : outage.label} · ${Math.round(outage.availableFraction * 100)}% available${outage.daysLeft === undefined ? "" : ` · ${formatDays(outage.daysLeft)} to repair`}`
        : undefined,
    };
  };
}
