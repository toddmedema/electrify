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
import type { MapFrame } from "./Types";

const factories = { terrain: getTerrainModel, structure: getStructureModel };
const loadRenderer: RendererLoader = async () => {
  if (typeof WebGL2RenderingContext === "undefined")
    throw new Error("WebGL2 unavailable");
  return (canvas, onState) => new MapRenderer(canvas, onState);
};

/** Lazy boundary keeps GPU/model code outside the initial game shell. */
export default function TerritoryScene3D({
  views,
  tiles,
  wires,
  minute,
  minuteOfDay,
  speed,
  runKey,
  frame,
  daylight,
  dark,
  onState,
  onPicker,
}: {
  views: readonly TerritoryTileView[];
  tiles: readonly TerritoryTileDefinition[];
  wires: readonly HexWire[];
  minute: number;
  minuteOfDay: number;
  speed: SpeedType;
  runKey: string;
  frame: Omit<MapFrame, "lighting" | "lightingTransitionMs">;
  daylight: {
    sunrise: number;
    sunset: number;
    daylight: "normal" | "polar-day" | "polar-night";
  };
  dark: boolean;
  onState: (state: RendererState) => void;
  onPicker: (picker: ScenePicker | undefined) => void;
}) {
  const builder = React.useMemo(() => new SceneBuilder(factories), []);
  const instances = React.useMemo(
    () => builder.build(views, tiles, wires, minute, runKey),
    [builder, views, tiles, wires, minute, runKey],
  );
  const lighting = React.useMemo(
    () => mapLighting({ minute: minuteOfDay, ...daylight, dark }),
    [minuteOfDay, daylight, dark],
  );
  const lightingTransitionMs =
    speed === "SLOW" || speed === "NORMAL" ? TICK_MS[speed] : undefined;
  const renderer = React.useRef<RendererHandle>();
  const latestFrame = React.useRef(frame);
  latestFrame.current = frame;
  const setRenderer = React.useCallback((value: RendererHandle | undefined) => {
    renderer.current = value;
  }, []);
  React.useLayoutEffect(() => {
    onPicker((point) =>
      builder.pick(
        point,
        latestFrame.current,
        renderer.current?.diagnostics().phases,
      ),
    );
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
