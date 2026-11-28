import * as React from "react";
import { TICK_MS } from "../../../Constants";
import type { SpeedType, TerritoryId } from "../../../Types";
import type { CityGrowthSector } from "../../../helpers/CityDemand";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import type { TerritoryTileDefinition } from "../../../data/TerritoryTiles";
import type { HexWire } from "../TerritoryHexGeometry";
import { SceneBuilder } from "./SceneBuilder";
import { MapRenderer } from "./Renderer";
import { getTerrainModel } from "./TerrainModels";
import { getStructureModel } from "./StructureModels";
import TerritoryCanvas3D from "./TerritoryCanvas3D";
import type { RendererLoader, RendererState } from "./TerritoryCanvas3D";
import { mapLighting } from "./Lighting";
import { buildOwnershipBorder, buildSelectionBorder } from "./BorderGeometry";
import type { MapFrame } from "./Types";

const factories = { terrain: getTerrainModel, structure: getStructureModel };
const rendererLoader =
  (inlandOnly?: true): RendererLoader =>
  async () => {
    if (typeof WebGL2RenderingContext === "undefined")
      throw new Error("WebGL2 unavailable");
    return (canvas, onState) => new MapRenderer(canvas, onState, inlandOnly);
  };
const loadStandardRenderer = rendererLoader();
const loadInlandRenderer = rendererLoader(true);

export interface SceneCamera {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { x: number; y: number; zoom: number };
}

/** Lazy boundary keeps GPU/model code outside the initial game shell. */
export default function TerritoryScene3D({
  views,
  tiles,
  authoredInland,
  cityGrowth,
  ownership,
  ownerPalette,
  peerColors,
  selectedTile,
  wires,
  minute,
  minuteOfDay,
  speed,
  runKey,
  frame: viewport,
  camera,
  baseScale,
  daylight,
  dark,
  onState,
}: {
  views: readonly TerritoryTileView[];
  tiles: readonly TerritoryTileDefinition[];
  authoredInland?: true;
  cityGrowth: ReadonlyMap<TerritoryId, readonly CityGrowthSector[]>;
  ownership: readonly Pick<TerritoryTileView, "tile" | "ownerKey">[];
  ownerPalette: Readonly<Record<string, string>>;
  peerColors: Readonly<Record<string, string>>;
  selectedTile?: TerritoryTileDefinition;
  wires: readonly HexWire[];
  minute: number;
  minuteOfDay: number;
  speed: SpeedType;
  runKey: string;
  frame: Omit<
    MapFrame,
    "lighting" | "lightingTransitionMs" | "cameraX" | "cameraY" | "scale"
  >;
  camera: SceneCamera;
  baseScale: number;
  daylight: {
    sunrise: number;
    sunset: number;
    daylight: "normal" | "polar-day" | "polar-night";
  };
  dark: boolean;
  onState: (state: RendererState) => void;
}) {
  const {
    x: cameraX,
    y: cameraY,
    zoom,
  } = React.useSyncExternalStore(camera.subscribe, camera.getSnapshot);
  const frame = { ...viewport, cameraX, cameraY, scale: baseScale * zoom };
  const builder = React.useMemo(() => new SceneBuilder(factories), []);
  // Check the whole board so an offscreen coast still gets the full shader.
  const inlandOnly = React.useMemo(
    () =>
      authoredInland === true &&
      tiles.length > 0 &&
      tiles.every((tile) => tile.terrain !== "ocean"),
    [authoredInland, tiles],
  );
  const scene = React.useMemo(
    () => builder.build(views, tiles, wires, minute, runKey, cityGrowth),
    [builder, views, tiles, wires, minute, runKey, cityGrowth],
  );
  const ownershipBorder = React.useMemo(
    () => buildOwnershipBorder(ownership, ownerPalette, peerColors, dark),
    [ownership, ownerPalette, peerColors, dark],
  );
  const selectionBorder = React.useMemo(
    () => (selectedTile ? buildSelectionBorder(selectedTile) : undefined),
    [selectedTile],
  );
  const instances = React.useMemo(
    () => [
      ...scene,
      ...(ownershipBorder ? [ownershipBorder] : []),
      ...(selectionBorder ? [selectionBorder] : []),
    ],
    [scene, ownershipBorder, selectionBorder],
  );
  const lighting = React.useMemo(
    () =>
      mapLighting({
        minute: minuteOfDay,
        ...daylight,
        dark,
        cloud: viewport.weather?.cloud,
      }),
    [minuteOfDay, daylight, dark, viewport.weather?.cloud],
  );
  const lightingTransitionMs =
    speed === "SLOW" || speed === "NORMAL" ? TICK_MS[speed] : undefined;
  return (
    <TerritoryCanvas3D
      instances={instances}
      frame={{ ...frame, lighting, lightingTransitionMs }}
      runKey={runKey}
      loadRenderer={inlandOnly ? loadInlandRenderer : loadStandardRenderer}
      onState={onState}
    />
  );
}
