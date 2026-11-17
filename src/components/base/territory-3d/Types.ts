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
}
export interface TerrainModelOptions {
  /** Zero for untouched land; otherwise reserve at least this width around the center. */
  footprint?: number;
  ports?: readonly number[];
}
export type StructureKind =
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
  phases: Readonly<Record<string, number>>;
  light: Vec3;
  state: "ready" | "lost" | "unavailable";
}

/** Read-only diagnostics are sampled on demand, never written to the DOM each frame. */
export type MapCanvas = HTMLCanvasElement & {
  map3DDiagnostics?: () => RendererDiagnostics;
};
