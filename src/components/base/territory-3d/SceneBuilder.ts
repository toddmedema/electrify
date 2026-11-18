import type {
  FacilityOperatingType,
  FuelNameType,
  TerrainType,
  TerritoryTileId,
} from "../../../Types";
import { isStorage } from "../../../Types";
import type { TerritoryTileDefinition } from "../../../data/TerritoryTiles";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import {
  facilityMapStatus,
  facilityOperatingStatus,
} from "../FacilityMapStatus";
import { HEX_NEIGHBORS, riverPorts } from "../TerritoryHexGeometry";
import type { HexWire } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE } from "./Palette";
import { CAMERA_COS, CAMERA_SIN, tilePosition3D } from "./Projection";
import { rotorAngle } from "./RotorPose";
import { HEX_WIDTH } from "../TerritoryHexGeometry";
import type {
  MapInstance,
  MapModel,
  ModelPart,
  MapFrame,
  MapWireConnection,
  StructureKind,
  TerrainModelOptions,
  Vec3,
} from "./Types";

import { WATERSHED_LEVEL_OFFSETS, waterLevelOffset } from "./WaterSurface";

export type ScenePicker = (point: {
  x: number;
  y: number;
}) => TerritoryTileId | undefined;
type PickFrame = Pick<
  MapFrame,
  "width" | "height" | "cameraX" | "cameraY" | "scale" | "weather"
>;
interface TileScene {
  tile: TerritoryTileDefinition;
  kind?: StructureKind;
  terrain: MapInstance;
  model?: MapModel;
  structure?: MapInstance;
}

function waterRange(part: ModelPart) {
  return part.material === "watershed-water"
    ? WATERSHED_LEVEL_OFFSETS
    : part.waterLevelRange;
}

function fillFraction(
  stored: number | undefined,
  capacity: number | undefined,
) {
  if (
    stored === undefined ||
    !Number.isFinite(stored) ||
    capacity === undefined ||
    !Number.isFinite(capacity) ||
    capacity <= 0
  )
    return undefined;
  return Math.max(0, Math.min(1, stored / capacity));
}

function reservoirFill(facility?: FacilityOperatingType) {
  if (!facility) return undefined;
  if (isStorage(facility))
    return facility.name === "Pumped Hydro"
      ? fillFraction(facility.currentWh, facility.peakWh)
      : undefined;
  return facility.fuel === "Hydro"
    ? fillFraction(facility.reservoirWh, facility.reservoirCapacityWh)
    : undefined;
}

const pickBounds = new WeakMap<MapModel, readonly number[]>();
function bounds(model: MapModel): readonly number[] {
  const cached = pickBounds.get(model);
  if (cached) return cached;
  const value = [Infinity, -Infinity, Infinity, -Infinity];
  for (const part of model.parts) {
    if (part.motion === "steam") continue;
    const vertices = part.mesh.positions,
      offset = part.position ?? [0, 0, 0],
      [empty, full] = waterRange(part) ?? [0, 0];
    for (let i = 0; i < vertices.length; i += 3) {
      const radius =
        part.motion === "rotor" || part.motion === "sway"
          ? Math.hypot(vertices[i], vertices[i + 1])
          : undefined;
      const x0 = offset[0] + (radius === undefined ? vertices[i] : -radius),
        x1 = offset[0] + (radius === undefined ? vertices[i] : radius),
        y0 =
          offset[1] +
          (radius === undefined ? vertices[i + 1] : -radius) -
          (part.motion === "flow" ? 0.018 : 0) +
          Math.min(empty, full),
        y1 =
          offset[1] +
          (radius === undefined ? vertices[i + 1] : radius) +
          (part.motion === "flow" ? 0.018 : 0) +
          Math.max(empty, full),
        z = offset[2] + vertices[i + 2];
      value[0] = Math.min(value[0], x0);
      value[1] = Math.max(value[1], x1);
      value[2] = Math.min(value[2], z * CAMERA_SIN - y1 * CAMERA_COS);
      value[3] = Math.max(value[3], z * CAMERA_SIN - y0 * CAMERA_COS);
    }
  }
  pickBounds.set(model, value);
  return value;
}

export interface ModelFactories {
  terrain: (terrain: TerrainType, options?: TerrainModelOptions) => MapModel;
  structure: (kind: StructureKind) => MapModel;
}
const fuelModels: Record<FuelNameType, StructureKind> = {
  Coal: "coal",
  Biomass: "biomass",
  Wind: "wind",
  "Offshore Wind": "offshore-wind",
  "Airborne Wind": "airborne-wind",
  Sun: "solar",
  "Natural Gas": "gas",
  Uranium: "nuclear",
  Oil: "oil",
  Geothermal: "geothermal",
  Hydro: "hydro",
};
export function structureKind(
  view: TerritoryTileView,
): StructureKind | undefined {
  if (view.tile.city) return `city-${view.tile.city.size}`;
  const facility = view.facility;
  if (facility?.peakWh !== undefined)
    return facility.name === "Pumped Hydro"
      ? "pumped-hydro"
      : facility.name === "Iron-Air Battery"
        ? "iron-air"
        : "battery";
  if (facility?.fuel) return fuelModels[facility.fuel];
  if (!view.developed || ["river", "lake", "ocean"].includes(view.tile.terrain))
    return undefined;
  return "tower";
}
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function terminal(
  model: MapModel | undefined,
  position: Vec3,
  toward: Vec3,
): Vec3 {
  const options = model?.terminals.length
    ? model.terminals
    : [[0, 0.006, 0] as Vec3];
  const direction: Vec3 = [toward[0] - position[0], 0, toward[2] - position[2]];
  const selected = options.reduce((best, point) =>
    point[0] * direction[0] + point[2] * direction[2] >
    best[0] * direction[0] + best[2] * direction[2]
      ? point
      : best,
  );
  return add(position, selected);
}
const constructionModels = new WeakMap<MapModel, MapModel>();
function underConstruction(model: MapModel): MapModel {
  const cached = constructionModels.get(model);
  if (cached) return cached;
  const value: MapModel = {
    ...model,
    key: `${model.key}:construction`,
    parts: model.parts.map((part) => {
      const colors = new Float32Array(part.mesh.colors.length);
      for (let i = 0; i < colors.length; i += 3) {
        const grey =
          (part.mesh.colors[i] +
            part.mesh.colors[i + 1] +
            part.mesh.colors[i + 2]) /
          3;
        for (let c = 0; c < 3; c++)
          colors[i + c] = grey * 0.45 + PALETTE.steel[c] * 0.55;
      }
      return { ...part, mesh: { ...part.mesh, colors } };
    }),
  };
  constructionModels.set(model, value);
  return value;
}

/** Static wire geometry changes with topology/terminals, never with every power tick. */
export class SceneBuilder {
  private wireKey?: string;
  private wireModels: MapInstance[] = [];
  private tiles?: readonly TerritoryTileDefinition[];
  private terrainAt = new Map<string, TerrainType>();
  private cells = new Map<string, TileScene>();
  private instances: MapInstance[] = [];
  constructor(private factories: ModelFactories) {}

  build(
    views: readonly TerritoryTileView[],
    allTiles: readonly TerritoryTileDefinition[],
    wires: readonly HexWire[],
    minute: number,
    runKey: string,
  ): MapInstance[] {
    if (allTiles !== this.tiles) {
      this.tiles = allTiles;
      this.terrainAt = new Map(
        allTiles.map(({ q, r, terrain }) => [`${q},${r}`, terrain]),
      );
      this.cells.clear();
      this.wireKey = undefined;
    }
    const models = new Map<string, MapModel>();
    const positions = new Map<string, Vec3>();
    const byId = new Map<string, TerritoryTileView>(
      views.map((view) => [view.tile.id, view]),
    );
    const instances: MapInstance[] = [];
    for (const view of views) {
      const { tile } = view,
        kind = structureKind(view);
      let cell = this.cells.get(tile.id);
      if (
        !cell ||
        cell.tile !== tile ||
        cell.kind !== kind ||
        cell.terrain.fog !== view.visibilityDistance
      ) {
        const model = kind ? this.factories.structure(kind) : undefined;
        const position = tilePosition3D(tile);
        const terrain = this.factories.terrain(tile.terrain, {
          footprint: model?.footprint ?? 0,
          ports:
            tile.terrain === "river" ? riverPorts(tile, allTiles) : undefined,
          ...(tile.terrain === "mountain" || tile.terrain === "forest"
            ? {
                adjacentEdges: HEX_NEIGHBORS.reduce(
                  (edges, [dq, dr], edge) =>
                    this.terrainAt.get(`${tile.q + dq},${tile.r + dr}`) ===
                    tile.terrain
                      ? edges | (1 << edge)
                      : edges,
                  0,
                ),
              }
            : {}),
        });
        cell = {
          tile,
          kind,
          model,
          terrain: {
            id: `terrain:${tile.id}`,
            position,
            fog: view.visibilityDistance,
            active: false,
            model: terrain,
          },
          structure: model
            ? {
                id: `structure:${tile.id}`,
                position: [position[0], terrain.supportY ?? 0, position[2]],
                fog: view.visibilityDistance,
                active: false,
                model,
              }
            : undefined,
        };
        this.cells.set(tile.id, cell);
      }
      const position = cell.structure?.position ?? cell.terrain.position;
      const model = cell.model;
      if (model) models.set(tile.id, model);
      positions.set(tile.id, position);
      instances.push(cell.terrain);
      if (!model) continue;
      // Map construction badges may describe added capacity while the base keeps running.
      const status =
        view.facility && !tile.city && view.operatingFacility
          ? facilityOperatingStatus(view.operatingFacility, minute)
          : facilityMapStatus(view, minute);
      const displayedModel =
          status?.kind === "construction" ? underConstruction(model) : model,
        producing = status?.kind === "producing",
        active = producing || status?.kind === "charging",
        motionKey = view.operatingFacility
          ? `${runKey}:facility:${view.operatingFacility.id}`
          : undefined;
      const waterLevel = tile.city
        ? undefined
        : reservoirFill(view.operatingFacility);
      if (
        cell.structure?.model !== displayedModel ||
        cell.structure.active !== active ||
        cell.structure.producing !== producing ||
        cell.structure.motionKey !== motionKey ||
        cell.structure.waterLevel !== waterLevel
      )
        cell.structure = {
          id: `structure:${tile.id}`,
          position,
          fog: view.visibilityDistance,
          model: displayedModel,
          active,
          producing,
          motionKey,
          waterLevel,
        };
      instances.push(cell.structure);
    }
    for (const id of this.cells.keys())
      if (!byId.has(id)) this.cells.delete(id);
    const key = wires
      .map(
        (wire) =>
          `${wire.id}:${wire.kind}:${models.get(wire.from)?.key}:${models.get(wire.to)?.key}:${byId.get(wire.from)?.visibilityDistance}:${byId.get(wire.to)?.visibilityDistance}`,
      )
      .join("|");
    if (key !== this.wireKey) {
      this.wireKey = key;
      const groups = [
        new MeshBuilder(),
        new MeshBuilder(),
        new MeshBuilder(),
        new MeshBuilder(),
      ];
      const connections: MapWireConnection[][] = [[], [], [], []];
      for (const wire of wires) {
        const from = positions.get(wire.from),
          to = positions.get(wire.to);
        if (!from || !to) continue;
        const a = terminal(models.get(wire.from), from, to),
          b = terminal(models.get(wire.to), to, from);
        const fog = Math.max(
          byId.get(wire.from)!.visibilityDistance,
          byId.get(wire.to)!.visibilityDistance,
        );
        const builder = groups[fog],
          submerged = wire.kind === "submerged";
        const sag = Math.min(
          0.12,
          Math.max(0.003, Math.min(a[1], b[1]) * 0.35),
        );
        const point = (t: number): Vec3 => [
          a[0] + (b[0] - a[0]) * t,
          submerged
            ? t < 0.15
              ? a[1] + ((0.006 - a[1]) * t) / 0.15
              : t > 0.85
                ? 0.006 + ((b[1] - 0.006) * (t - 0.85)) / 0.15
                : 0.006
            : a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
          a[2] + (b[2] - a[2]) * t,
        ];
        let lowY = Infinity;
        for (let i = 0; i < 12; i++) {
          if (submerged && i % 2) continue;
          const start = point(i / 12),
            end = point((i + 1) / 12);
          lowY = Math.min(lowY, start[1], end[1]);
          builder.beam(start, end, submerged ? 0.004 : 0.006, PALETTE.steel, 3);
          if (!submerged) builder.beam(start, end, 0.003, PALETTE.ink, 3);
        }
        connections[fog].push({
          from: wire.from,
          to: wire.to,
          kind: wire.kind,
          start: a,
          end: b,
          lowY,
        });
      }
      this.wireModels = groups.flatMap((builder, fog) => {
        const mesh = builder.build();
        if (!mesh.positions.length) return [];
        let minX = Infinity,
          maxX = -Infinity,
          minZ = Infinity,
          maxZ = -Infinity,
          height = 0;
        for (let i = 0; i < mesh.positions.length; i += 3) {
          minX = Math.min(minX, mesh.positions[i]);
          maxX = Math.max(maxX, mesh.positions[i]);
          height = Math.max(height, mesh.positions[i + 1]);
          minZ = Math.min(minZ, mesh.positions[i + 2]);
          maxZ = Math.max(maxZ, mesh.positions[i + 2]);
        }
        // The renderer culls by instance origin and model extent, including frontier wire groups.
        const position: Vec3 = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
        for (let i = 0; i < mesh.positions.length; i += 3) {
          mesh.positions[i] -= position[0];
          mesh.positions[i + 2] -= position[2];
        }
        return [
          {
            id: `wires:${fog}`,
            model: {
              key: `wires:${fog}`,
              parts: [{ mesh }],
              terminals: [],
              footprint: Math.max(maxX - minX, maxZ - minZ),
              height,
              connections: connections[fog],
            },
            position,
            fog: fog as 0 | 1 | 2 | 3,
            active: false,
          },
        ];
      });
    }
    instances.push(...this.wireModels);
    if (
      instances.length !== this.instances.length ||
      instances.some((instance, index) => instance !== this.instances[index])
    )
      this.instances = instances;
    return this.instances;
  }

  /** Pick the nearest solid terrain or structure triangle; silhouette gaps retain the ground tile. */
  pick(
    point: { x: number; y: number },
    frame: PickFrame,
    motionPhase?: (key: string) => number,
  ): TerritoryTileId | undefined {
    if (frame.scale <= 0) return undefined;
    const x =
        ((point.x - frame.width / 2) / frame.scale + frame.cameraX) / HEX_WIDTH,
      y =
        ((point.y - frame.height / 2) / frame.scale + frame.cameraY) /
        HEX_WIDTH;
    let depth = -Infinity,
      tileId: TerritoryTileId | undefined;
    for (const instance of this.instances) {
      if (instance.id.startsWith("wires:")) continue;
      const px = x - instance.position[0],
        py =
          y -
          instance.position[2] * CAMERA_SIN +
          instance.position[1] * CAMERA_COS,
        box = bounds(instance.model);
      if (px < box[0] || px > box[1] || py < box[2] || py > box[3]) continue;
      for (const part of instance.model.parts) {
        if (
          part.motion === "steam" ||
          (part.hideWhenInactive && !instance.active)
        )
          continue;
        const phase = part.motion
            ? (motionPhase?.(instance.motionKey ?? instance.id) ?? 0) +
              (part.phaseOffset ?? 0) * Math.PI * 2
            : 0,
          angle =
            part.motion === "rotor"
              ? rotorAngle(phase)
              : part.motion === "sway"
                ? Math.sin(phase) * 0.045
                : 0,
          range = waterRange(part),
          rise =
            (part.motion === "flow" ? Math.sin(phase) * 0.018 : 0) +
            (range
              ? waterLevelOffset(
                  range,
                  part.material === "watershed-water"
                    ? frame.weather?.waterLevel
                    : instance.waterLevel,
                )
              : 0),
          c = Math.cos(angle),
          s = Math.sin(angle),
          offset = part.position ?? [0, 0, 0],
          positions = part.mesh.positions;
        const vertex = (i: number) => {
          const vx = positions[i] * c - positions[i + 1] * s + offset[0],
            vy = positions[i] * s + positions[i + 1] * c + offset[1] + rise,
            vz = positions[i + 2] + offset[2];
          return [
            vx,
            vz * CAMERA_SIN - vy * CAMERA_COS,
            vy * CAMERA_SIN + vz * CAMERA_COS,
          ];
        };
        for (let i = 0; i < positions.length; i += 9) {
          const a = vertex(i),
            b = vertex(i + 3),
            d = vertex(i + 6),
            denominator =
              (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1]);
          if (Math.abs(denominator) < 1e-12) continue;
          const u =
              ((b[1] - d[1]) * (px - d[0]) + (d[0] - b[0]) * (py - d[1])) /
              denominator,
            v =
              ((d[1] - a[1]) * (px - d[0]) + (a[0] - d[0]) * (py - d[1])) /
              denominator,
            w = 1 - u - v;
          if (u < -1e-7 || v < -1e-7 || w < -1e-7) continue;
          const hitDepth =
            u * a[2] +
            v * b[2] +
            w * d[2] +
            instance.position[1] * CAMERA_SIN +
            instance.position[2] * CAMERA_COS;
          if (hitDepth > depth) {
            depth = hitDepth;
            tileId = instance.id.startsWith("structure:")
              ? (instance.id.slice(10) as TerritoryTileId)
              : (instance.id.slice(8) as TerritoryTileId);
          }
        }
      }
    }
    return tileId;
  }
}
