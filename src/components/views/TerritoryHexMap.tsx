import * as React from "react";
import { Tooltip, useTheme } from "@mui/material";
import RapidConnectionIcon from "../base/RapidConnectionIcon";
import type { GameType } from "../../Types";
import { isLandTerritoryId } from "../../data/Territories";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
import { FACILITY_FUELS } from "../../data/FacilityFuels";
import {
  territoryMapTileKey,
  type TerritoryMapTileKey,
  type TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import { tilePurchaseQuotes } from "../../helpers/Territories";
import { projectSiteCapitalCost } from "../../helpers/ProjectBuild";
import type { ReadyProjectSite } from "../../helpers/ProjectBuild";
import { tileSupportsFacilityTechnology } from "../../helpers/TerritoryTiles";
import { getSunriseSunset } from "../../helpers/DateTime";
import type { RendererState } from "../base/territory-3d/TerritoryCanvas3D";
import type { ScenePicker } from "../base/territory-3d/SceneBuilder";
import type { SceneCamera } from "../base/territory-3d/TerritoryScene3D";
import { readMapWeather } from "../base/territory-3d/MapWeather";
import WeatherAtmosphere from "../base/territory-3d/WeatherAtmosphere";
import { useAppSelector } from "../../Store";
import { citySizeLabel, terrainDetailsLabel } from "../base/TerritoryTileFacts";
import {
  facilityMapStatus,
  facilityOperatingStatus,
} from "../base/FacilityMapStatus";
import useFacilityMapMotion, {
  FacilityMapMotionContext,
} from "../base/useFacilityMapMotion";
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
const PAN_OVERSCAN = HEX_WIDTH / 4;

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

type MapStyle = React.CSSProperties & {
  "--territory-owner-color"?: string;
  "--territory-hover-color"?: string;
};
interface Props {
  game: GameType;
  views: readonly TerritoryTileView[];
  selected?: TerritoryMapTileKey;
  onSelect: (id: TerritoryMapTileKey, inspect?: boolean) => void;
  onCloseInspection?: () => void;
  onDeselect?: () => void;
  projectPlanning?: boolean;
  projectPending?: boolean;
  projectSites?: ReadonlyMap<TerritoryMapTileKey, ReadyProjectSite>;
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
  views,
  selected,
  onSelect,
  onCloseInspection,
  onDeselect,
  projectPlanning = false,
  projectPending = false,
  projectSites,
}: Props) {
  const mapId = React.useId();
  const workspace = useGameWorkspaceLayout();
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
  const weather = React.useMemo(() => readMapWeather(game), [game]);
  const viewport = React.useRef<HTMLDivElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const buyingControl = React.useRef<HTMLButtonElement>(null);
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const { formatMoneyConcise: money } = useMoney();
  const { pendingIds, availableCash, message, purchase } =
    useTerritoryTilePurchases();
  const [buyMode, setBuyMode] = React.useState(false);
  const [showStatusLayer, setShowStatusLayer] = useToolState(
    "network.showStatusLayer",
    true,
  );
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
  const byKey = React.useMemo(
    () => new Map(views.map((view) => [territoryMapTileKey(view.tile), view])),
    [views],
  );
  const purchaseQuotes = React.useMemo(
    () =>
      buyMode && !projectPlanning ? tilePurchaseQuotes(game, views) : undefined,
    [buyMode, projectPlanning, game, views],
  );
  React.useEffect(() => {
    if (projectPlanning) setBuyMode(false);
  }, [projectPlanning]);
  const activeSelected = selected && byKey.has(selected) ? selected : undefined;
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
    let center = hexCenter(
      (selected ? byKey.get(selected)?.tile : undefined) ??
        homeTile ?? { q: 0, r: 0 },
    );
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => center,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      move(next: typeof center) {
        center = next;
        listeners.forEach((listener) => listener());
      },
    } satisfies SceneCamera & { move: (next: typeof center) => void };
  });
  const [cullCenter, setCullCenter] = React.useState(camera.getSnapshot);
  const cullAnchor = React.useRef(cullCenter);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const scale = size.width > 0 && size.width < 600 ? 0.75 : 0.875;
  const worldWidth = size.width / scale;
  const worldHeight = size.height / scale;
  const moveStage = React.useCallback(
    ({ x, y }: ReturnType<typeof hexCenter>) => {
      if (stage.current)
        stage.current.style.transform = `translate(${size.width / 2 - x * scale}px, ${size.height / 2 - y * scale}px)`;
    },
    [size.width, size.height, scale],
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
  const setCamera = React.useCallback(
    (update: React.SetStateAction<ReturnType<typeof hexCenter>>) => {
      const current = camera.getSnapshot();
      const point = typeof update === "function" ? update(current) : update;
      const next = {
        x: Math.max(mapBounds.left, Math.min(mapBounds.right, point.x)),
        y: Math.max(mapBounds.top, Math.min(mapBounds.bottom, point.y)),
      };
      if (next.x === current.x && next.y === current.y) return;
      moveStage(next);
      if (
        Math.abs(next.x - cullAnchor.current.x) >= PAN_OVERSCAN ||
        Math.abs(next.y - cullAnchor.current.y) >= PAN_OVERSCAN
      ) {
        cullAnchor.current = next;
        setCullCenter(next);
      }
      camera.move(next);
    },
    [camera, mapBounds, moveStage],
  );
  React.useLayoutEffect(
    () => moveStage(camera.getSnapshot()),
    [camera, moveStage],
  );
  const focusAfterNavigation = React.useRef<TerritoryMapTileKey>();
  const pointer = React.useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
  }>();
  const touches = React.useRef(new Set<number>());
  const suppressClick = React.useRef(false);
  const activation = React.useRef<{
    tileKey: TerritoryMapTileKey;
    quoteKey?: string;
  }>();
  const pointerHover = React.useRef<() => void>();
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
    pointerHover.current?.();
    pointerHover.current = undefined;
  }, []);
  React.useEffect(() => clearHover, [clearHover]);
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
    byKey,
    views,
    setCamera,
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
      if (event.ctrlKey) return;
      event.preventDefault();
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
  }, [scale, setCamera]);
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
          : id.startsWith("municipal:")
            ? "var(--territory-owner-municipal)"
            : peerColors[id.slice(5)];
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
    if (buyMode && view.connectable)
      return available("Available in Rapid connection mode.");
    if (projectPlanning && projectSites?.has(territoryMapTileKey(tile)))
      return available("Compatible site for this project.");
    if (view.ownerKey && !view.owned)
      return {
        color: color(view.ownerKey),
        reason: `Building unavailable while owned by ${view.ownerName}.`,
      };
    if (projectPlanning)
      return unavailable(
        "Unavailable for this project; choose a highlighted site.",
      );
    if (buyMode)
      return unavailable(
        view.owned
          ? "Already connected."
          : "Not available in Rapid connection mode; connect an adjacent site first.",
      );
    if (tile.city) return unavailable("Cities have no building slot.");
    if (view.reserved)
      return unavailable(
        view.facility
          ? "This tile already has a facility or construction project."
          : "This named site has already been used.",
      );
    if (
      !Object.values(FACILITY_FUELS).some(
        (fuel) => fuel && tileSupportsFacilityTechnology(tile, { fuel }),
      )
    )
      return unavailable("No construction technology supports this site.");
    if (!view.owned && !view.connectable)
      return unavailable("Connect an adjacent site before building here.");
    return available(
      view.owned
        ? "Vacant building site; choose a compatible technology."
        : "Connect this vacant site before building; choose a compatible technology.",
    );
  };
  const { ownerBoundaries, allWires } = React.useMemo(() => {
    const index = new Map(
      topology.map((view) => [territoryMapTileKey(view.tile), view]),
    );
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
          (tile) => index.get(territoryMapTileKey(tile))?.ownerKey === owner,
        ),
      })),
      allWires: hexWires(
        tiles.map((tile) => ({
          q: tile.q,
          r: tile.r,
          id: territoryMapTileKey(tile),
        })),
        (tile) => !!index.get(tile.id)?.developed,
        (a, b) => index.get(a.id)?.ownerKey === index.get(b.id)?.ownerKey,
        (tile) => index.get(tile.id)!.structure,
      ),
    };
  }, [tiles, topology]);
  const selectedBoundary = React.useMemo(
    () =>
      hexBoundary(
        tiles,
        (tile) => territoryMapTileKey(tile) === activeSelected,
      ),
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
  const inspectTile = (tile: TerritoryTileView["tile"]) => {
    if ((workspace?.effectiveWidth ?? size.width) <= 740) {
      const point = hexCenter(tile);
      // Leave the selected ground and occupant above the phone's inspection sheet.
      setCamera({
        x: point.x,
        y: point.y + worldHeight * (projectPlanning ? 0.3 : 0.22),
      });
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
  const activateTile = (key: TerritoryMapTileKey) => {
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
    else inspectTile(tile);
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
      return ground?.dataset.mapTarget as TerritoryMapTileKey | undefined;
    const rect = viewport.current?.getBoundingClientRect();
    return (
      (rect &&
        picker.current?.({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })) ??
      (ground?.dataset.mapTarget as TerritoryMapTileKey | undefined)
    );
  };
  const hoverTile = (event: NonNullable<typeof hoverPoint.current>) => {
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
    const titleTarget =
      event.target instanceof HTMLElement ? event.target : viewport.current;
    if (!titleTarget) return;
    const previousTitle = titleTarget.getAttribute("title");
    target.dataset.modelHovered = "true";
    titleTarget.title =
      titleTarget.closest<HTMLElement>(".territoryTilePrice")?.title ||
      target.title;
    pointerHover.current = () => {
      delete target.dataset.modelHovered;
      if (previousTitle === null) titleTarget.removeAttribute("title");
      else titleTarget.title = previousTitle;
    };
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
    >
      <MapStatusLayers value={showStatusLayer} onChange={setShowStatusLayer} />
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
      <div
        className="territoryMapViewport"
        role="region"
        aria-label="Territory map"
        data-camera-scale={scale}
        ref={viewport}
        onPointerDown={(event) => {
          const middle = event.button === 1;
          if (event.button !== 0 && !middle) return;
          clearHover();
          if (middle) event.preventDefault();
          const id = middle ? undefined : pointerTile(event);
          rememberActivation(id);
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
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onPointerMove={(event) => {
          const drag = pointer.current;
          if (
            !drag ||
            drag.id !== event.pointerId ||
            touches.current.size !== 1
          ) {
            if (
              threeDReady &&
              event.pointerType !== "touch" &&
              !touches.current.size
            ) {
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
          touches.current.delete(event.pointerId);
          if (pointer.current?.id === event.pointerId)
            pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          clearHover();
          touches.current.delete(event.pointerId);
          pointer.current = undefined;
          activation.current = undefined;
          suppressClick.current = true;
        }}
        onPointerLeave={(event) => {
          clearHover();
          const drag = pointer.current;
          if (
            event.pointerType === "mouse" &&
            drag?.id === event.pointerId &&
            !drag.dragging
          ) {
            touches.current.delete(event.pointerId);
            pointer.current = undefined;
            activation.current = undefined;
            suppressClick.current = true;
          }
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
          if (activation.current && activation.current.tileKey !== id) {
            activation.current = undefined;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
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
                speed={game.speed}
                runKey={`${runId}:${game.seed}:${game.scenarioId}`}
                daylight={getSunriseSunset(game.date, game.location)}
                dark={dark}
                camera={camera}
                frame={{
                  width: size.width,
                  height: size.height,
                  dpr: window.devicePixelRatio || 1,
                  scale,
                  background: dark ? [0.035, 0.055, 0.07] : [0.86, 0.9, 0.9],
                  visible: size.width > 0 && size.height > 0,
                  motionAllowed: motion.allowed,
                  playbackRate: motion.rate,
                  weather,
                }}
                onState={setRendererState}
                onPicker={setPicker}
              />
            </React.Suspense>
          </MapSceneBoundary>
        )}
        <WeatherAtmosphere
          weather={weather}
          moving={motion.allowed && game.speed !== "PAUSED"}
          dark={dark}
        />
        <div className="territoryMapStage" ref={stage}>
          <svg
            className="territoryHexGrid"
            viewBox={`0 0 ${Math.max(1, worldWidth)} ${Math.max(1, worldHeight)}`}
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
                  const key = territoryMapTileKey(tile);
                  return (
                    <g
                      key={key}
                      className="territoryHex territoryFog"
                      data-visibility-distance={visibilityDistance}
                      data-terrain={tile.terrain}
                      data-tile={key}
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
                        byKey.get(wire.from)!.visibilityDistance,
                        byKey.get(wire.to)!.visibilityDistance,
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
                    key = territoryMapTileKey(tile),
                    origin = foregroundOrigin(tile),
                    status = facilityMapStatus(view, game.date.minute);
                  const showStatus =
                    showStatusLayer && status && status.kind !== "unknown";
                  const operation = view.operatingFacility
                    ? facilityOperatingStatus(
                        view.operatingFacility,
                        game.date.minute,
                      )
                    : status;
                  if (
                    !facility &&
                    !tile.city &&
                    (!view.developed || wireStructure(view) === "submerged")
                  )
                    return null;
                  return (
                    <svg
                      key={key}
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
                      data-occupant-tile={key}
                      x={origin.x}
                      y={origin.y}
                      width={HEX_WIDTH}
                      height={HEX_WIDTH}
                      viewBox="0 0 500 500"
                      overflow="visible"
                    >
                      {threeDReady ? (
                        showStatus ? (
                          <FacilityMapStatusArtwork kind={status.kind} />
                        ) : null
                      ) : tile.city ? (
                        <CityArtwork
                          size={tile.city.size}
                          className="territoryOccupantArtwork"
                        />
                      ) : facility ? (
                        <>
                          <g className="territoryFacilityBody">
                            <FacilityMapMotionContext.Provider value={motion}>
                              <FacilityArtwork
                                facility={facility}
                                className="territoryOccupantArtwork"
                                active={
                                  operation?.kind === "producing" ||
                                  operation?.kind === "charging"
                                }
                              />
                            </FacilityMapMotionContext.Provider>
                          </g>
                          {showStatus && (
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
              key = territoryMapTileKey(tile),
              point = hexCenter(tile);
            const status = facilityMapStatus(view, game.date.minute);
            const utility = !!tile.city && !!view.ownerKey;
            const cityLabel =
              tile.city?.name ?? (tile.city && citySizeLabel(tile.city.size));
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
            const priceLabel = quote
              ? `${money(quote.price)} · ${tilePurchaseBenefitLabel(quote)}`
              : "";
            return (
              <button
                key={key}
                type="button"
                data-map-target={key}
                data-territory={tile.territoryId}
                data-owner={view.ownerKey}
                data-owned={view.owned}
                data-terrain={tile.terrain}
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
                aria-busy={pending || undefined}
                className={`territoryTileTarget${utility || (cityLabel && showStatusLayer) ? " territoryUtilityLabel" : ""}`}
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
                  projectPlanning
                    ? `Inspect ${territoryTileLabel(tile)}${projectSite ? ` · Total project cost ${projectPrice} · ${projectSite.owned ? "Already connected" : "Connection included"}` : " · unavailable for this project"}`
                    : quote
                      ? `${unaffordable ? "Inspect" : quote.utilityName ? "Acquire" : "Connect"} ${quote.utilityName ?? territoryTileLabel(tile)} · ${priceLabel}${unaffordable ? "; not enough available cash" : ""}`
                      : label
                }
                aria-pressed={key === activeSelected}
                aria-describedby={`${mapId}-${key}-status`}
                onFocus={() => {
                  setRovingId(key);
                  if (key !== selected) onSelect(key);
                  if (!pointer.current && !touches.current.size)
                    revealTile(tile);
                }}
                onClick={() => {
                  activateTile(key);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" || event.key === " ") &&
                    !event.repeat
                  )
                    rememberActivation(key);
                  navigate(event, key);
                }}
                title={`${TERRAIN_LABELS[tile.terrain]} · ${facility?.name ?? cityLabel ?? (view.developed ? (wireStructure(view) === "submerged" ? "Open water · submerged cable" : "Open site · transmission tower") : "Undeveloped site")}${status ? ` · ${status.label}` : ""} · ${hover.reason}`}
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
                {(utility || (cityLabel && showStatusLayer)) && (
                  <strong>
                    {cityLabel && showStatusLayer && <span>{cityLabel}</span>}
                    {utility && (
                      <span>{view.owned ? "You" : view.ownerName}</span>
                    )}
                  </strong>
                )}
                {projectSite && (
                  <span
                    className="territoryTilePrice"
                    aria-hidden="true"
                    title={`Total project cost ${projectPrice} · ${projectSite.owned ? "Already connected" : "Connection included"}`}
                  >
                    <b>{projectPrice}</b>
                  </span>
                )}
                {quote && !projectPlanning && (
                  <span className="territoryTilePrice" aria-hidden="true">
                    <b>{pending ? "Connecting…" : money(quote.price)}</b>
                    {quote.benefit !== "general" && (
                      <span>{tilePurchaseBenefitLabel(quote)}</span>
                    )}
                  </span>
                )}
                <span className="srOnly" id={`${mapId}-${key}-status`}>
                  {view.owned
                    ? "Your tile"
                    : view.ownerKey
                      ? `Owned by ${view.ownerName}`
                      : view.connectable
                        ? "Connection available"
                        : "Unconnected tile"}
                  . {terrainDetailsLabel(tile.terrain)}.{" "}
                  {facility
                    ? `${facility.name}${status ? ` · ${status.label}` : ""}`
                    : tile.city
                      ? `${cityLabel}; no building slot`
                      : view.developed
                        ? wireStructure(view) === "submerged"
                          ? "One building site; submerged cable"
                          : "One building site; transmission tower"
                        : "One building site"}
                  . {hover.reason}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
