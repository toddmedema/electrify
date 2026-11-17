import * as React from "react";
import { Tooltip, useTheme } from "@mui/material";
import ConstructionIcon from "@mui/icons-material/Construction";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";
import type { GameType, TerritoryTileId } from "../../Types";
import { getTerritoryDefinition } from "../../data/Territories";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import type { TerritoryTileView } from "../../helpers/TerritoryMapState";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import { getSunriseSunset } from "../../helpers/DateTime";
import type { RendererState } from "../base/territory-3d/TerritoryCanvas3D";
import type { ScenePicker } from "../base/territory-3d/SceneBuilder";
import { useAppSelector } from "../../Store";
import { terrainDetailsLabel } from "../base/TerritoryTileFacts";
import { facilityMapStatus } from "../base/FacilityMapStatus";
import useFacilityMapMotion, {
  FacilityMapMotionContext,
} from "../base/useFacilityMapMotion";
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
import type { HexWireStructure } from "../base/TerritoryHexGeometry";
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

const TerritoryScene3D = React.lazy(
  () => import("../base/territory-3d/TerritoryScene3D"),
);

class MapSceneBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Preserve semantic topology/membership across tick snapshots and small camera moves. */
function useStableArray<T>(next: T[], equal: (a: T, b: T) => boolean): T[] {
  const retained = React.useRef(next);
  if (
    next.length !== retained.current.length ||
    next.some((item, i) => !equal(item, retained.current[i]))
  )
    retained.current = next;
  return retained.current;
}
function sameTile(a: TerritoryTileView["tile"], b: TerritoryTileView["tile"]) {
  return (
    a === b ||
    (a.id === b.id &&
      a.territoryId === b.territoryId &&
      a.q === b.q &&
      a.r === b.r &&
      a.terrain === b.terrain &&
      (a.city
        ? a.city.sector === b.city?.sector
        : !b.city &&
          a.siteKind === b.siteKind &&
          a.maxPeakW === b.maxPeakW &&
          a.startingAssetId === b.startingAssetId &&
          a.hydroSiteId === b.hydroSiteId))
  );
}

type MapStyle = React.CSSProperties & { "--territory-owner-color"?: string };
interface Props {
  game: GameType;
  selected?: TerritoryTileId;
  onSelect: (id: TerritoryTileId, inspect?: boolean) => void;
  onCloseInspection?: () => void;
  onDeselect?: () => void;
  onPlanProject?: () => void;
  projectPlanning?: boolean;
  projectSites?: ReadonlyMap<TerritoryTileId, "owned" | "connection">;
}
function wireStructure({
  tile,
  facility,
}: TerritoryTileView): HexWireStructure {
  if (tile.city) return "city";
  if (facility)
    return facility.peakWh !== undefined
      ? "storage"
      : facility.fuel === "Hydro"
        ? "hydro"
        : "generator";
  return tile.terrain === "lake" ||
    tile.terrain === "ocean" ||
    tile.terrain === "river"
    ? "submerged"
    : "tower";
}
export default function TerritoryHexMap({
  game,
  selected,
  onSelect,
  onCloseInspection,
  onDeselect,
  onPlanProject,
  projectPlanning = false,
  projectSites,
}: Props) {
  const mapId = React.useId();
  const dark = useTheme().palette.mode === "dark";
  const [rendererState, setRendererState] = React.useState<
    RendererState | "loading"
  >("loading");
  const threeDReady = rendererState === "ready";
  const picker = React.useRef<ScenePicker>();
  const setPicker = React.useCallback((value: ScenePicker | undefined) => {
    picker.current = value;
  }, []);
  const motion = useFacilityMapMotion(game.speed);
  const viewport = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const buyingControl = React.useRef<HTMLButtonElement>(null);
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const { formatMoneyConcise: money } = useMoney();
  const { pendingIds, availableCash, message, purchase } =
    useTerritoryTilePurchases();
  const [buyMode, setBuyMode] = React.useState(false);
  const views = React.useMemo(() => territoryTileViews(game), [game]);
  const topology = useStableArray(
    views.map((view) => ({
      tile: view.tile,
      ownerKey: view.ownerKey,
      developed: view.developed,
      structure: wireStructure(view),
    })),
    (a, b) =>
      sameTile(a.tile, b.tile) &&
      a.ownerKey === b.ownerKey &&
      a.developed === b.developed &&
      a.structure === b.structure,
  );
  const tiles = React.useMemo(
    () => topology.map((view) => view.tile),
    [topology],
  );
  const byId = React.useMemo(
    () => new Map(views.map((view) => [view.tile.id, view])),
    [views],
  );
  const purchaseQuotes = React.useMemo(
    () => (buyMode || projectPlanning ? tilePurchaseQuotes(game) : undefined),
    [buyMode, projectPlanning, game],
  );
  React.useEffect(() => {
    if (projectPlanning) setBuyMode(false);
  }, [projectPlanning]);
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
  const activationTarget = React.useRef<TerritoryTileId>();
  const pointerHover = React.useRef<() => void>();
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
  const renderedTiles = useStableArray(
    tiles.filter((tile) => {
      const point = hexCenter(tile);
      return (
        tile.id === activeRoving ||
        (Math.abs(point.x - camera.x) < worldWidth / 2 + HEX_WIDTH &&
          Math.abs(point.y - camera.y) < worldHeight / 2 + HEX_WIDTH)
      );
    }),
    (a, b) => a === b,
  );
  const renderedViews = React.useMemo(
    () => renderedTiles.map((tile) => ({ ...byId.get(tile.id)!, tile })),
    [renderedTiles, byId],
  );
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
  const { ownerBoundaries, allWires } = React.useMemo(() => {
    const index = new Map(topology.map((view) => [view.tile.id, view]));
    const owners = [
      ...new Set(
        topology.flatMap((view) => (view.ownerKey ? [view.ownerKey] : [])),
      ),
    ];
    return {
      ownerBoundaries: owners.map((owner) => ({
        owner,
        path: hexBoundary(
          tiles,
          (tile) => index.get(tile.id)?.ownerKey === owner,
        ),
      })),
      allWires: hexWires(
        tiles,
        (tile) => !!index.get(tile.id)?.developed,
        (a, b) => index.get(a.id)?.ownerKey === index.get(b.id)?.ownerKey,
        (tile) => index.get(tile.id)!.structure,
      ),
    };
  }, [tiles, topology]);
  const selectedBoundary = React.useMemo(
    () => hexBoundary(tiles, (tile) => tile.id === activeSelected),
    [tiles, activeSelected],
  );
  const wires = React.useMemo(() => {
    const rendered = new Set(renderedTiles.map((tile) => tile.id));
    return allWires.filter(
      (wire) => rendered.has(wire.from) && rendered.has(wire.to),
    );
  }, [allWires, renderedTiles]);
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
      setCamera({
        x: point.x,
        y: point.y + worldHeight * (projectPlanning ? 0.3 : 0.22),
      });
    }
    onSelect(tile.id, true);
  };
  const activateTile = (id: TerritoryTileId) => {
    const view = byId.get(id);
    if (!view) return;
    const quote = purchaseQuotes?.get(id),
      expectedQuote =
        activationQuote.current?.tileId === id
          ? activationQuote.current.quoteKey
          : quote?.quoteKey;
    activationQuote.current = undefined;
    onSelect(id);
    if (pendingIds.has(id)) return;
    if (quote && quote.price <= availableCash && !projectPlanning)
      void purchase(id, expectedQuote);
    else inspectTile(view.tile);
  };
  const pointerTile = (event: {
    target: EventTarget;
    clientX: number;
    clientY: number;
  }) => {
    const element = event.target instanceof Element ? event.target : undefined;
    const ground = element?.closest<HTMLButtonElement>("[data-map-target]");
    if (
      !threeDReady ||
      element?.closest(".territoryTilePrice, .territoryUtilityLabel strong")
    )
      return ground?.dataset.mapTarget as TerritoryTileId | undefined;
    const rect = viewport.current?.getBoundingClientRect();
    return (
      (rect &&
        picker.current?.({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })) ??
      (ground?.dataset.mapTarget as TerritoryTileId | undefined)
    );
  };
  const hoverTile = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerHover.current?.();
    pointerHover.current = undefined;
    if (!threeDReady) return;
    const id = pointerTile(event);
    const target =
      id &&
      stage.current?.querySelector<HTMLButtonElement>(
        `[data-map-target="${id}"]`,
      );
    if (!target) return;
    const ground =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-map-target]")
        : null;
    const hit = target.querySelector<HTMLElement>(".territoryTileHitArea");
    const groundHit = ground?.querySelector<HTMLElement>(
      ".territoryTileHitArea",
    );
    const titleTarget =
      event.target instanceof HTMLElement ? event.target : event.currentTarget;
    const previousTitle = titleTarget.getAttribute("title");
    target.dataset.modelHovered = "true";
    if (hit)
      hit.style.background =
        "color-mix(in srgb, var(--interactive-blue) 14%, transparent)";
    if (groundHit && ground !== target)
      groundHit.style.background = "transparent";
    titleTarget.title =
      titleTarget.closest<HTMLElement>(".territoryTilePrice")?.title ||
      target.title;
    pointerHover.current = () => {
      delete target.dataset.modelHovered;
      if (hit) hit.style.removeProperty("background");
      if (groundHit) groundHit.style.removeProperty("background");
      if (previousTitle === null) titleTarget.removeAttribute("title");
      else titleTarget.title = previousTitle;
    };
  };
  React.useEffect(() => () => pointerHover.current?.(), []);
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
      data-renderer={rendererState}
      aria-label="Terrain, structures and utility ownership"
    >
      {onPlanProject && (
        <button
          type="button"
          className="territoryMapBuildToggle"
          aria-label="Build"
          aria-pressed={projectPlanning}
          onClick={onPlanProject}
        >
          <ConstructionIcon aria-hidden="true" />
          <span>Build</span>
        </button>
      )}
      <Tooltip
        title={buyMode ? "Finish connecting" : "Connect"}
        placement="top"
        arrow
      >
        <button
          type="button"
          className="territoryMapBuyToggle"
          ref={buyingControl}
          aria-label="Connect"
          aria-pressed={buyMode}
          aria-describedby={`${mapId}-buy-status`}
          onClick={() => {
            if (projectPlanning) onDeselect?.();
            setBuyMode((value) => !value);
          }}
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
        {message || (buyMode ? "Activate a priced site to connect it." : "")}
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
          const id = pointerTile(event),
            quote = id && purchaseQuotes?.get(id);
          activationTarget.current = id;
          activationQuote.current = id
            ? {
                tileId: id,
                quoteKey: quote
                  ? quote.quoteKey
                  : "unavailable-at-gesture-start",
              }
            : undefined;
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
          const ground =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-map-target]")
              : null;
          if (id && ground?.dataset.mapTarget !== id) {
            event.preventDefault();
            stage.current
              ?.querySelector<HTMLButtonElement>(`[data-map-target="${id}"]`)
              ?.focus({ preventScroll: true });
          }
        }}
        onPointerMove={(event) => {
          const drag = pointer.current;
          if (
            !drag ||
            drag.id !== event.pointerId ||
            touches.current.size !== 1
          ) {
            hoverTile(event);
            return;
          }
          const dx = event.clientX - drag.x,
            dy = event.clientY - drag.y;
          if (!drag.dragging && dx * dx + dy * dy < 36) return;
          if (!drag.dragging)
            event.currentTarget.setPointerCapture?.(event.pointerId);
          pointerHover.current?.();
          pointerHover.current = undefined;
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
        onPointerLeave={() => {
          pointerHover.current?.();
          pointerHover.current = undefined;
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.detail === 0) return;
          const id = pointerTile(event);
          if (activationTarget.current && activationTarget.current !== id) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          activationTarget.current = undefined;
          if (id) {
            event.preventDefault();
            event.stopPropagation();
            activateTile(id);
          }
        }}
      >
        {typeof WebGL2RenderingContext !== "undefined" && (
          <MapSceneBoundary onError={() => setRendererState("unavailable")}>
            <React.Suspense fallback={null}>
              <TerritoryScene3D
                views={renderedViews}
                tiles={tiles}
                wires={wires}
                minute={game.date.minute}
                minuteOfDay={game.date.minuteOfDay}
                runKey={`${runId}:${game.seed}:${game.scenarioId}`}
                daylight={getSunriseSunset(game.date, game.location)}
                dark={dark}
                frame={{
                  width: size.width,
                  height: size.height,
                  dpr: window.devicePixelRatio || 1,
                  cameraX: camera.x,
                  cameraY: camera.y,
                  scale,
                  background: dark ? [0.035, 0.055, 0.07] : [0.86, 0.9, 0.9],
                  visible: size.width > 0 && size.height > 0,
                  motionAllowed: motion.allowed,
                  playbackRate: motion.rate,
                }}
                onState={setRendererState}
                onPicker={setPicker}
              />
            </React.Suspense>
          </MapSceneBoundary>
        )}
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
              {!threeDReady &&
                renderedViews.map(({ tile, owned, visibilityDistance }) => {
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
              {!threeDReady && (
                <g className="territoryWires" data-wire-count={wires.length}>
                  {wires.map((wire) => (
                    <g
                      key={wire.id}
                      className="territoryFog"
                      data-wire-from={wire.from}
                      data-wire-to={wire.to}
                      data-wire-kind={wire.kind}
                      data-visibility-distance={Math.max(
                        byId.get(wire.from)!.visibilityDistance,
                        byId.get(wire.to)!.visibilityDistance,
                      )}
                    >
                      <path className="territoryWireBacking" d={wire.path} />
                      <path className="territoryWire" d={wire.path} />
                    </g>
                  ))}
                </g>
              )}
              {[...renderedViews]
                .sort((a, b) => hexCenter(a.tile).y - hexCenter(b.tile).y)
                .map((view) => {
                  const { tile, facility } = view,
                    origin = foregroundOrigin(tile),
                    status = facilityMapStatus(view, game.date.minute);
                  if (
                    !facility &&
                    !tile.city &&
                    (!view.developed || wireStructure(view) === "submerged")
                  )
                    return null;
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
                      {threeDReady ? (
                        status ? (
                          <FacilityMapStatusArtwork kind={status.kind} />
                        ) : null
                      ) : tile.city ? (
                        <CityArtwork
                          sector={tile.city.sector}
                          className="territoryOccupantArtwork"
                        />
                      ) : facility ? (
                        <>
                          <g className="territoryFacilityBody">
                            <FacilityMapMotionContext.Provider value={motion}>
                              <FacilityArtwork
                                facility={facility}
                                className="territoryOccupantArtwork"
                                active={status?.kind === "producing"}
                              />
                            </FacilityMapMotionContext.Provider>
                          </g>
                          {status && (
                            <FacilityMapStatusArtwork kind={status.kind} />
                          )}
                        </>
                      ) : (
                        <TowerArtwork className="territoryOccupantArtwork" />
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
                data-project-site={projectSites?.get(tile.id)}
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
                  projectPlanning
                    ? `Inspect ${territoryTileLabel(tile)}${projectSites?.has(tile.id) ? ` · ${projectSites.get(tile.id) === "owned" ? "Connected · free site" : `Connection required · ${money(quote?.price ?? 0)}`}` : " · unavailable for this project"}`
                    : quote
                      ? `${unaffordable ? "Inspect" : "Connect"} ${territoryTileLabel(tile)} · ${priceLabel}${unaffordable ? "; not enough available cash" : ""}`
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
                  activateTile(tile.id);
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
                title={`${TERRAIN_LABELS[tile.terrain]} · ${facility?.name ?? (tile.city ? `${tile.city.sector} city` : view.developed ? (wireStructure(view) === "submerged" ? "Open water · submerged cable" : "Open site · transmission tower") : "Undeveloped site")}${status ? ` · ${status.label}` : ""}`}
              >
                <span className="territoryTileHitArea" aria-hidden="true" />
                {projectSites?.has(tile.id) && (
                  <svg
                    className="projectSiteOutline"
                    aria-hidden="true"
                    viewBox={`${-HEX_WIDTH / 2} ${-HEX_HEIGHT / 2} ${HEX_WIDTH} ${HEX_HEIGHT}`}
                  >
                    <path d={hexFacePath} />
                    {tile.id === activeSelected && (
                      <path
                        className="projectSiteInnerOutline"
                        d={hexFacePath}
                        transform="scale(.85)"
                      />
                    )}
                  </svg>
                )}
                {utility && (
                  <strong>{view.owned ? "You" : view.ownerName}</strong>
                )}
                {projectSites?.get(tile.id) === "owned" && (
                  <span
                    className="territoryTilePrice"
                    aria-hidden="true"
                    title="Connected · free site"
                  >
                    <b>{money(0)}</b>
                  </span>
                )}
                {quote && (!projectPlanning || projectSites?.has(tile.id)) && (
                  <span className="territoryTilePrice" aria-hidden="true">
                    <b>{pending ? "Connecting…" : money(quote.price)}</b>
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
                      : "Connection available"}
                  . {terrainDetailsLabel(tile.terrain)}.{" "}
                  {facility
                    ? `${facility.name}${status ? ` · ${status.label}` : ""}`
                    : tile.city
                      ? `${tile.city.sector} customers; no building slot`
                      : view.developed
                        ? wireStructure(view) === "submerged"
                          ? "One building site; submerged cable"
                          : "One building site; transmission tower"
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
