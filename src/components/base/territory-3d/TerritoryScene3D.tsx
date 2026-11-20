import * as React from "react";
import { TICK_MS } from "../../../Constants";
import type { SpeedType } from "../../../Types";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import type { TerritoryTileDefinition } from "../../../data/TerritoryTiles";
import type { HexWire } from "../TerritoryHexGeometry";
import { SceneBuilder } from "./SceneBuilder";
import type { ScenePicker } from "./SceneBuilder";
import { MapRenderer } from "./Renderer";
import { getTerrainModel } from "./TerrainModels";
import { getStructureModel } from "./StructureModels";
import TerritoryCanvas3D from "./TerritoryCanvas3D";
import type {
  RendererHandle,
  RendererLoader,
  RendererState,
} from "./TerritoryCanvas3D";
import { mapLighting } from "./Lighting";
import { buildOwnershipBorder, buildSelectionBorder } from "./BorderGeometry";
import type { MapFrame } from "./Types";

const factories = { terrain: getTerrainModel, structure: getStructureModel };
const loadRenderer: RendererLoader = async () => {
  if (typeof WebGL2RenderingContext === "undefined")
    throw new Error("WebGL2 unavailable");
  return (canvas, onState) => new MapRenderer(canvas, onState);
};

export interface SceneCamera {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { x: number; y: number };
}

/** Lazy boundary keeps GPU/model code outside the initial game shell. */
export default function TerritoryScene3D({
  views,
  tiles,
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
  daylight,
  dark,
  onState,
  onPicker,
}: {
  views: readonly TerritoryTileView[];
  tiles: readonly TerritoryTileDefinition[];
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
    "lighting" | "lightingTransitionMs" | "cameraX" | "cameraY"
  >;
  camera: SceneCamera;
  daylight: {
    sunrise: number;
    sunset: number;
    daylight: "normal" | "polar-day" | "polar-night";
  };
  dark: boolean;
  onState: (state: RendererState) => void;
  onPicker: (picker: ScenePicker | undefined) => void;
}) {
  const { x: cameraX, y: cameraY } = React.useSyncExternalStore(
    camera.subscribe,
    camera.getSnapshot,
  );
  const frame = { ...viewport, cameraX, cameraY };
  const builder = React.useMemo(() => new SceneBuilder(factories), []);
  const scene = React.useMemo(
    () => builder.build(views, tiles, wires, minute, runKey),
    [builder, views, tiles, wires, minute, runKey],
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
  const renderer = React.useRef<RendererHandle>();
  const setRenderer = React.useCallback((value: RendererHandle | undefined) => {
    renderer.current = value;
  }, []);
  React.useLayoutEffect(() => {
    onPicker((point) => {
      const handle = renderer.current;
      if (!handle) return;
      const painted = handle.getPaintedScene();
      if (painted)
        return builder.pick(
          point,
          painted.frame,
          handle.motionPhase,
          painted.instances,
        );
    });
    return () => onPicker(undefined);
  }, [builder, onPicker]);
  return (
    <TerritoryCanvas3D
      instances={instances}
      frame={{ ...frame, lighting, lightingTransitionMs }}
      runKey={runKey}
      loadRenderer={loadRenderer}
      onState={onState}
      onRenderer={setRenderer}
    />
  );
}
