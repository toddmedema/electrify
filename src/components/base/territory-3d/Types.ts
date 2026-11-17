export type Vec3 = readonly [number, number, number];
export type RGB = readonly [number, number, number];

/** Unindexed, flat-normal triangles in tile-width units; y is physical height. */
export interface MapMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}
export type MapMotion = "rotor" | "steam" | "flow" | "pulse" | "sway";
export interface ModelPart {
  mesh: MapMesh;
  position?: Vec3;
  motion?: MapMotion;
  phaseOffset?: number;
  hideWhenInactive?: boolean;
  castsShadow?: boolean;
  receivesShadow?: boolean;
}
export interface MapModel {
  key: string;
  parts: readonly ModelPart[];
  terminals: readonly Vec3[];
  footprint: number;
  height: number;
  /** Sampled from the same terminals and segments that build a grouped conductor mesh. */
  connections?: readonly MapWireConnection[];
}
export interface MapWireConnection {
  from: string;
  to: string;
  kind: "overhead" | "submerged";
  start: Vec3;
  end: Vec3;
  lowY: number;
}
export interface TerrainModelOptions {
  /** Zero for untouched land; otherwise reserve at least this width around the center. */
  footprint?: number;
  ports?: readonly number[];
}
export type StructureKind =
  | "city-small"
  | "city-medium"
  | "city-large"
  | "residential"
  | "industrial-city"
  | "tower"
  | "solar"
  | "wind"
  | "offshore-wind"
  | "airborne-wind"
  | "gas"
  | "oil"
  | "coal"
  | "biomass"
  | "nuclear"
  | "hydro"
  | "geothermal"
  | "battery"
  | "iron-air"
  | "pumped-hydro";
export interface MapInstance {
  id: string;
  model: MapModel;
  position: Vec3;
  fog: 0 | 1 | 2 | 3;
  active: boolean;
  /** Actual facility identity: changing speed or rebuilding batches must not reset phase. */
  motionKey?: string;
}
export interface MapLighting {
  direction: Vec3;
  color: RGB;
  ambient: number;
  shadow: number;
}
export interface MapFrame {
  width: number;
  height: number;
  dpr: number;
  /** Existing projected board coordinates, before presentation scale. */
  cameraX: number;
  cameraY: number;
  scale: number;
  background: RGB;
  lighting: MapLighting;
  visible: boolean;
  motionAllowed: boolean;
  playbackRate: number;
}
export interface RendererDiagnostics {
  frames: number;
  drawCalls: number;
  triangles: number;
  meshCount: number;
  instanceCount: number;
  frameMs: number;
  /** CPU draw submission only: excludes asynchronous GPU execution and presentation. */
  cpuFrameMs: number;
  phases: Readonly<Record<string, number>>;
  light: Vec3;
  lightColor: RGB;
  state: "ready" | "lost" | "unavailable";
  playbackRate: number;
  motionAllowed: boolean;
  visible: boolean;
  /** Optional costly geometry snapshot, requested explicitly by a diagnostic consumer. */
  scene?: readonly RendererSceneInstance[];
}
export interface RendererSceneInstance {
  id: string;
  modelKey: string;
  fog: MapInstance["fog"];
  fogMix: number;
  saturation: number;
  active: boolean;
  motionKey?: string;
  triangles: number;
  /** World-space bounds of the actual submitted solid vertices at their current pose. */
  min: Vec3;
  max: Vec3;
  connections?: readonly MapWireConnection[];
}

/** Read-only diagnostics are sampled on demand, never written to the DOM each frame. */
export type MapCanvas = HTMLCanvasElement & {
  map3DDiagnostics?: (includeScene?: boolean) => RendererDiagnostics;
};
