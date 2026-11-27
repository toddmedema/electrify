import { CouchPlayerText, couchPlayerColor } from "../../couch/PlayerColor";
import * as React from "react";
import { Button, Tooltip, useTheme } from "@mui/material";
import ConceptIcon from "../base/ConceptIcon";
import RapidConnectionIcon from "../base/RapidConnectionIcon";
import type { GameType, TerrainType, TerritoryId } from "../../Types";
import { isLandTerritoryId } from "../../data/Territories";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import {
  territoryMapTileKey,
  type TerritoryMapTileKey,
  type TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import {
  formatConnectionDuration,
  tileConnectionLabel,
  type TileConnection,
} from "../../helpers/TerritoryConnections";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import { cityGrowthAt, type CityGrowthSector } from "../../helpers/CityDemand";
import { projectSiteCapitalCost } from "../../helpers/ProjectBuild";
import type { ReadyProjectSite } from "../../helpers/ProjectBuild";
import { getSunriseSunset, getTimeFromTimeline } from "../../helpers/DateTime";
import type { RendererState } from "../base/territory-3d/TerritoryCanvas3D";
import type { SceneCamera } from "../base/territory-3d/TerritoryScene3D";
import { readMapWeather } from "../base/territory-3d/MapWeather";
import WeatherAtmosphere from "../base/territory-3d/WeatherAtmosphere";
import { useAppSelector } from "../../Store";
import {
  citySizeLabel,
  formatTerrainPercent,
  tileHasConstructionTechnology,
} from "../base/TerritoryTileFacts";
import {
  facilityMapStatus,
  needsSubmergedCable,
} from "../base/FacilityMapStatus";
import useFacilityMapMotion from "../base/useFacilityMapMotion";
import FacilityMapStatusArtwork from "../base/FacilityMapStatusArtwork";
import MapStatusLayers from "../base/MapStatusLayers";
import { useToolState } from "../base/GameToolMemory";
import { hasVisibleEscapeOverlay } from "../base/VisibleEscapeOverlay";
import { useGameWorkspaceLayout } from "../base/GameWorkspaceContext";
import { useMoney } from "../base/CurrencyContext";
import { useTerritoryTilePurchases } from "../base/TerritoryTilePurchases";
import {
  HEX_WIDTH,
  HEX_HEIGHT,
  hexCenter,
  hexFacePath,
  hexWires,
  foregroundOrigin,
} from "../base/TerritoryHexGeometry";
import {
  TERRITORY_OWNER_PALETTE,
  territoryTileLabel,
  tilePurchaseBenefitLabel,
  territoryOwnerColor,
  territoryPeerColors,
} from "../base/TerritoryMapLayout";
import "./TerritoryMapWorkspace.scss";

const TerritoryScene3D = React.lazy(
  () =>
    import(
      /* webpackChunkName: "territory-scene" */ "../base/territory-3d/TerritoryScene3D"
    ),
);
const RENDERER_MESSAGES = {
  loading: "Loading 3D map…",
  lost: "3D graphics disconnected. Waiting to reconnect.",
  unavailable: "The 3D map is unavailable. WebGL2 is required.",
  failed: "The 3D map couldn’t load.",
};
const PAN_OVERSCAN = HEX_WIDTH / 4;
const MIN_TILE_TARGET_HEIGHT = 44;
const CAMERA_SHIFT_MS = 180;

function tileConnectionProgress(
  { startedMinute, connectionMinute }: TileConnection,
  minute: number,
): number {
  const duration = connectionMinute - startedMinute;
  return duration > 0
    ? Math.max(0, Math.min(1, (minute - startedMinute) / duration))
    : 1;
}
const CITY_GROWTH_LABEL: Record<CityGrowthSector, string> = {
  Residential: "homes",
  Commercial: "shops",
  Industrial: "workshops",
};

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
        ? a.city.size === b.city?.size
        : !b.city &&
          a.siteKind === b.siteKind &&
          a.maxPeakW === b.maxPeakW &&
          a.startingAssetId === b.startingAssetId &&
          a.hydroSiteId === b.hydroSiteId))
  );
}

type CameraTarget = ReturnType<typeof hexCenter> & { zoom?: number };

type MapStyle = React.CSSProperties & {
  "--territory-owner-color"?: string;
  "--territory-hover-color"?: string;
};
export interface MapTileMenuTarget {
  key: TerritoryMapTileKey;
  top: number;
  left: number;
}

interface Props {
  game: GameType;
  views: readonly TerritoryTileView[];
  selected?: TerritoryMapTileKey;
  inspected?: TerritoryMapTileKey;
  onSelect: (id: TerritoryMapTileKey, inspect?: boolean) => void;
  onCloseInspection?: () => void;
  inspectionWindow?: "front" | "background";
  onDeselect?: () => void;
  onTileMenu?: (anchor: MapTileMenuTarget) => void;
  dismissInspectionOnBlank?: boolean;
  projectPlanning?: boolean;
  projectPending?: boolean;
  projectSites?: ReadonlyMap<TerritoryMapTileKey, ReadyProjectSite>;
  onProjectDrop?: (key: TerritoryMapTileKey) => void;
  projectWindOutput?: Partial<Record<TerrainType, number>>;
}
export default function TerritoryHexMap({
  game,
  views,
  selected,
  inspected,
  onSelect,
  onCloseInspection,
  inspectionWindow,
  onDeselect,
  onTileMenu,
  dismissInspectionOnBlank,
  projectPlanning = false,
  projectPending = false,
  projectSites,
  onProjectDrop,
  projectWindOutput,
}: Props) {
  const showingProjectSites = projectPlanning || !!onProjectDrop;
  const mapId = React.useId();
  const workspace = useGameWorkspaceLayout();
  const dark = useTheme().palette.mode === "dark";
  const webGLAvailable = typeof WebGL2RenderingContext !== "undefined";
  const [rendererState, setRendererState] = React.useState<
    RendererState | "failed"
  >(webGLAvailable ? "loading" : "unavailable");
  const threeDReady = rendererState === "ready";
  const motion = useFacilityMapMotion(game.speed);
  const weather = React.useMemo(() => readMapWeather(game), [game]);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const cityService =
    now && now.demandW > 0
      ? Math.max(0, Math.min(1, now.supplyW / now.demandW))
      : 1;
  const viewport = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const buyingControl = React.useRef<HTMLButtonElement>(null);
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const { formatPurchasePrice: money } = useMoney();
  const { pendingIds, availableCash, message, purchase } =
    useTerritoryTilePurchases();
  const [buyMode, setBuyMode] = React.useState(false);
  const [showStatusLayer, setShowStatusLayer] = useToolState(
    "network.showStatusLayer",
    false,
  );
  const [showNames, setShowNames] = useToolState("network.showNames", true);
  const topology = useStableArray(
    views.map((view) => ({
      tile: view.tile,
      ownerKey: view.ownerKey,
      developed: view.developed,
      submerged: needsSubmergedCable(view),
    })),
    (a, b) =>
      sameTile(a.tile, b.tile) &&
      a.ownerKey === b.ownerKey &&
      a.developed === b.developed &&
      a.submerged === b.submerged,
  );
  const tiles = React.useMemo(
    () => topology.map((view) => view.tile),
    [topology],
  );
  const {
    seed,
    startingYear,
    location,
    date: { year },
  } = game;
  const cityGrowth = React.useMemo(() => {
    const growth = new Map<TerritoryId, readonly CityGrowthSector[]>();
    for (const tile of tiles) {
      if (!tile.city) continue;
      const sectors = cityGrowthAt(
        { seed, startingYear, location },
        year,
        tile.territoryId,
      );
      if (sectors.length) growth.set(tile.territoryId, sectors);
    }
    return growth;
  }, [tiles, seed, startingYear, location, year]);
  const byKey = React.useMemo(
    () => new Map(views.map((view) => [territoryMapTileKey(view.tile), view])),
    [views],
  );
  const purchaseQuotes = React.useMemo(
    () =>
      buyMode && !showingProjectSites
        ? tilePurchaseQuotes(game, views)
        : undefined,
    [buyMode, showingProjectSites, game, views],
  );
  React.useEffect(() => {
    if (projectPlanning) setBuyMode(false);
  }, [projectPlanning]);
  const activeSelected = selected && byKey.has(selected) ? selected : undefined;
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.defaultPrevented ||
        // The desktop stack owns window dismissal. The map still exits rapid
        // connection mode when its own inspector has the foreground.
        (inspectionWindow && (inspectionWindow !== "front" || !buyMode)) ||
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
      const tool =
        event.target instanceof Element &&
        event.target.closest<HTMLElement>("[data-game-tool], .gameToolPanel");
      if (
        tool &&
        !map.contains(event.target) &&
        tool.dataset.gameTool !== "TILE"
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
      // The nonmodal inspector permits focus in the map and workspace footer.
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
  }, [
    activeSelected,
    buyMode,
    inspectionWindow,
    onCloseInspection,
    onDeselect,
  ]);
  const homeTile =
    views.find(({ owned, tile }) => owned && tile.city)?.tile ??
    views.find(({ owned }) => owned)?.tile ??
    tiles[0];
  const homeKey = homeTile && territoryMapTileKey(homeTile);
  const [rovingId, setRovingId] = React.useState(
    () => activeSelected ?? homeKey,
  );
  const activeRoving =
    activeSelected ?? (rovingId && byKey.has(rovingId) ? rovingId : homeKey);
  const [camera] = React.useState(() => {
    let pose = {
      ...hexCenter(
        (selected ? byKey.get(selected)?.tile : undefined) ??
          homeTile ?? { q: 0, r: 0 },
      ),
      zoom: 1,
    };
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => pose,
      getZoom: () => pose.zoom,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      move(next: typeof pose) {
        pose = next;
        listeners.forEach((listener) => listener());
      },
    } satisfies SceneCamera & {
      getZoom: () => number;
      move: (next: typeof pose) => void;
    };
  });
  const [cullCenter, setCullCenter] = React.useState(camera.getSnapshot);
  const cullAnchor = React.useRef(cullCenter);
  const [size, setSize] = React.useState({
    width: 0,
    height: 0,
    openingWidth: 0,
  });
  // Panning updates the scene without rerendering the map's overlays.
  const zoom = React.useSyncExternalStore(camera.subscribe, camera.getZoom);
  // Fit the starting view to the screen, then leave zoom under the player's control.
  const baseScale =
    size.openingWidth > 0 && size.openingWidth < 600 ? 0.75 : 0.875;
  const scale = baseScale * zoom;
  const worldWidth = size.width / scale;
  const worldHeight = size.height / scale;
  const moveStage = React.useCallback(
    ({ x, y }: ReturnType<typeof hexCenter>) => {
      if (stage.current)
        stage.current.style.transform = `translate(${-x * scale}px, ${-y * scale}px)`;
    },
    [scale],
  );
  const mapBounds = React.useMemo(() => {
    const points = tiles.map(hexCenter);
    const margin = HEX_WIDTH / 2;
    return {
      left: Math.min(...points.map(({ x }) => x)) - margin,
      right: Math.max(...points.map(({ x }) => x)) + margin,
      top: Math.min(...points.map(({ y }) => y)) - margin,
      bottom: Math.max(...points.map(({ y }) => y)) + margin,
    };
  }, [tiles]);
  const cameraShiftFrame = React.useRef<number>();
  const cancelCameraShift = React.useCallback(() => {
    if (cameraShiftFrame.current === undefined) return;
    cancelAnimationFrame(cameraShiftFrame.current);
    cameraShiftFrame.current = undefined;
  }, []);
  const setCamera = React.useCallback(
    (
      update:
        | CameraTarget
        | ((current: ReturnType<typeof camera.getSnapshot>) => CameraTarget),
      animate = false,
    ) => {
      cancelCameraShift();
      const current = camera.getSnapshot();
      const point = typeof update === "function" ? update(current) : update;
      const next = {
        x: Math.max(mapBounds.left, Math.min(mapBounds.right, point.x)),
        y: Math.max(mapBounds.top, Math.min(mapBounds.bottom, point.y)),
        zoom: point.zoom ?? current.zoom,
      };
      if (
        next.x === current.x &&
        next.y === current.y &&
        next.zoom === current.zoom
      )
        return;
      const move = (position: typeof next) => {
        // On zoom, the layout effect moves the stage with the new overlay scale.
        if (position.zoom === zoom) moveStage(position);
        if (
          Math.abs(position.x - cullAnchor.current.x) >= PAN_OVERSCAN ||
          Math.abs(position.y - cullAnchor.current.y) >= PAN_OVERSCAN
        ) {
          cullAnchor.current = position;
          setCullCenter(position);
        }
        camera.move(position);
      };
      if (!animate) {
        move(next);
        return;
      }

      // Advance the stage, scene and hit testing with the same camera coordinates.
      let start: number | undefined;
      const shift = (time: number) => {
        start ??= time;
        const elapsed = time - start;
        if (elapsed >= CAMERA_SHIFT_MS) {
          cameraShiftFrame.current = undefined;
          move(next);
          return;
        }
        const remaining = 1 - elapsed / CAMERA_SHIFT_MS;
        const progress = 1 - remaining * remaining * remaining;
        move({
          x: current.x + (next.x - current.x) * progress,
          y: current.y + (next.y - current.y) * progress,
          zoom: current.zoom,
        });
        cameraShiftFrame.current = requestAnimationFrame(shift);
      };
      cameraShiftFrame.current = requestAnimationFrame(shift);
    },
    [camera, mapBounds, moveStage, cancelCameraShift, zoom],
  );
  React.useLayoutEffect(() => {
    moveStage(camera.getSnapshot());
    return cancelCameraShift;
  }, [camera, mapBounds, moveStage, cancelCameraShift]);
  const focusAfterNavigation = React.useRef<TerritoryMapTileKey>();
  const pointer = React.useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  }>();
  const pointers = React.useRef(
    new Map<number, { clientX: number; clientY: number } | null>(),
  );
  const gestureScale = React.useRef<number>();
  const suppressClick = React.useRef(false);
  const activation = React.useRef<{
    tileKey: TerritoryMapTileKey;
    quoteKey?: string;
  }>();
  const tooltip = React.useRef<HTMLDivElement>(null);
  const tooltipAnchor = React.useRef<{
    source: HTMLElement;
    clientX: number;
    clientY: number;
  }>();
  const pointerHover = React.useRef<HTMLElement>();
  const hoverFrame = React.useRef<number>();
  const hoverPoint = React.useRef<{
    target: EventTarget;
    clientX: number;
    clientY: number;
  }>();
  const clearHover = React.useCallback(() => {
    if (hoverFrame.current !== undefined)
      cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = undefined;
    hoverPoint.current = undefined;
    if (pointerHover.current) delete pointerHover.current.dataset.modelHovered;
    pointerHover.current = undefined;
    tooltipAnchor.current = undefined;
    if (tooltip.current) tooltip.current.hidden = true;
  }, []);
  React.useEffect(() => clearHover, [clearHover]);
  const cancelPointer = (id: number) => {
    clearHover();
    pointers.current.delete(id);
    pointer.current = undefined;
    activation.current = undefined;
    suppressClick.current = true;
  };
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
      byKey.get(activeSelected ?? activeRoving!)?.tile ?? { q: 0, r: 0 },
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
    const rangeX = Math.max(0, size.width / (2 * baseScale) - HEX_WIDTH);
    const rangeY = Math.max(0, size.height / (2 * baseScale) - HEX_WIDTH);
    // Start toward the useful land without clipping the capital or resumed selection.
    // Frame once per run: purchases, frontier reveals and resize keep the player's camera.
    setCamera({
      x: Math.max(focus.x - rangeX, Math.min(center.x, focus.x + rangeX)),
      y: Math.max(focus.y - rangeY, Math.min(center.y, focus.y + rangeY)),
      zoom: 1,
    });
    setBuyMode(false);
  }, [
    runId,
    game.seed,
    game.scenarioId,
    size.width,
    size.height,
    baseScale,
    activeSelected,
    activeRoving,
    byKey,
    views,
    setCamera,
  ]);
  React.useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const gameStage = element.closest<HTMLElement>(".gameStage");
    const measure = () => {
      const { clientWidth: width, clientHeight: height, offsetTop } = element;
      // Share the row height with both the map and portaled inspector layouts.
      gameStage?.style.setProperty("--territory-map-inset", `${offsetTop}px`);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height, openingWidth: previous.openingWidth || width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      gameStage?.style.removeProperty("--territory-map-inset");
    };
  }, []);
  const zoomAt = React.useCallback(
    (factor: number, from: { clientX: number; clientY: number }, to = from) => {
      const element = viewport.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // Limit zoom at the camera so the projected hexes stay large enough to tap.
      const minZoom = MIN_TILE_TARGET_HEIGHT / (HEX_HEIGHT * baseScale);
      // Keep the same point on the ground under the pointer or pinch midpoint.
      setCamera((point) => {
        const zoom = Math.max(minZoom, Math.min(2, point.zoom * factor));
        const oldScale = baseScale * point.zoom;
        const newScale = baseScale * zoom;
        return {
          x:
            point.x +
            (from.clientX - x) / oldScale -
            (to.clientX - x) / newScale,
          y:
            point.y +
            (from.clientY - y) / oldScale -
            (to.clientY - y) / newScale,
          zoom,
        };
      });
    },
    [baseScale, setCamera],
  );
  React.useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const deltaMode = event.deltaMode;
      const unit =
        deltaMode === 1 ? 16 : deltaMode === 2 ? element.clientHeight : 1;
      clearHover();
      if ((event.ctrlKey || !event.shiftKey) && event.deltaY) {
        zoomAt(Math.exp((-event.deltaY * unit) / 600), event);
        return;
      }
      const currentScale = baseScale * camera.getZoom();
      setCamera((point) => ({
        x:
          point.x +
          ((event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) *
            unit) /
            currentScale,
        y:
          point.y +
          ((event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit) /
            currentScale,
      }));
    };
    // Safari sends trackpad pinches as GestureEvents. Touch pinches already
    // use pointer events below, so only apply the gesture scale for a trackpad.
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale.current = 1;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as MouseEvent & { scale: number };
      const previous = gestureScale.current;
      if (!previous || !Number.isFinite(gesture.scale) || gesture.scale <= 0)
        return;
      gestureScale.current = gesture.scale;
      if (pointers.current.size) return;
      clearHover();
      zoomAt(gesture.scale / previous, gesture);
    };
    const gestureEnd = () => {
      gestureScale.current = undefined;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gestureStart, { passive: false });
    element.addEventListener("gesturechange", gestureChange, {
      passive: false,
    });
    element.addEventListener("gestureend", gestureEnd);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
      element.removeEventListener("gestureend", gestureEnd);
    };
  }, [baseScale, camera, clearHover, setCamera, zoomAt]);
  React.useLayoutEffect(() => {
    if (!focusAfterNavigation.current) return;
    const target = stage.current?.querySelector<HTMLButtonElement>(
      `[data-map-target="${focusAfterNavigation.current}"]`,
    );
    target?.focus({ preventScroll: true });
    if (target) focusAfterNavigation.current = undefined;
  }, [selected, cullCenter]);
  const renderedTiles = useStableArray(
    tiles.filter((tile) => {
      const point = hexCenter(tile);
      return (
        territoryMapTileKey(tile) === activeRoving ||
        (Math.abs(point.x - cullCenter.x) <
          worldWidth / 2 + HEX_WIDTH + PAN_OVERSCAN &&
          Math.abs(point.y - cullCenter.y) <
            worldHeight / 2 + HEX_WIDTH + PAN_OVERSCAN)
      );
    }),
    (a, b) => a === b,
  );
  const renderedViews = React.useMemo(
    () =>
      renderedTiles.map((tile) => ({
        ...byKey.get(territoryMapTileKey(tile))!,
        tile,
      })),
    [renderedTiles, byKey],
  );
  const peerIds = useStableArray(
    [
      ...(game.multiplayer?.peers?.map((peer) => peer.id) ?? []),
      ...views.flatMap((view) =>
        view.ownerKey?.startsWith("peer:") ? [view.ownerKey.slice(5)] : [],
      ),
    ].filter((id) => id !== game.multiplayer?.seat),
    (a, b) => a === b,
  );
  const mode = dark ? "dark" : "light";
  const peerColors = React.useMemo(
    () => territoryPeerColors(peerIds),
    [peerIds],
  );
  const color = (id: string) => territoryOwnerColor(id, peerColors);
  const ownColor = couchPlayerColor(game.multiplayer?.seat, mode);
  const ownerPalette = React.useMemo(() => {
    const palette = TERRITORY_OWNER_PALETTE[mode];
    if (!ownColor) return palette;
    // Both the SVG overlay and the 3D borders resolve these same palette variables.
    const couchPalette: Record<string, string> = {
      ...palette,
      "--territory-owner-you": ownColor,
    };
    for (const [id, variable] of Object.entries(peerColors)) {
      const peerColor = couchPlayerColor(id, mode);
      if (peerColor) couchPalette[variable.slice(4, -1)] = peerColor;
    }
    return couchPalette;
  }, [mode, ownColor, peerColors]);
  const tileHover = (view: TerritoryTileView) => {
    const { tile } = view;
    const unavailable = (reason: string) => ({
      color: "var(--blackout-red)",
      reason,
    });
    const available = (reason: string) => ({
      color: "var(--interactive-blue)",
      reason,
    });
    if (buyMode && !showingProjectSites && view.connectable)
      return available("");
    if (showingProjectSites && projectSites?.has(territoryMapTileKey(tile)))
      return available("Compatible site");
    if (view.ownerKey && !view.owned)
      return {
        color: color(view.ownerKey),
        reason: "",
      };
    if (showingProjectSites) return unavailable("Unavailable for this project");
    if (view.connection) return unavailable("");
    if (buyMode || tile.city) return unavailable("");
    if (view.reserved)
      return unavailable(view.facility ? "" : "Site already used");
    if (!tileHasConstructionTechnology(tile))
      return unavailable("No compatible technology");
    return !view.owned && !view.connectable ? unavailable("") : available("");
  };
  const allWires = React.useMemo(() => {
    const index = new Map(
      topology.map((view) => [territoryMapTileKey(view.tile), view]),
    );
    return hexWires(
      tiles.map((tile) => ({
        q: tile.q,
        r: tile.r,
        id: territoryMapTileKey(tile),
      })),
      (tile) => !!index.get(tile.id)?.developed,
      (a, b) => index.get(a.id)?.ownerKey === index.get(b.id)?.ownerKey,
      (tile) => !!index.get(tile.id)?.submerged,
    );
  }, [tiles, topology]);
  const selectedTile = React.useMemo(
    () => tiles.find((tile) => territoryMapTileKey(tile) === activeSelected),
    [tiles, activeSelected],
  );
  const wires = React.useMemo(() => {
    const rendered = new Set(renderedTiles.map(territoryMapTileKey));
    return allWires.filter(
      (wire) => rendered.has(wire.from) && rendered.has(wire.to),
    );
  }, [allWires, renderedTiles]);
  const revealTile = (tile: { q: number; r: number }) => {
    const target = hexCenter(tile);
    const railWidth =
      viewport.current
        ?.closest(".territoryNetwork")
        ?.querySelector<HTMLElement>(".desktopBuildRail")?.offsetWidth ?? 0;
    setCamera((current) => ({
      x:
        current.x +
        Math.max(
          0,
          target.x - current.x - Math.max(0, worldWidth / 2 - HEX_WIDTH),
        ) +
        Math.min(
          0,
          target.x -
            current.x +
            Math.max(0, worldWidth / 2 - HEX_WIDTH - railWidth / scale),
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
  const inspectTile = (
    tile: TerritoryTileView["tile"],
    fromPointer: boolean,
  ) => {
    if ((workspace?.effectiveWidth ?? size.width) <= 740) {
      const point = hexCenter(tile);
      let offsetY = worldHeight * (projectPlanning ? 0.3 : -0.22);
      const map = viewport.current?.getBoundingClientRect();
      if (!projectPlanning && map?.height) {
        // Center on the screen even when the game header wraps. Short views keep room
        // for the inspector above the tile.
        const targetY = Math.min(
          map.height - 40,
          Math.max(144, window.innerHeight / 2 - map.top),
        );
        offsetY = (map.height / 2 - targetY) / scale;
      }
      setCamera(
        { x: point.x, y: point.y + offsetY },
        fromPointer && motion.allowed,
      );
    }
    onSelect(territoryMapTileKey(tile), true);
  };
  const rememberActivation = (key?: TerritoryMapTileKey) => {
    const tile = key && byKey.get(key)?.tile;
    const quote = tile && purchaseQuotes?.get(tile.id);
    activation.current = key
      ? {
          tileKey: key,
          quoteKey:
            quote &&
            quote.price <= availableCash &&
            !pendingIds.has(quote.tileId)
              ? quote.quoteKey
              : undefined,
        }
      : undefined;
  };
  const activateTile = (key: TerritoryMapTileKey, fromPointer = false) => {
    const started = activation.current;
    activation.current = undefined;
    const view = byKey.get(key);
    if (!view) return;
    const { tile } = view;
    const quote = purchaseQuotes?.get(tile.id),
      expectedQuote =
        started?.tileKey === key ? started.quoteKey : quote?.quoteKey;
    onSelect(key);
    if (pendingIds.has(tile.id)) return;
    if (
      expectedQuote &&
      quote &&
      quote.price <= availableCash &&
      !projectPlanning
    )
      void purchase(tile.id, expectedQuote);
    else if (key === inspected) onDeselect?.();
    else inspectTile(tile, fromPointer);
  };
  // Hover and selection follow the hex grid's own hit areas, so terrain relief
  // and facility models never steal a tile from the hex under the pointer.
  const pointerTile = (event: { target: EventTarget }) => {
    const element = event.target instanceof Element ? event.target : undefined;
    return element?.closest<HTMLButtonElement>("[data-map-target]")?.dataset
      .mapTarget as TerritoryMapTileKey | undefined;
  };
  const showTooltip = React.useCallback(
    (anchor?: NonNullable<typeof tooltipAnchor.current>) => {
      tooltipAnchor.current = anchor;
      const node = tooltip.current;
      const rect = viewport.current?.getBoundingClientRect();
      if (!node || !rect) return;
      const text = anchor?.source.isConnected
        ? anchor.source.dataset.tooltip
        : undefined;
      node.hidden = !text;
      if (!text || !anchor) return;
      if (node.textContent !== text) node.textContent = text;
      const x = anchor.clientX - rect.left;
      const y = anchor.clientY - rect.top;
      const left = Math.max(
        8,
        Math.min(x + 12, rect.width - node.offsetWidth - 8),
      );
      const top =
        y + 16 + node.offsetHeight <= rect.height - 8
          ? y + 16
          : Math.max(8, y - node.offsetHeight - 8);
      node.style.transform = `translate(${left}px, ${top}px)`;
    },
    [],
  );
  React.useLayoutEffect(() => {
    // Ownership, project quotes and status can change under a stationary pointer.
    if (tooltipAnchor.current) showTooltip(tooltipAnchor.current);
  });
  const hoverTile = (event: NonNullable<typeof hoverPoint.current>) => {
    const key = pointerTile(event);
    const target = key
      ? stage.current?.querySelector<HTMLButtonElement>(
          `[data-map-target="${key}"]`,
        )
      : undefined;
    const model = threeDReady ? target : undefined;
    if (model !== pointerHover.current) {
      if (pointerHover.current)
        delete pointerHover.current.dataset.modelHovered;
      if (model) model.dataset.modelHovered = "true";
      pointerHover.current = model ?? undefined;
    }
    const price =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".territoryTilePrice")
        : undefined;
    const source = price?.dataset.tooltip !== undefined ? price : target;
    showTooltip(
      source
        ? { source, clientX: event.clientX, clientY: event.clientY }
        : undefined,
    );
  };
  const openTileMenu = (
    key: TerritoryMapTileKey,
    left: number,
    top: number,
  ) => {
    activation.current = undefined;
    suppressClick.current = true;
    stage.current
      ?.querySelector<HTMLButtonElement>(`[data-map-target="${key}"]`)
      ?.focus({ preventScroll: true });
    clearHover();
    onTileMenu?.({ key, left, top });
  };
  const navigate = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: TerritoryMapTileKey,
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
    const tile = byKey.get(id)?.tile;
    if (!direction || !tile) return;
    const point = hexCenter(tile);
    const next = tiles
      .filter((other) => territoryMapTileKey(other) !== id)
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
    const key = territoryMapTileKey(next.tile);
    focusAfterNavigation.current = key;
    onSelect(key);
    revealTile(next.tile);
  };
  return (
    <div
      className="territoryMap"
      data-buy-mode={buyMode}
      data-renderer={rendererState}
      aria-label="Terrain, structures and utility ownership"
      style={ownerPalette as MapStyle}
    >
      <MapStatusLayers
        showStatus={showStatusLayer}
        onStatusChange={setShowStatusLayer}
        showNames={showNames}
        onNamesChange={setShowNames}
      />
      <Tooltip
        title={
          buyMode
            ? "Rapid connection mode is on · Select again to exit."
            : "Rapid connection mode · Show connection prices."
        }
        placement="top"
        arrow
      >
        <button
          type="button"
          className="territoryMapControl territoryMapBuyToggle"
          ref={buyingControl}
          aria-label="Rapid connection mode"
          aria-pressed={buyMode}
          aria-disabled={projectPending || undefined}
          aria-describedby={`${mapId}-buy-status`}
          onClick={() => {
            if (projectPending) return;
            if (projectPlanning) onDeselect?.();
            setBuyMode((value) => !value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp") return;
            const entry = stage.current?.querySelector<HTMLButtonElement>(
              "[data-map-target][tabindex='0']",
            );
            if (!entry) return;
            event.preventDefault();
            entry.focus({ preventScroll: true });
          }}
        >
          <RapidConnectionIcon aria-hidden="true" />
        </button>
      </Tooltip>
      <span
        className="srOnly"
        id={`${mapId}-buy-status`}
        role="status"
        aria-label="Rapid connection instructions"
        aria-live="polite"
        aria-atomic="true"
      >
        {buyMode
          ? "Rapid connection mode is on. Select a priced site to pay the displayed connection cost."
          : ""}
      </span>
      <span
        className="srOnly"
        role="status"
        aria-label="Connection result"
        aria-live="polite"
        aria-atomic="true"
      >
        {message}
      </span>
      {rendererState !== "ready" && (
        <div className="territoryRendererMessage">
          <span role="status" aria-label="3D map">
            {RENDERER_MESSAGES[rendererState]}
          </span>
          {rendererState === "failed" && (
            <Button size="small" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          )}
        </div>
      )}
      <div
        className="territoryMapViewport"
        role="region"
        aria-label="Territory map"
        data-camera-scale={scale}
        ref={viewport}
        onDragOver={(event) => {
          if (!onProjectDrop) return;
          const key = pointerTile(event);
          if (!key || !projectSites?.has(key)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!onProjectDrop) return;
          const key = pointerTile(event);
          if (!key || !projectSites?.has(key)) return;
          event.preventDefault();
          onProjectDrop(key);
        }}
        onPointerDown={(event) => {
          const middle = event.button === 1;
          if (event.button !== 0 && !middle) return;
          cancelCameraShift();
          clearHover();
          const id = middle ? undefined : pointerTile(event);
          if (middle) event.preventDefault();
          rememberActivation(id);
          const { pointerId, pointerType, clientX, clientY } = event;
          pointers.current.set(
            pointerId,
            pointerType === "touch" ? { clientX, clientY } : null,
          );
          if (pointers.current.size > 1) {
            // The camera can cull the original touch targets while pinching.
            for (const [id, point] of pointers.current) {
              if (point) event.currentTarget.setPointerCapture?.(id);
            }
            suppressClick.current = true;
            activation.current = undefined;
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
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onPointerMove={(event) => {
          const { pointerId, clientX, clientY } = event;
          const previous = pointers.current.get(pointerId);
          if (previous) {
            pointers.current.set(pointerId, { clientX, clientY });
            if (pointers.current.size === 2) {
              const other = [...pointers.current].find(
                ([id]) => id !== pointerId,
              )?.[1];
              if (!other) return;
              const distance = Math.hypot(
                previous.clientX - other.clientX,
                previous.clientY - other.clientY,
              );
              const nextDistance = Math.hypot(
                clientX - other.clientX,
                clientY - other.clientY,
              );
              if (distance > 0 && nextDistance > 0) {
                zoomAt(
                  nextDistance / distance,
                  {
                    clientX: (previous.clientX + other.clientX) / 2,
                    clientY: (previous.clientY + other.clientY) / 2,
                  },
                  {
                    clientX: (clientX + other.clientX) / 2,
                    clientY: (clientY + other.clientY) / 2,
                  },
                );
              }
              return;
            }
          }
          const drag = pointer.current;
          if (
            !drag ||
            drag.id !== event.pointerId ||
            pointers.current.size !== 1
          ) {
            if (event.pointerType !== "touch" && !pointers.current.size) {
              const { target, clientX, clientY } = event;
              hoverPoint.current = { target, clientX, clientY };
              hoverFrame.current ??= requestAnimationFrame(() => {
                hoverFrame.current = undefined;
                const point = hoverPoint.current;
                hoverPoint.current = undefined;
                if (point) hoverTile(point);
              });
            }
            return;
          }
          const dx = event.clientX - drag.x,
            dy = event.clientY - drag.y;
          if (!drag.dragging && dx * dx + dy * dy < 36) return;
          if (!drag.dragging)
            event.currentTarget.setPointerCapture?.(event.pointerId);
          clearHover();
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
          pointers.current.delete(event.pointerId);
          if (pointer.current?.id === event.pointerId)
            pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => cancelPointer(event.pointerId)}
        onLostPointerCapture={(event) => {
          if (
            event.target === event.currentTarget &&
            pointers.current.has(event.pointerId)
          ) {
            cancelPointer(event.pointerId);
          }
        }}
        onPointerLeave={(event) => {
          clearHover();
          const drag = pointer.current;
          if (
            event.pointerType === "mouse" &&
            drag?.id === event.pointerId &&
            !drag.dragging
          ) {
            pointers.current.delete(event.pointerId);
            pointer.current = undefined;
            activation.current = undefined;
            suppressClick.current = true;
          }
        }}
        onContextMenu={(event) => {
          const key = pointerTile(event);
          if (!key || !onTileMenu) return;
          event.preventDefault();
          openTileMenu(key, event.clientX, event.clientY);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail !== 0) {
            activation.current = undefined;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.detail === 0) return;
          const id = pointerTile(event);
          if (activation.current?.tileKey !== id) {
            activation.current = undefined;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (id) {
            event.preventDefault();
            event.stopPropagation();
            activateTile(id, true);
          } else if (dismissInspectionOnBlank) {
            onCloseInspection?.();
          }
        }}
      >
        {webGLAvailable && (
          <MapSceneBoundary onError={() => setRendererState("failed")}>
            <React.Suspense fallback={null}>
              <TerritoryScene3D
                views={renderedViews}
                tiles={tiles}
                cityGrowth={cityGrowth}
                ownership={topology}
                ownerPalette={ownerPalette}
                peerColors={peerColors}
                selectedTile={selectedTile}
                wires={wires}
                minute={game.date.minute}
                minuteOfDay={game.date.minuteOfDay}
                speed={game.speed}
                runKey={`${runId}:${game.seed}:${game.scenarioId}`}
                daylight={getSunriseSunset(game.date, game.location)}
                dark={dark}
                camera={camera}
                baseScale={baseScale}
                frame={{
                  width: size.width,
                  height: size.height,
                  dpr: window.devicePixelRatio || 1,
                  background: dark ? [0.035, 0.055, 0.07] : [0.86, 0.9, 0.9],
                  cityService,
                  visible: size.width > 0 && size.height > 0,
                  motionAllowed: motion.allowed,
                  playbackRate: motion.rate,
                  weather,
                }}
                onState={setRendererState}
              />
            </React.Suspense>
          </MapSceneBoundary>
        )}
        <WeatherAtmosphere weather={weather} motion={motion} dark={dark} />
        <div className="territoryMapStage" ref={stage}>
          {showStatusLayer && (
            <svg className="territoryFacilityStatusLayer" aria-hidden="true">
              <g transform={`scale(${scale})`}>
                {renderedViews.map((view) => {
                  const status = facilityMapStatus(view, game.date.minute);
                  const kind = view.connection ? "construction" : status?.kind;
                  if (!kind || kind === "unknown") return null;
                  const progress = view.connection
                    ? tileConnectionProgress(view.connection, game.date.minute)
                    : status?.progress;
                  const key = territoryMapTileKey(view.tile);
                  const origin = foregroundOrigin(view.tile);
                  return (
                    <svg
                      key={key}
                      className="territoryFog"
                      data-visibility-distance={view.visibilityDistance}
                      data-facility-status={view.connection ? undefined : kind}
                      data-connection-status={
                        view.connection ? kind : undefined
                      }
                      data-status-tile={key}
                      x={origin.x}
                      y={origin.y}
                      width={HEX_WIDTH}
                      height={HEX_WIDTH}
                      viewBox="0 0 500 500"
                      overflow="visible"
                    >
                      <FacilityMapStatusArtwork
                        kind={kind}
                        progress={progress}
                      />
                    </svg>
                  );
                })}
              </g>
            </svg>
          )}
          {renderedViews.map((view) => {
            const { tile, facility, disaster } = view,
              key = territoryMapTileKey(tile),
              point = hexCenter(tile);
            const status = facilityMapStatus(view, game.date.minute);
            const construction = view.connection
              ? tileConnectionProgress(view.connection, game.date.minute)
              : status?.progress;
            const utility = !!tile.city && !!view.ownerKey;
            const cityLabel =
              tile.city?.name ?? (tile.city && citySizeLabel(tile.city.size));
            const showName = showNames && !!cityLabel;
            const quote = purchaseQuotes?.get(tile.id);
            const projectSite = projectSites?.get(key);
            const projectPrice = projectSite
              ? money(projectSiteCapitalCost(projectSite))
              : undefined;
            const hover = tileHover(view);
            const pending = pendingIds.has(tile.id);
            const unaffordable = !!quote && quote.price > availableCash;
            const label = utility
              ? `Inspect ${view.owned ? "You" : view.ownerName} territory${cityLabel ? ` · ${cityLabel}` : ""}`
              : `Inspect ${territoryTileLabel(tile)}`;
            const outputFactor = projectWindOutput?.[tile.terrain] ?? 1;
            const outputModifier =
              Math.abs(outputFactor - 1) >= 0.005
                ? formatTerrainPercent(outputFactor)
                : undefined;
            const projectLabel = projectSite
              ? `Total project cost (${projectPrice}) · ${projectSite.owned ? "Already connected" : "Connection included"}${outputModifier ? ` · ${outputModifier} estimated output vs flat terrain` : ""}`
              : undefined;
            const growth = tile.city && cityGrowth.get(tile.territoryId);
            const terrainAndStatus = [
              cityLabel ?? TERRAIN_LABELS[tile.terrain],
              growth &&
                `New buildings: ${growth.map((sector) => CITY_GROWTH_LABEL[sector]).join(", ")}`,
              facility?.name,
              status?.kind === "unknown" ? undefined : status?.label,
              view.connection &&
                tileConnectionLabel(view.connection, game.date.minute),
              construction !== undefined &&
                `${Math.min(99, Math.floor(construction * 100))}% complete`,
              disaster?.condition,
              disaster?.facilityImpact,
              view.owned || !view.ownerKey ? undefined : view.ownerName,
            ]
              .filter(Boolean)
              .join(" · ");
            const unconnected =
              !view.owned && !view.ownerKey ? "Unconnected" : undefined;
            const tileDescription = [
              terrainAndStatus,
              unconnected,
              hover.reason,
            ]
              .filter(Boolean)
              .join(" · ");
            const tileTooltip =
              threeDReady && unconnected
                ? [terrainAndStatus, hover.reason].filter(Boolean).join(" · ")
                : tileDescription;
            // The city is already named in the button label.
            const descriptionId =
              utility && tileDescription === cityLabel
                ? undefined
                : `${mapId}-${key}-status`;
            return (
              <button
                key={key}
                type="button"
                data-map-target={key}
                data-map-inspected={key === inspected || undefined}
                data-territory={tile.territoryId}
                data-owner={view.ownerKey}
                data-owned={view.owned}
                data-connection-building={view.connection ? true : undefined}
                data-terrain={tile.terrain}
                data-ground-condition={disaster?.ground}
                data-municipal-city={
                  tile.city && isLandTerritoryId(tile.territoryId)
                }
                data-project-site={
                  projectSite
                    ? projectSite.owned
                      ? "owned"
                      : "connection"
                    : undefined
                }
                data-purchasable={!!quote}
                data-unaffordable={unaffordable}
                data-tooltip={tileTooltip}
                aria-busy={pending || undefined}
                className={`territoryTileTarget${showName ? " territoryUtilityLabel" : ""}`}
                style={
                  {
                    left: point.x * scale,
                    top: point.y * scale,
                    width: HEX_WIDTH * scale,
                    height: HEX_HEIGHT * scale,
                    "--territory-hover-color": hover.color,
                    ...(view.ownerKey
                      ? { "--territory-owner-color": color(view.ownerKey) }
                      : {}),
                  } as MapStyle
                }
                tabIndex={key === activeRoving ? 0 : -1}
                aria-label={
                  showingProjectSites
                    ? `Inspect ${territoryTileLabel(tile)} · ${projectLabel ?? "unavailable for this project"}`
                    : quote
                      ? `${unaffordable ? "Inspect" : "Connect"} ${territoryTileLabel(tile)} (${money(quote.price)}) · ${tilePurchaseBenefitLabel(quote)} · ${formatConnectionDuration(quote.buildMonths)}${unaffordable ? "; not enough available cash" : ""}`
                      : label
                }
                aria-pressed={key === activeSelected}
                aria-describedby={descriptionId}
                onFocus={(event) => {
                  setRovingId(key);
                  if (key !== selected) onSelect(key);
                  // Touch focus can arrive between pointerup and click.
                  if (
                    !pointer.current &&
                    !pointers.current.size &&
                    activation.current?.tileKey !== key
                  ) {
                    clearHover();
                    revealTile(tile);
                    const source =
                      event.currentTarget.querySelector<HTMLElement>(
                        ".territoryTilePrice[data-tooltip]",
                      ) ?? event.currentTarget;
                    const rect = source.getBoundingClientRect();
                    showTooltip({
                      source,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top + rect.height / 2,
                    });
                  }
                }}
                onBlur={clearHover}
                onClick={() => {
                  activateTile(key);
                }}
                onKeyDown={(event) => {
                  if (
                    onTileMenu &&
                    (event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10"))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openTileMenu(
                      key,
                      rect.left + rect.width / 2,
                      rect.top + rect.height / 2,
                    );
                    return;
                  }
                  if (
                    (event.key === "Enter" || event.key === " ") &&
                    !event.repeat
                  )
                    rememberActivation(key);
                  navigate(event, key);
                }}
              >
                <span className="territoryTileHitArea" aria-hidden="true" />
                {projectSite && (
                  <svg
                    className="projectSiteOutline"
                    aria-hidden="true"
                    viewBox={`${-HEX_WIDTH / 2} ${-HEX_HEIGHT / 2} ${HEX_WIDTH} ${HEX_HEIGHT}`}
                  >
                    <path d={hexFacePath} />
                    {key === activeSelected && (
                      <path
                        className="projectSiteInnerOutline"
                        d={hexFacePath}
                        transform="scale(.85)"
                      />
                    )}
                  </svg>
                )}
                {showName && (
                  <strong>
                    <span>{cityLabel}</span>
                    {utility && (
                      <span>
                        <CouchPlayerText
                          seatId={
                            view.ownerKey?.startsWith("peer:")
                              ? view.ownerKey.slice(5)
                              : view.owned
                                ? game.multiplayer?.seat
                                : undefined
                          }
                        >
                          {view.owned ? "You" : view.ownerName}
                        </CouchPlayerText>
                      </span>
                    )}
                  </strong>
                )}
                {projectSite && (
                  <span
                    className="territoryTilePrice"
                    aria-hidden="true"
                    data-tooltip={projectLabel}
                  >
                    <b>{`(${projectPrice})`}</b>
                    {outputModifier && (
                      <span
                        className="territoryTileProduction"
                        data-favorable={outputFactor > 1}
                      >
                        {outputModifier}
                        <ConceptIcon
                          concept="supply"
                          fontSize="small"
                          color="inherit"
                          decorative
                        />
                      </span>
                    )}
                  </span>
                )}
                {quote && !projectPlanning && (
                  <span className="territoryTilePrice" aria-hidden="true">
                    <b>{pending ? "Connecting…" : `(${money(quote.price)})`}</b>
                    {quote.benefit !== "general" && (
                      <span>{tilePurchaseBenefitLabel(quote)}</span>
                    )}
                  </span>
                )}
                {descriptionId && (
                  <span className="srOnly" id={descriptionId}>
                    {tileDescription}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div
          ref={tooltip}
          className="territoryMapTooltip"
          role="tooltip"
          hidden
        />
      </div>
    </div>
  );
}
