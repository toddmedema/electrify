import type { FuelNameType, TerrainType } from "../../../Types";
import type { TerritoryTileDefinition } from "../../../data/TerritoryTiles";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { facilityMapStatus } from "../FacilityMapStatus";
import { riverPorts } from "../TerritoryHexGeometry";
import type { HexWire } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE } from "./Palette";
import { tilePosition3D } from "./Projection";
import type {
  MapInstance,
  MapModel,
  StructureKind,
  TerrainModelOptions,
  Vec3,
} from "./Types";

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
  if (view.tile.city)
    return view.tile.city.sector === "industrial"
      ? "industrial-city"
      : "residential";
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
  private wireKey = "";
  private wireModels: MapInstance[] = [];
  constructor(private factories: ModelFactories) {}

  build(
    views: readonly TerritoryTileView[],
    allTiles: readonly TerritoryTileDefinition[],
    wires: readonly HexWire[],
    minute: number,
    runKey: string,
  ): MapInstance[] {
    const models = new Map<string, MapModel>();
    const positions = new Map<string, Vec3>();
    const byId = new Map<string, TerritoryTileView>(
      views.map((view) => [view.tile.id, view]),
    );
    const instances: MapInstance[] = [];
    for (const view of views) {
      const { tile } = view,
        position = tilePosition3D(tile),
        kind = structureKind(view);
      const model = kind ? this.factories.structure(kind) : undefined;
      if (model) models.set(tile.id, model);
      positions.set(tile.id, position);
      instances.push({
        id: `terrain:${tile.id}`,
        position,
        fog: view.visibilityDistance,
        active: false,
        model: this.factories.terrain(tile.terrain, {
          footprint: model?.footprint ?? 0,
          ports:
            tile.terrain === "river" ? riverPorts(tile, allTiles) : undefined,
        }),
      });
      if (!model) continue;
      const status = facilityMapStatus(view, minute);
      instances.push({
        id: `structure:${tile.id}`,
        position,
        fog: view.visibilityDistance,
        model:
          status?.kind === "construction" ? underConstruction(model) : model,
        active: status?.kind === "producing" || status?.kind === "charging",
        motionKey: view.operatingFacility
          ? `${runKey}:facility:${view.operatingFacility.id}`
          : undefined,
      });
    }
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
        for (let i = 0; i < 12; i++) {
          if (submerged && i % 2) continue;
          const start = point(i / 12),
            end = point((i + 1) / 12);
          builder.beam(start, end, submerged ? 0.004 : 0.006, PALETTE.steel, 3);
          if (!submerged) builder.beam(start, end, 0.003, PALETTE.ink, 3);
        }
      }
      this.wireModels = groups.flatMap((builder, fog) => {
        const mesh = builder.build();
        if (!mesh.positions.length) return [];
        return [
          {
            id: `wires:${fog}`,
            model: {
              key: `wires:${fog}`,
              parts: [{ mesh }],
              terminals: [],
              footprint: 0,
              height: 0,
            },
            position: [0, 0, 0] as Vec3,
            fog: fog as 0 | 1 | 2 | 3,
            active: false,
          },
        ];
      });
    }
    return [...instances, ...this.wireModels];
  }
}
