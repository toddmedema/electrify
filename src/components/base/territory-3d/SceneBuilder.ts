import type {
  FacilityOperatingType,
  FuelNameType,
  TerrainType,
  TerritoryId,
} from "../../../Types";
import { isStorage } from "../../../Types";
import type { CityGrowthSector } from "../../../helpers/CityDemand";
import { farmLayout, terrainArtHash } from "./TerrainVariants";
import type { TerritoryTileDefinition } from "../../../data/TerritoryTiles";
import {
  territoryMapTileKey,
  type TerritoryTileView,
} from "../../../helpers/TerritoryMapState";
import { combustibleTile } from "../../../helpers/TerritoryWildfire";
import {
  facilityMapStatus,
  facilityOperatingStatus,
} from "../FacilityMapStatus";
import { HEX_NEIGHBORS, riverPorts } from "../TerritoryHexGeometry";
import type { HexWire } from "../TerritoryHexGeometry";
import { hailModel } from "./Hailstones";
import { getTowerConstructionModel } from "./StructureModels";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE } from "./Palette";
import { tilePosition3D } from "./Projection";
import type {
  FacilitySize,
  MapInstance,
  MapModel,
  MapWireConnection,
  StructureKind,
  TerrainModelOptions,
  Vec3,
} from "./Types";

interface TileScene {
  weather?: TerrainModelOptions["weather"];
  tile: TerritoryTileDefinition;
  kind?: StructureKind;
  size?: FacilitySize;
  growth?: readonly CityGrowthSector[];
  terrain: MapInstance;
  model?: MapModel;
  structure?: MapInstance;
  hail?: MapInstance;
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

export interface ModelFactories {
  terrain: (terrain: TerrainType, options?: TerrainModelOptions) => MapModel;
  structure: (
    kind: StructureKind,
    growth?: readonly CityGrowthSector[],
    size?: FacilitySize,
  ) => MapModel;
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
function facilitySize(peakW: number): FacilitySize {
  if (peakW < 100e6) return "small";
  if (peakW < 500e6) return "medium";
  return "large";
}

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
  if (facility?.fuel === "Natural Gas" && facility.name === "Natural Gas Steam")
    return "gas-steam";
  if (facility?.fuel === "Sun" && view.disaster?.hail)
    return "solar-hail-damaged";
  if (facility?.fuel) return fuelModels[facility.fuel];
  if (
    (!view.developed && !view.connection) ||
    ["river", "lake", "ocean"].includes(view.tile.terrain)
  )
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
  private farms = new Map<string, number>();
  private cells = new Map<string, TileScene>();
  private instances: MapInstance[] = [];
  constructor(private factories: ModelFactories) {}

  build(
    views: readonly TerritoryTileView[],
    allTiles: readonly TerritoryTileDefinition[],
    wires: readonly HexWire[],
    minute: number,
    runKey: string,
    cityGrowth?: ReadonlyMap<TerritoryId, readonly CityGrowthSector[]>,
  ): MapInstance[] {
    if (allTiles !== this.tiles) {
      this.tiles = allTiles;
      this.terrainAt = new Map(
        allTiles.map(({ q, r, terrain }) => [`${q},${r}`, terrain]),
      );
      this.farms.clear();
      this.cells.clear();
      this.wireKey = undefined;
    }
    const models = new Map<string, MapModel>();
    const positions = new Map<string, Vec3>();
    const byId = new Map<string, TerritoryTileView>(
      views.map((view) => [territoryMapTileKey(view.tile), view]),
    );
    const instances: MapInstance[] = [];
    for (const view of views) {
      const { tile } = view,
        tileKey = territoryMapTileKey(tile),
        kind = structureKind(view),
        size =
          kind && kind !== "tower" && !tile.city && view.facility
            ? facilitySize(view.facility.peakW)
            : undefined,
        growth = tile.city ? cityGrowth?.get(tile.territoryId) : undefined,
        burning = view.disaster?.ground === "burning" && combustibleTile(tile),
        weather =
          view.disaster?.ground === "burning"
            ? "scorched"
            : view.disaster?.ground;
      const frost = view.disaster?.frost !== undefined;
      let cell = this.cells.get(tileKey);
      if (
        !cell ||
        cell.tile !== tile ||
        cell.kind !== kind ||
        cell.size !== size ||
        cell.growth !== growth ||
        cell.weather !== weather ||
        !!cell.terrain.wildfire !== burning ||
        cell.terrain.fog !== view.visibilityDistance
      ) {
        const model = kind
          ? this.factories.structure(kind, growth, size)
          : undefined;
        const position = tilePosition3D(tile);
        const terrain = this.factories.terrain(tile.terrain, {
          footprint: model?.footprint ?? 0,
          weather,
          variant:
            tile.terrain === "plains"
              ? farmLayout(tile.q, tile.r, this.farms)
              : tile.terrain === "mountain"
                ? terrainArtHash(tile.q, tile.r) >>> 30
                : undefined,
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
          weather,
          kind,
          size,
          growth,
          model,
          terrain: {
            id: `terrain:${tileKey}`,
            position,
            fog: view.visibilityDistance,
            active: false,
            frost,
            model: terrain,
            ...(burning && {
              wildfire: {
                q: tile.q,
                r: tile.r,
                clearance: (model?.footprint ?? 0) / 2,
                forest: tile.terrain === "forest",
              },
            }),
          },
          structure: model
            ? {
                id: `structure:${tileKey}`,
                position: [position[0], terrain.supportY ?? 0, position[2]],
                fog: view.visibilityDistance,
                active: false,
                model,
              }
            : undefined,
        };
        this.cells.set(tileKey, cell);
      }
      if (cell.terrain.frost !== frost)
        cell.terrain = { ...cell.terrain, frost };
      const position = cell.structure?.position ?? cell.terrain.position;
      const model = cell.model;
      if (model) models.set(tileKey, model);
      positions.set(tileKey, position);
      instances.push(cell.terrain);
      if (!model) continue;
      if (kind === "solar-hail-damaged" && view.disaster?.hail === "impact") {
        cell.hail ??= {
          id: `hail:${tileKey}`,
          model: hailModel(cell.terrain.model, model, tile.q, tile.r),
          position: cell.terrain.position,
          fog: view.visibilityDistance,
          active: true,
        };
        instances.push(cell.hail);
      }
      // Map construction badges may describe added capacity while the base keeps running.
      const status =
        view.facility && !tile.city && view.operatingFacility
          ? facilityOperatingStatus(view.operatingFacility, minute)
          : facilityMapStatus(view, minute);
      const connection = view.connection;
      const displayedModel =
          kind === "tower" && connection
            ? getTowerConstructionModel(
                (minute - connection.startedMinute) /
                  (connection.towerMinute - connection.startedMinute),
              )
            : status?.kind === "construction"
              ? underConstruction(model)
              : model,
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
          id: `structure:${tileKey}`,
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
        const segments = 12;
        for (let i = 0; i < segments; i++) {
          if (submerged && i % 2 && i < segments - 1) continue;
          const start = point(i / segments),
            end = point((i + 1) / segments);
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
          midY: point(0.5)[1],
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
}
