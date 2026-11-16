import * as React from "react";
import type { GameType, TerritoryId, TerritoryTileId } from "../../Types";
import { TERRITORIES, isLandTerritoryId } from "../../data/Territories";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { terrainDetailsLabel } from "../base/TerritoryTileFacts";
import {
  HEX_WIDTH,
  HEX_HEIGHT,
  hexCenter,
  hexFacePath,
  hexRimPath,
  hexBoundary,
  hexWires,
  foregroundOrigin,
  riverPorts,
} from "../base/TerritoryHexGeometry";
import {
  TerrainArtwork,
  FacilityArtwork,
  CityArtwork,
  TowerArtwork,
} from "../base/TerritoryTileArtwork";
import {
  territoryMapLabel,
  territoryTileLabel,
  territoryPeerColors,
} from "../base/TerritoryMapLayout";

type MapStyle = React.CSSProperties & { "--territory-owner-color"?: string };
interface Props {
  game: GameType;
  selected: TerritoryTileId;
  status: (id: TerritoryId, compact?: boolean) => string;
  onSelect: (id: TerritoryTileId, inspect?: boolean) => void;
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
  const views = territoryTileViews(game);
  const tiles = views.map((view) => view.tile);
  const byId = new Map(views.map((view) => [view.tile.id, view]));
  const centers = tiles.map(hexCenter);
  const minX = Math.min(...centers.map((p) => p.x)) - HEX_WIDTH / 2 - 24;
  const minY = Math.min(...centers.map((p) => p.y)) - HEX_HEIGHT / 2 - 56;
  const width =
    Math.max(...centers.map((p) => p.x)) + HEX_WIDTH / 2 + 24 - minX;
  const height =
    Math.max(...centers.map((p) => p.y)) + HEX_HEIGHT / 2 + 20 - minY;
  const peerColors = territoryPeerColors(
    [
      ...(game.multiplayer?.peers?.map((peer) => peer.id) ?? []),
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
  const owners = [
    ...new Set(views.flatMap((view) => (view.ownerKey ? [view.ownerKey] : []))),
  ];
  const wires = hexWires(
    tiles,
    (tile) => !!byId.get(tile.id)?.developed,
    (a, b) => byId.get(a.id)?.ownerKey === byId.get(b.id)?.ownerKey,
  );
  const initialSelected = React.useRef(selected);
  React.useEffect(() => {
    const element = viewport.current,
      sheet = stage.current;
    const tile = tiles.find((tile) => tile.id === initialSelected.current);
    if (!element || !sheet || !tile) return;
    const point = hexCenter(tile),
      scale = sheet.clientWidth / width;
    element.scrollLeft = Math.max(
      0,
      (point.x - minX) * scale - element.clientWidth / 2,
    );
    element.scrollTop = Math.max(
      0,
      (point.y - minY) * scale - element.clientHeight / 2,
    );
    // Later pointer selections stay still; keyboard navigation scrolls only the next cell into view.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const navigate = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: TerritoryTileId,
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
    const tile = byId.get(id)?.tile;
    if (!direction || !tile) return;
    const point = hexCenter(tile);
    const next = tiles
      .filter((other) => other.id !== id)
      .map((other) => {
        const target = hexCenter(other),
          dx = target.x - point.x,
          dy = target.y - point.y;
        return {
          id: other.id,
          forward: dx * direction[0] + dy * direction[1],
          distance:
            dx * dx * (direction[0] ? 1 : 4) + dy * dy * (direction[1] ? 1 : 4),
        };
      })
      .filter((other) => other.forward > 1)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    const target = stage.current?.querySelector<HTMLButtonElement>(
      `[data-map-target="${next.id}"]`,
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div
      className="territoryMap"
      aria-label="Terrain, structures and utility ownership"
    >
      <div className="territoryMapViewport" ref={viewport}>
        <div
          className="territoryMapStage"
          ref={stage}
          style={{
            minWidth: `${(width * 88) / HEX_WIDTH}px`,
            aspectRatio: `${width}/${height}`,
          }}
        >
          <svg
            className="territoryHexGrid"
            viewBox={`${minX} ${minY} ${width} ${height}`}
            role="img"
            aria-labelledby={`${mapId}-title`}
            aria-describedby={`${mapId}-description`}
          >
            <title id={`${mapId}-title`}>
              Terrain and one structure per hex
            </title>
            <desc id={`${mapId}-description`}>
              Each hex contains a city or one building site. Developed empty
              sites show transmission towers. Lines automatically join adjacent
              developed cells within a utility. Your utility is labeled You.
            </desc>
            <defs>
              <clipPath id={`${mapId}-terrain-clip`}>
                <path d={hexFacePath} />
              </clipPath>
            </defs>
            <g aria-hidden="true">
              {views.map((view) => {
                const { tile } = view,
                  point = hexCenter(tile);
                return (
                  <g
                    key={tile.id}
                    className="territoryHex"
                    data-terrain={tile.terrain}
                    data-tile={tile.id}
                    data-owned={view.owned}
                    transform={`translate(${point.x} ${point.y})`}
                  >
                    <path className="territoryHexRim" d={hexRimPath} />
                    <g clipPath={`url(#${mapId}-terrain-clip)`}>
                      <svg
                        x={-HEX_WIDTH / 2}
                        y={-HEX_HEIGHT / 2}
                        width={HEX_WIDTH}
                        height={HEX_HEIGHT}
                        preserveAspectRatio="none"
                        viewBox="0 0 500 500"
                      >
                        <TerrainArtwork
                          terrain={tile.terrain}
                          ports={
                            tile.terrain === "river"
                              ? riverPorts(tile, tiles)
                              : undefined
                          }
                          className="territoryTerrainArtwork"
                        />
                      </svg>
                    </g>
                    <path className="territoryHexSeam" d={hexFacePath} />
                  </g>
                );
              })}
              <g className="territoryWires" data-wire-count={wires.length}>
                {wires.map((wire) => (
                  <g
                    key={wire.id}
                    data-wire-from={wire.from}
                    data-wire-to={wire.to}
                  >
                    <path className="territoryWireBacking" d={wire.path} />
                    <path className="territoryWire" d={wire.path} />
                  </g>
                ))}
              </g>
              {[...views]
                .sort((a, b) => hexCenter(a.tile).y - hexCenter(b.tile).y)
                .map((view) => {
                  const { tile, facility } = view,
                    origin = foregroundOrigin(tile);
                  if (!facility && !tile.city && !view.developed) return null;
                  return (
                    <svg
                      key={tile.id}
                      className="territoryTileOccupant"
                      data-building={
                        !!facility && facility.yearsToBuildLeft > 0
                      }
                      data-occupant={
                        tile.city
                          ? "city"
                          : facility
                            ? facility.peakWh !== undefined
                              ? "storage"
                              : "generator"
                            : "tower"
                      }
                      data-occupant-tile={tile.id}
                      x={origin.x}
                      y={origin.y}
                      width={HEX_WIDTH}
                      height={HEX_WIDTH}
                      viewBox="0 0 500 500"
                      overflow="visible"
                    >
                      {tile.city ? (
                        <CityArtwork
                          sector={tile.city.sector}
                          className="territoryOccupantArtwork"
                        />
                      ) : facility ? (
                        <FacilityArtwork
                          facility={facility}
                          className="territoryOccupantArtwork"
                        />
                      ) : (
                        <TowerArtwork
                          platform={
                            tile.terrain === "ocean" ||
                            tile.terrain === "lake" ||
                            tile.terrain === "river"
                          }
                          className="territoryOccupantArtwork"
                        />
                      )}
                    </svg>
                  );
                })}
              {owners.map((owner) => (
                <g
                  key={owner}
                  data-owner={owner}
                  style={
                    { "--territory-owner-color": color(owner) } as MapStyle
                  }
                >
                  <path
                    className="territoryHexBorderBacking"
                    d={hexBoundary(
                      tiles,
                      (tile) => byId.get(tile.id)?.ownerKey === owner,
                    )}
                  />
                  <path
                    className="territoryHexBoundary"
                    d={hexBoundary(
                      tiles,
                      (tile) => byId.get(tile.id)?.ownerKey === owner,
                    )}
                  />
                </g>
              ))}
              <path
                className="territoryHexSelection"
                d={hexBoundary(tiles, (tile) => tile.id === selected)}
              />
            </g>
          </svg>
          {views.map((view) => {
            const { tile, facility } = view,
              point = hexCenter(tile);
            const territory = TERRITORIES.find(
              (territory) => territory.id === tile.territoryId,
            )!;
            const utility = !!tile.city && territory.kind !== "greenfield";
            const first =
              tiles.find((other) => other.territoryId === tile.territoryId)
                ?.id === tile.id;
            const oldSelectionLabel =
              utility || (isLandTerritoryId(tile.territoryId) && first);
            const label = oldSelectionLabel
              ? `Inspect ${territoryMapLabel(tile.territoryId)} territory`
              : `Inspect ${territoryTileLabel(tile)} in ${territoryMapLabel(tile.territoryId)}`;
            const style: MapStyle = {
              left: `${((point.x - minX) / width) * 100}%`,
              top: `${((point.y - minY) / height) * 100}%`,
              width: `${(HEX_WIDTH / width) * 100}%`,
              height: `${(HEX_HEIGHT / height) * 100}%`,
              ...(view.ownerKey
                ? { "--territory-owner-color": color(view.ownerKey) }
                : {}),
            };
            return (
              <button
                key={tile.id}
                type="button"
                data-map-target={tile.id}
                data-territory={tile.territoryId}
                data-owner={view.ownerKey}
                data-owned={view.owned}
                data-terrain={tile.terrain}
                className={`territoryTileTarget${utility ? " territoryUtilityLabel" : ""}`}
                style={style}
                tabIndex={tile.id === selected ? 0 : -1}
                aria-label={label}
                aria-pressed={tile.id === selected}
                aria-describedby={`${mapId}-${tile.id}-status`}
                onFocus={() => onSelect(tile.id)}
                onClick={() => onSelect(tile.id, true)}
                onKeyDown={(event) => navigate(event, tile.id)}
                title={`${TERRAIN_LABELS[tile.terrain]} · ${facility?.name ?? (tile.city ? `${tile.city.sector} city` : view.developed ? "Open site · transmission tower" : "Undeveloped site")}`}
              >
                <span className="territoryTileHitArea" aria-hidden="true" />
                {utility && (
                  <strong>{view.owned ? "You" : territory.name}</strong>
                )}
                <span className="srOnly" id={`${mapId}-${tile.id}-status`}>
                  {status(tile.territoryId)}.{" "}
                  {terrainDetailsLabel(tile.terrain)}.{" "}
                  {facility
                    ? `${facility.name}${facility.yearsToBuildLeft > 0 ? ", under construction" : ""}`
                    : tile.city
                      ? `${tile.city.sector} customers; no building slot`
                      : view.developed
                        ? "One building site; transmission tower"
                        : "One site available with this land"}
                  .
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="territoryMapHint">
        Select a hex to inspect or build. Scroll to explore. Lines connect
        developed land automatically.
      </p>
    </div>
  );
}
