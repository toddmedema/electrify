import * as React from "react";
import { Tooltip } from "@mui/material";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import type { GameType, TerritoryTileId } from "../../Types";
import { getTerritoryDefinition } from "../../data/Territories";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import { useAppSelector } from "../../Store";
import { terrainDetailsLabel } from "../base/TerritoryTileFacts";
import { facilityMapStatus } from "../base/FacilityMapStatus";
import FacilityMapStatusArtwork from "../base/FacilityMapStatusArtwork";
import { hasVisibleEscapeOverlay } from "../base/VisibleEscapeOverlay";
import { useMoney } from "../base/CurrencyContext";
import { useTerritoryTilePurchases } from "../base/TerritoryTilePurchases";
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
  territoryTileLabel,
  tilePurchaseBenefitLabel,
  territoryPeerColors,
} from "../base/TerritoryMapLayout";
import "./TerritoryMapWorkspace.scss";

type MapStyle = React.CSSProperties & { "--territory-owner-color"?: string };
interface Props {
  game: GameType;
  selected?: TerritoryTileId;
  onSelect: (id: TerritoryTileId, inspect?: boolean) => void;
  onCloseInspection?: () => void;
  onDeselect?: () => void;
}
export default function TerritoryHexMap({
  game,
  selected,
  onSelect,
  onCloseInspection,
  onDeselect,
}: Props) {
  const mapId = React.useId();
  const viewport = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const buyingControl = React.useRef<HTMLButtonElement>(null);
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const { formatMoneyConcise: money } = useMoney();
  const { pendingIds, availableCash, message, purchase } =
    useTerritoryTilePurchases();
  const [buyMode, setBuyMode] = React.useState(false);
  const views = React.useMemo(() => territoryTileViews(game), [game]);
  const tiles = React.useMemo(() => views.map((view) => view.tile), [views]);
  const byId = React.useMemo(
    () => new Map(views.map((view) => [view.tile.id, view])),
    [views],
  );
  const purchaseQuotes = React.useMemo(
    () => (buyMode ? tilePurchaseQuotes(game) : undefined),
    [buyMode, game],
  );
  const activeSelected = selected && byId.has(selected) ? selected : undefined;
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !(onCloseInspection || activeSelected || buyMode) ||
        hasVisibleEscapeOverlay()
      )
        return;
      const map = viewport.current?.closest(".territoryMap");
      if (!map || map.closest('[hidden], [inert], [aria-hidden="true"]'))
        return;
      const workspace =
        map.closest(".gameWorkspace") ??
        map.closest(".territoryNetwork") ??
        map;
      if (!(event.target instanceof Node) || !workspace.contains(event.target))
        return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-game-tool], .gameToolPanel") &&
        !map.contains(event.target)
      )
        return;
      for (
        let element: Element | null = map;
        element;
        element = element.parentElement
      ) {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse"
        )
          return;
      }
      // The nonmodal inspector permits focus in the map, receipts and workspace footer.
      // Own one dismissal before the game's document-level navigation sees Escape.
      event.preventDefault();
      event.stopPropagation();
      setBuyMode(false);
      onCloseInspection?.();
      onDeselect?.();
      buyingControl.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [activeSelected, buyMode, onCloseInspection, onDeselect]);
  const [rovingId, setRovingId] = React.useState(
    () =>
      activeSelected ??
      views.find((view) => view.owned)?.tile.id ??
      tiles[0]?.id,
  );
  const activeRoving =
    activeSelected ??
    (rovingId && byId.has(rovingId)
      ? rovingId
      : (views.find((view) => view.owned)?.tile.id ?? tiles[0]?.id));
  const [camera, setCamera] = React.useState(() =>
    hexCenter(
      (selected ? byId.get(selected)?.tile : undefined) ??
        tiles[0] ?? { q: 0, r: 0 },
    ),
  );
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const scale = size.width > 0 && size.width < 600 ? 0.75 : 0.875;
  const worldWidth = size.width / scale;
  const worldHeight = size.height / scale;
  const focusAfterNavigation = React.useRef<TerritoryTileId>();
  const pointer = React.useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  }>();
  const touches = React.useRef(new Set<number>());
  const suppressClick = React.useRef(false);
  const activationQuote = React.useRef<{
    tileId: TerritoryTileId;
    quoteKey: string;
  }>();
  const framedRun = React.useRef<{
    runId?: number;
    seed: number;
    scenarioId: number;
  }>();
  React.useLayoutEffect(() => {
    if (
      !size.width ||
      !size.height ||
      (framedRun.current?.runId === runId &&
        framedRun.current?.seed === game.seed &&
        framedRun.current?.scenarioId === game.scenarioId)
    )
      return;
    framedRun.current = { runId, seed: game.seed, scenarioId: game.scenarioId };
    const focus = hexCenter(
      byId.get(activeSelected ?? activeRoving!)?.tile ?? { q: 0, r: 0 },
    );
    const bounds = views.reduce(
      (bounds, { tile, owned }) => {
        if (!owned) return bounds;
        const point = hexCenter(tile);
        return {
          minX: Math.min(bounds.minX, point.x),
          maxX: Math.max(bounds.maxX, point.x),
          minY: Math.min(bounds.minY, point.y),
          maxY: Math.max(bounds.maxY, point.y),
        };
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    const center = Number.isFinite(bounds.minX)
      ? {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        }
      : focus;
    const rangeX = Math.max(0, worldWidth / 2 - HEX_WIDTH);
    const rangeY = Math.max(0, worldHeight / 2 - HEX_WIDTH);
    // Start toward the useful land without clipping the capital or resumed selection.
    // Frame once per run: purchases, frontier reveals and resize keep the player's camera.
    setCamera({
      x: Math.max(focus.x - rangeX, Math.min(center.x, focus.x + rangeX)),
      y: Math.max(focus.y - rangeY, Math.min(center.y, focus.y + rangeY)),
    });
    setBuyMode(false);
  }, [
    runId,
    game.seed,
    game.scenarioId,
    size.width,
    size.height,
    worldWidth,
    worldHeight,
    activeSelected,
    activeRoving,
    byId,
    views,
  ]);
  React.useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1;
      setCamera((point) => ({
        x:
          point.x +
          ((event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) *
            unit) /
            scale,
        y:
          point.y +
          ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit) / scale,
      }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [scale]);
  React.useLayoutEffect(() => {
    if (!focusAfterNavigation.current) return;
    const target = stage.current?.querySelector<HTMLButtonElement>(
      `[data-map-target="${focusAfterNavigation.current}"]`,
    );
    target?.focus({ preventScroll: true });
    if (target) focusAfterNavigation.current = undefined;
  }, [selected, camera]);
  const minX = camera.x - worldWidth / 2;
  const minY = camera.y - worldHeight / 2;
  const renderedViews = views.filter(({ tile }) => {
    const point = hexCenter(tile);
    return (
      tile.id === activeRoving ||
      (Math.abs(point.x - camera.x) < worldWidth / 2 + HEX_WIDTH &&
        Math.abs(point.y - camera.y) < worldHeight / 2 + HEX_WIDTH)
    );
  });
  const renderedTiles = renderedViews.map(({ tile }) => tile);
  const peerColors = territoryPeerColors(
    [
      ...(game.multiplayer?.peers?.map((peer) => peer.id) ?? []),
      ...views.flatMap((view) =>
        view.ownerKey?.startsWith("peer:") ? [view.ownerKey.slice(5)] : [],
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
          : peerColors[id.slice(5)];
  const owners = [
    ...new Set(views.flatMap((view) => (view.ownerKey ? [view.ownerKey] : []))),
  ];
  const ownerBoundaries = owners.map((owner) => ({
    owner,
    path: hexBoundary(tiles, (tile) => byId.get(tile.id)?.ownerKey === owner),
  }));
  const selectedBoundary = hexBoundary(
    tiles,
    (tile) => tile.id === activeSelected,
  );
  const wires = hexWires(
    renderedTiles,
    (tile) => !!byId.get(tile.id)?.developed,
    (a, b) => byId.get(a.id)?.ownerKey === byId.get(b.id)?.ownerKey,
  );
  const revealTile = (tile: { q: number; r: number }) => {
    const target = hexCenter(tile);
    setCamera((current) => ({
      x:
        current.x +
        Math.max(
          0,
          target.x - current.x - Math.max(0, worldWidth / 2 - HEX_WIDTH),
        ) +
        Math.min(
          0,
          target.x - current.x + Math.max(0, worldWidth / 2 - HEX_WIDTH),
        ),
      y:
        current.y +
        Math.max(
          0,
          target.y - current.y - Math.max(0, worldHeight / 2 - 160 / scale),
        ) +
        Math.min(
          0,
          target.y - current.y + Math.max(0, worldHeight / 2 - 160 / scale),
        ),
    }));
  };
  const inspectTile = (tile: { id: TerritoryTileId; q: number; r: number }) => {
    if (size.width <= 740) {
      const point = hexCenter(tile);
      // Leave the selected ground and occupant above the phone's inspection sheet.
      setCamera({ x: point.x, y: point.y + worldHeight * 0.22 });
    }
    onSelect(tile.id, true);
  };
  const navigate = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: TerritoryTileId,
  ) => {
    if ((event.key === "Enter" || event.key === " ") && event.repeat) {
      event.preventDefault();
      return;
    }
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
          tile: other,
          forward: dx * direction[0] + dy * direction[1],
          distance:
            dx * dx * (direction[0] ? 1 : 4) + dy * dy * (direction[1] ? 1 : 4),
        };
      })
      .filter((other) => other.forward > 1)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!next) return;
    event.preventDefault();
    focusAfterNavigation.current = next.tile.id;
    onSelect(next.tile.id);
    revealTile(next.tile);
  };
  return (
    <div
      className="territoryMap"
      data-buy-mode={buyMode}
      aria-label="Terrain, structures and utility ownership"
    >
      <Tooltip
        title={buyMode ? "Finish buying land" : "Buy land"}
        placement="top"
        arrow
      >
        <button
          type="button"
          className="territoryMapBuyToggle"
          ref={buyingControl}
          aria-label="Buy land"
          aria-pressed={buyMode}
          aria-describedby={`${mapId}-buy-status`}
          onClick={() => setBuyMode((value) => !value)}
        >
          <AddLocationAltIcon aria-hidden="true" />
        </button>
      </Tooltip>
      <span
        className="srOnly"
        id={`${mapId}-buy-status`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message || (buyMode ? "Activate a priced tile to buy it." : "")}
      </span>
      <div
        className="territoryMapViewport"
        role="region"
        aria-label="Territory map"
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-scale={scale}
        ref={viewport}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          touches.current.add(event.pointerId);
          if (touches.current.size > 1) {
            suppressClick.current = true;
            pointer.current = undefined;
            return;
          }
          suppressClick.current = false;
          pointer.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dragging: false,
          };
        }}
        onPointerMove={(event) => {
          const drag = pointer.current;
          if (
            !drag ||
            drag.id !== event.pointerId ||
            touches.current.size !== 1
          )
            return;
          const dx = event.clientX - drag.x,
            dy = event.clientY - drag.y;
          if (!drag.dragging && dx * dx + dy * dy < 36) return;
          if (!drag.dragging)
            event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.dragging = true;
          suppressClick.current = true;
          drag.x = event.clientX;
          drag.y = event.clientY;
          event.preventDefault();
          setCamera((point) => ({
            x: point.x - dx / scale,
            y: point.y - dy / scale,
          }));
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId);
          if (pointer.current?.id === event.pointerId)
            pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId);
          pointer.current = undefined;
          suppressClick.current = true;
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className="territoryMapStage"
          ref={stage}
          data-camera-x={camera.x}
          data-camera-y={camera.y}
          data-camera-scale={scale}
        >
          <svg
            className="territoryHexGrid"
            viewBox={`${minX} ${minY} ${Math.max(1, worldWidth)} ${Math.max(1, worldHeight)}`}
            role="img"
            aria-labelledby={`${mapId}-title`}
          >
            <title id={`${mapId}-title`}>
              Terrain and one structure per hex
            </title>
            <defs>
              <clipPath id={`${mapId}-terrain-clip`}>
                <path d={hexFacePath} />
              </clipPath>
            </defs>
            <g aria-hidden="true">
              {renderedViews.map(({ tile, owned, visibilityDistance }) => {
                const point = hexCenter(tile);
                return (
                  <g
                    key={tile.id}
                    className="territoryHex territoryFog"
                    data-visibility-distance={visibilityDistance}
                    data-terrain={tile.terrain}
                    data-tile={tile.id}
                    data-owned={owned}
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
              {[...renderedViews]
                .sort((a, b) => hexCenter(a.tile).y - hexCenter(b.tile).y)
                .map((view) => {
                  const { tile, facility } = view,
                    origin = foregroundOrigin(tile),
                    status = facilityMapStatus(view, game.date.minute);
                  if (!facility && !tile.city && !view.developed) return null;
                  return (
                    <svg
                      key={tile.id}
                      className="territoryTileOccupant territoryFog"
                      data-visibility-distance={view.visibilityDistance}
                      data-facility-status={status?.kind}
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
                        <>
                          <g className="territoryFacilityBody">
                            <FacilityArtwork
                              facility={facility}
                              className="territoryOccupantArtwork"
                            />
                          </g>
                          {status && (
                            <FacilityMapStatusArtwork kind={status.kind} />
                          )}
                        </>
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
              {ownerBoundaries.map(({ owner, path }) => (
                <g
                  key={owner}
                  data-owner={owner}
                  style={
                    { "--territory-owner-color": color(owner) } as MapStyle
                  }
                >
                  <path className="territoryHexBorderBacking" d={path} />
                  <path className="territoryHexBoundary" d={path} />
                </g>
              ))}
              <path
                className="territoryHexSelectionBacking"
                d={selectedBoundary}
              />
              <path className="territoryHexSelection" d={selectedBoundary} />
            </g>
          </svg>
          {renderedViews.map((view) => {
            const { tile, facility } = view,
              point = hexCenter(tile);
            const status = facilityMapStatus(view, game.date.minute);
            const territory = getTerritoryDefinition(tile.territoryId);
            const utility = !!tile.city && territory?.kind !== "greenfield";
            const quote = purchaseQuotes?.get(tile.id);
            const pending = pendingIds.has(tile.id);
            const unaffordable = !!quote && quote.price > availableCash;
            const label = utility
              ? `Inspect ${view.owned ? "You" : view.ownerName} territory`
              : `Inspect ${territoryTileLabel(tile)}`;
            const priceLabel = quote
              ? `${money(quote.price)} · ${tilePurchaseBenefitLabel(quote)}`
              : "";
            return (
              <button
                key={tile.id}
                type="button"
                data-map-target={tile.id}
                data-territory={tile.territoryId}
                data-owner={view.ownerKey}
                data-owned={view.owned}
                data-terrain={tile.terrain}
                data-purchasable={!!quote}
                data-unaffordable={unaffordable}
                aria-busy={pending || undefined}
                className={`territoryTileTarget${utility ? " territoryUtilityLabel" : ""}`}
                style={
                  {
                    left: `${(point.x - minX) * scale}px`,
                    top: `${(point.y - minY) * scale}px`,
                    width: HEX_WIDTH * scale,
                    height: HEX_HEIGHT * scale,
                    ...(view.ownerKey
                      ? { "--territory-owner-color": color(view.ownerKey) }
                      : {}),
                  } as MapStyle
                }
                tabIndex={tile.id === activeRoving ? 0 : -1}
                aria-label={
                  quote
                    ? `${unaffordable ? "Inspect" : "Buy"} ${territoryTileLabel(tile)} · ${priceLabel}${unaffordable ? "; not enough available cash" : ""}`
                    : label
                }
                aria-pressed={tile.id === activeSelected}
                aria-describedby={`${mapId}-${tile.id}-status`}
                onFocus={() => {
                  setRovingId(tile.id);
                  if (tile.id !== selected) onSelect(tile.id);
                  if (!pointer.current && !touches.current.size)
                    revealTile(tile);
                }}
                onPointerDown={() => {
                  activationQuote.current = quote
                    ? { tileId: tile.id, quoteKey: quote.quoteKey }
                    : undefined;
                }}
                onClick={() => {
                  const expectedQuote =
                    activationQuote.current?.tileId === tile.id
                      ? activationQuote.current.quoteKey
                      : quote?.quoteKey;
                  activationQuote.current = undefined;
                  onSelect(tile.id);
                  if (pending) return;
                  if (quote && !unaffordable)
                    void purchase(tile.id, expectedQuote);
                  else inspectTile(tile);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" || event.key === " ") &&
                    !event.repeat
                  )
                    activationQuote.current = quote
                      ? { tileId: tile.id, quoteKey: quote.quoteKey }
                      : undefined;
                  navigate(event, tile.id);
                }}
                title={`${TERRAIN_LABELS[tile.terrain]} · ${facility?.name ?? (tile.city ? `${tile.city.sector} city` : view.developed ? "Open site · transmission tower" : "Undeveloped site")}${status ? ` · ${status.label}` : ""}`}
              >
                <span className="territoryTileHitArea" aria-hidden="true" />
                {utility && (
                  <strong>{view.owned ? "You" : view.ownerName}</strong>
                )}
                {quote && (
                  <span className="territoryTilePrice" aria-hidden="true">
                    <b>{pending ? "Buying…" : money(quote.price)}</b>
                    {quote.benefit !== "general" && (
                      <span>{tilePurchaseBenefitLabel(quote)}</span>
                    )}
                  </span>
                )}
                <span className="srOnly" id={`${mapId}-${tile.id}-status`}>
                  {view.owned
                    ? "Your tile"
                    : view.ownerKey
                      ? `Owned by ${view.ownerName}`
                      : "Available to buy"}
                  . {terrainDetailsLabel(tile.terrain)}.{" "}
                  {facility
                    ? `${facility.name}${status ? ` · ${status.label}` : ""}`
                    : tile.city
                      ? `${tile.city.sector} customers; no building slot`
                      : view.developed
                        ? "One building site; transmission tower"
                        : "One building site"}
                  .
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
