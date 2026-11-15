import * as React from "react";
import type { GameType, TerritoryId } from "../../Types";
import { TERRITORIES } from "../../data/Territories";
import { UTILITY_AREAS } from "../../data/UtilityExpansion";
import {
  facilityTerritoryId,
  ownedTerritories,
} from "../../helpers/Territories";
import TerritoryTileArt, {
  TerritoryTileArtKind,
} from "../base/TerritoryTileArt";

interface HexTile {
  q: number;
  r: number;
  territory: TerritoryId;
  kind: TerritoryTileArtKind;
  landmark?: boolean;
}

// Landscape cues are schematic, not build slots or individual customer groups.
const tiles: readonly HexTile[] = [
  { q: 0, r: -2, territory: "champlain", kind: "lake", landmark: true },
  { q: 1, r: -2, territory: "champlain", kind: "hills", landmark: true },
  { q: 2, r: -2, territory: "ridge-electric", kind: "hills", landmark: true },
  { q: -1, r: -1, territory: "champlain", kind: "plains" },
  { q: 0, r: -1, territory: "champlain", kind: "town", landmark: true },
  {
    q: 1,
    r: -1,
    territory: "ridge-electric",
    kind: "industry",
    landmark: true,
  },
  { q: 2, r: -1, territory: "ridge-electric", kind: "hills" },
  { q: -2, r: 0, territory: "champlain", kind: "plains" },
  { q: -1, r: 0, territory: "green-uplands", kind: "hills", landmark: true },
  { q: 0, r: 0, territory: "valley-electric", kind: "plains" },
  { q: 1, r: 0, territory: "ridge-electric", kind: "plains", landmark: true },
  { q: 2, r: 0, territory: "ridge-electric", kind: "hills" },
  { q: -2, r: 1, territory: "green-uplands", kind: "hills" },
  { q: -1, r: 1, territory: "green-uplands", kind: "plains", landmark: true },
  { q: 0, r: 1, territory: "valley-electric", kind: "town", landmark: true },
  { q: 1, r: 1, territory: "valley-electric", kind: "lake", landmark: true },
  { q: -2, r: 2, territory: "green-uplands", kind: "hills" },
  { q: -1, r: 2, territory: "valley-electric", kind: "plains" },
  { q: 0, r: 2, territory: "valley-electric", kind: "plains" },
];

const corners = [
  [0, -38],
  [64, -19],
  [64, 19],
  [0, 38],
  [-64, 19],
  [-64, -19],
] as const;
const neighbors = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;
const hexFace = "M0-38 64-19V19L0 38-64 19V-19Z";
const hexRim = "M-64 19 0 38 64 19V26L0 45-64 26Z";
const center = ({ q, r }: Pick<HexTile, "q" | "r">) => ({
  x: 360 + 128 * q + 64 * r,
  y: 208 + 57 * r,
});
// Number markers use hexes without landmarks, keeping those silhouettes clear.
const mapTerritories: readonly {
  id: TerritoryId;
  number: number;
  q: number;
  r: number;
  cue: string;
}[] = [
  { id: "champlain", number: 1, q: -1, r: -1, cue: "Town · existing hydro" },
  {
    id: "ridge-electric",
    number: 2,
    q: 2,
    r: 0,
    cue: "Industry · wind sites",
  },
  {
    id: "green-uplands",
    number: 3,
    q: -2,
    r: 1,
    cue: "No customers · wind / solar sites",
  },
  {
    id: "valley-electric",
    number: 4,
    q: 0,
    r: 2,
    cue: "Town · existing hydro",
  },
];
const boundaries = new Map<TerritoryId, string>(
  mapTerritories.map(({ id }) => [
    id,
    tiles
      .filter((tile) => tile.territory === id)
      .flatMap((tile) => {
        const { x, y } = center(tile);
        return neighbors.flatMap(([dq, dr], edge) => {
          if (
            tiles.some(
              (neighbor) =>
                neighbor.q === tile.q + dq &&
                neighbor.r === tile.r + dr &&
                neighbor.territory === id,
            )
          )
            return [];
          const [fromX, fromY] = corners[edge];
          const [toX, toY] = corners[(edge + 1) % corners.length];
          return [`M${x + fromX} ${y + fromY}L${x + toX} ${y + toY}`];
        });
      })
      .join(" "),
  ]),
);
const resourceLegend: readonly {
  kind: TerritoryTileArtKind;
  label: string;
}[] = [
  { kind: "town", label: "Customers" },
  { kind: "lake", label: "Existing hydro" },
  { kind: "plains", label: "Solar / storage sites" },
  { kind: "hills", label: "Wind sites" },
];

interface Props {
  game: GameType;
  selected: TerritoryId;
  status: (id: TerritoryId, compact?: boolean) => string;
  onSelect: (id: TerritoryId) => void;
}

export default function TerritoryHexMap({
  game,
  selected,
  status,
  onSelect,
}: Props) {
  const mapId = React.useId();
  const owned = ownedTerritories(game);
  const built = (id: TerritoryId, kind: TerritoryTileArtKind) => {
    const facilities = owned.includes(id)
      ? game.facilities.filter(
          (facility) => facilityTerritoryId(facility) === id,
        )
      : id === "green-uplands"
        ? []
        : UTILITY_AREAS[id].facilities;
    if (kind === "town" || kind === "industry") return true;
    return facilities.some((facility) => {
      if ("yearsToBuildLeft" in facility && facility.yearsToBuildLeft > 0)
        return false;
      if (kind === "lake") return facility.fuel === "Hydro";
      if (kind === "plains") return facility.fuel === "Sun";
      return (
        facility.fuel === "Wind" ||
        facility.fuel === "Offshore Wind" ||
        facility.fuel === "Airborne Wind"
      );
    });
  };
  return (
    <div className="territoryMap" aria-label="Territories and land ownership">
      <svg
        className="territoryHexGrid"
        viewBox="0 0 720 400"
        role="img"
        aria-labelledby={`${mapId}-title`}
        aria-describedby={`${mapId}-description`}
        focusable="false"
      >
        <title id={`${mapId}-title`}>Four-territory hex map</title>
        <desc id={`${mapId}-description`}>
          Champlain is northwest, Ridge Electric northeast, Green Uplands
          southwest, and Valley Electric southeast. Owned territories share your
          company's power pool. Landscape tiles show customers, existing hydro,
          and potential building sites, not individual build slots. Select a
          numbered territory using the key below.
        </desc>
        <g aria-hidden="true">
          {tiles.map((tile) => {
            const { x, y } = center(tile);
            return (
              <g
                key={`${tile.q},${tile.r}`}
                className="territoryHex"
                data-territory={tile.territory}
                data-kind={tile.kind}
                data-selected={tile.territory === selected}
                data-owned={owned.includes(tile.territory)}
                transform={`translate(${x} ${y})`}
                onPointerUp={() => onSelect(tile.territory)}
              >
                <path className="territoryHexRim" d={hexRim} />
                <path className="territoryHexFace" d={hexFace} />
                {!tile.landmark && (
                  <path
                    className="territoryHexTerrain"
                    d={
                      tile.kind === "hills"
                        ? "M-38 12Q-22-14-4 8Q16-16 38 12"
                        : "M-34 5H-10M6 5H30M-22 16H18"
                    }
                  />
                )}
              </g>
            );
          })}
          {mapTerritories.map(({ id }) => (
            <path
              key={id}
              className="territoryHexBoundary"
              data-selected={id === selected}
              data-owned={owned.includes(id)}
              d={boundaries.get(id)}
            />
          ))}
          {tiles
            .filter((tile) => tile.landmark)
            .map((tile) => {
              const { x, y } = center(tile);
              return (
                <svg
                  key={`${tile.q},${tile.r}`}
                  className="territoryHexArt"
                  x={x - 48}
                  y={y - 64}
                  width="96"
                  height="96"
                  viewBox="0 0 500 500"
                  focusable="false"
                >
                  <TerritoryTileArt
                    kind={tile.kind}
                    built={built(tile.territory, tile.kind)}
                  />
                </svg>
              );
            })}
          {mapTerritories.map((territory) => {
            const { x, y } = center(territory);
            return (
              <g
                key={territory.id}
                className="territoryHexHub"
                data-selected={territory.id === selected}
                data-owned={owned.includes(territory.id)}
                transform={`translate(${x} ${y})`}
                onPointerUp={() => onSelect(territory.id)}
              >
                <circle r="21" />
                <text className="territoryHexHubLabel">{territory.number}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="territoryMapKey">
        {mapTerritories.map(({ id, number, cue }) => {
          const { name } = TERRITORIES.find(
            (territory) => territory.id === id,
          )!;
          const currentCue =
            (id === "champlain" || id === "valley-electric") &&
            !built(id, "lake")
              ? "Town · wind / solar sites"
              : cue;
          return (
            <button
              key={id}
              type="button"
              className="territoryMapNode"
              data-owned={owned.includes(id)}
              aria-pressed={selected === id}
              aria-label={`Inspect ${name} territory`}
              aria-describedby={`${mapId}-status-${id} ${mapId}-cue-${id}`}
              onClick={() => onSelect(id)}
            >
              <span className="territoryMapNumber" aria-hidden="true">
                {number}
              </span>
              <strong>{name}</strong>
              <span className="territoryMapStatus" id={`${mapId}-status-${id}`}>
                {status(id, true)}
              </span>
              <span className="srOnly" id={`${mapId}-cue-${id}`}>
                {currentCue}
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="territoryResourceLegend"
        role="note"
        aria-label="Landscape cues"
      >
        {resourceLegend.map(({ kind, label }) => (
          <span key={kind}>
            <TerritoryTileArt kind={kind} built={kind === "lake"} />
            <span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
