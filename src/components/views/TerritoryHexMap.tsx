import * as React from "react";
import type { GameType, TerritoryId } from "../../Types";
import { TERRITORIES, isLandTerritoryId } from "../../data/Territories";
import { UTILITY_AREAS } from "../../data/UtilityExpansion";
import {
  facilityTerritoryId,
  ownedTerritories,
} from "../../helpers/Territories";
import TerritoryTileArt, {
  TerritoryTileArtKind,
} from "../base/TerritoryTileArt";
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  mapTiles,
  mapCenter,
  mapBoundary,
  territoryMapCenter,
  territoryMapLabel,
  territoryPeerColors,
} from "../base/TerritoryMapLayout";

const hexFace = "M0-38 64-19V19L0 38-64 19V-19Z";
const hexRim = "M-64 19 0 38 64 19V26L0 45-64 26Z";
const resources: readonly { kind: TerritoryTileArtKind; label: string }[] = [
  { kind: "town", label: "Residential customers" },
  { kind: "industry", label: "Industrial customers" },
  { kind: "lake", label: "Hydro site" },
  { kind: "geothermal", label: "Geothermal site" },
  { kind: "land", label: "General building land" },
];
type MapStyle = React.CSSProperties & { "--territory-owner-color"?: string };
interface Props {
  game: GameType;
  selected: TerritoryId;
  status: (id: TerritoryId, compact?: boolean) => string;
  onSelect: (id: TerritoryId, inspect?: boolean) => void;
}
export default function TerritoryHexMap({
  game,
  selected,
  status,
  onSelect,
}: Props) {
  const mapId = React.useId();
  const viewport = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const owned = ownedTerritories(game);
  const owner = (id: TerritoryId) => {
    if (owned.includes(id)) return "you";
    if (id === "valley-electric" || id === "ridge-electric") return id;
    if (!isLandTerritoryId(id)) return "you";
    const claim = game.multiplayer?.landOwners?.[id];
    return claim ? `peer:${claim.seat}` : undefined;
  };
  const peerColors = territoryPeerColors(
    [
      ...(game.multiplayer?.peers?.map(({ id }) => id) ?? []),
      ...Object.values(game.multiplayer?.landOwners ?? {}).flatMap((claim) =>
        claim ? [claim.seat] : [],
      ),
    ].filter((id) => id !== game.multiplayer?.seat),
  );
  const color = (id: string) =>
    id === "you"
      ? "var(--territory-owner-you)"
      : id === "valley-electric"
        ? "var(--territory-owner-valley)"
        : id === "ridge-electric"
          ? "var(--territory-owner-ridge)"
          : peerColors[id.slice("peer:".length)];
  const ownerGroups = [
    ...new Set(
      TERRITORIES.map(({ id }) => owner(id)).filter((id): id is string => !!id),
    ),
  ];
  const built = (id: TerritoryId, kind: TerritoryTileArtKind) => {
    const facilities = owned.includes(id)
      ? game.facilities.filter(
          (facility) => facilityTerritoryId(facility) === id,
        )
      : (Object.values(UTILITY_AREAS).find((area) => area.id === id)
          ?.facilities ?? []);
    return facilities.some((facility) => {
      if ("yearsToBuildLeft" in facility && facility.yearsToBuildLeft > 0)
        return false;
      if (kind === "lake") return facility.fuel === "Hydro";
      if (kind === "geothermal") return facility.fuel === "Geothermal";
      if (kind === "plains") return facility.fuel === "Sun";
      return (
        kind === "hills" &&
        (facility.fuel === "Wind" ||
          facility.fuel === "Offshore Wind" ||
          facility.fuel === "Airborne Wind")
      );
    });
  };
  React.useEffect(() => {
    const element = viewport.current;
    if (element)
      element.scrollLeft = Math.max(
        0,
        (element.scrollWidth * 444) / MAP_WIDTH - element.clientWidth / 2,
      );
  }, []);
  const navigate = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: TerritoryId,
  ) => {
    const direction =
      event.key === "ArrowLeft"
        ? [-1, 0]
        : event.key === "ArrowRight"
          ? [1, 0]
          : event.key === "ArrowUp"
            ? [0, -1]
            : event.key === "ArrowDown"
              ? [0, 1]
              : undefined;
    if (!direction) return;
    const origin = territoryMapCenter(id);
    const next = TERRITORIES.filter((territory) => territory.id !== id)
      .map((territory) => {
        const point = territoryMapCenter(territory.id),
          dx = point.x - origin.x,
          dy = point.y - origin.y;
        return {
          id: territory.id,
          forward: dx * direction[0] + dy * direction[1],
          distance:
            dx * dx * (direction[0] ? 1 : 4) + dy * dy * (direction[1] ? 1 : 4),
        };
      })
      .filter((point) => point.forward > 1)
      .sort((a, b) => a.distance - b.distance)[0];
    if (next) {
      event.preventDefault();
      onSelect(next.id);
      stage.current
        ?.querySelector<HTMLButtonElement>(`[data-map-target="${next.id}"]`)
        ?.focus();
    }
  };
  return (
    <div className="territoryMap" aria-label="Territories and land ownership">
      <div className="territoryMapViewport" ref={viewport}>
        <div className="territoryMapStage" ref={stage}>
          <svg
            className="territoryHexGrid"
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            role="img"
            aria-labelledby={`${mapId}-title`}
            aria-describedby={`${mapId}-description`}
            focusable="false"
          >
            <title id={`${mapId}-title`}>
              Utility territories and purchasable land
            </title>
            <desc id={`${mapId}-description`}>
              Utility names float above their territories. Your company is
              labeled You. Colored borders identify ownership. Every unowned
              parcel can be purchased for its customers, special facility site
              or general building land. Select a name or parcel; arrow keys
              explore the map.
            </desc>
            <g aria-hidden="true">
              {mapTiles.map((tile) => {
                const { x, y } = mapCenter(tile);
                return (
                  <g
                    key={`${tile.q},${tile.r}`}
                    className="territoryHex"
                    data-territory={tile.territory}
                    data-kind={tile.kind}
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
              {ownerGroups.map((group) => (
                <g
                  key={group}
                  style={
                    { "--territory-owner-color": color(group) } as MapStyle
                  }
                  data-owner={group}
                >
                  <path
                    className="territoryHexBorderBacking"
                    d={mapBoundary((id) => owner(id) === group)}
                  />
                  <path
                    className="territoryHexBoundary"
                    d={mapBoundary((id) => owner(id) === group)}
                  />
                </g>
              ))}
              <path
                className="territoryHexSelection"
                d={mapBoundary((id) => id === selected)}
              />
              {mapTiles
                .filter((tile) => tile.landmark)
                .map((tile) => {
                  const { x, y } = mapCenter(tile);
                  const city = tile.kind === "town" || tile.kind === "industry";
                  const utility =
                    TERRITORIES.find(
                      (territory) => territory.id === tile.territory,
                    )?.kind !== "greenfield";
                  return (
                    <svg
                      key={`${tile.q},${tile.r}`}
                      className="territoryHexArt"
                      x={x - 36}
                      y={y - (city && utility ? 10 : 42)}
                      width="72"
                      height="72"
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
            </g>
          </svg>
          {TERRITORIES.map((territory) => {
            const { id } = territory;
            const point = territoryMapCenter(id);
            const utility = territory.kind !== "greenfield";
            const faction = owner(id);
            const name = utility && owned.includes(id) ? "You" : territory.name;
            const style: MapStyle = {
              left: `${(point.x / MAP_WIDTH) * 100}%`,
              top: `${(point.y / MAP_HEIGHT) * 100}%`,
              ...(faction && { "--territory-owner-color": color(faction) }),
            };
            return (
              <button
                key={id}
                type="button"
                data-map-target={id}
                data-owned={owned.includes(id)}
                data-owner={faction}
                className={
                  utility ? "territoryUtilityLabel" : "territoryParcel"
                }
                style={style}
                tabIndex={id === selected ? 0 : -1}
                aria-label={`Inspect ${territoryMapLabel(id)} territory`}
                aria-pressed={id === selected}
                aria-describedby={`${mapId}-status-${id}`}
                onFocus={() => onSelect(id)}
                onClick={() => onSelect(id, true)}
                onKeyDown={(event) => navigate(event, id)}
                title={`${territoryMapLabel(id)} — ${status(id)}`}
              >
                {utility && <strong>{name}</strong>}
                <span className="srOnly" id={`${mapId}-status-${id}`}>
                  {status(id)}. {territory.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="territoryMapHint">
        Select a territory to inspect it. Scroll the map to explore.
      </p>
      <div
        className="territoryResourceLegend"
        role="note"
        aria-label="Territory benefits"
      >
        {resources.map(({ kind, label }) => (
          <span key={kind}>
            <TerritoryTileArt kind={kind} />
            <span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
