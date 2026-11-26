import type { CitySizeType } from "../../../Types";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE as P } from "./Palette";
import type { MapModel, ModelPart, RGB, StructureKind, Vec3 } from "./Types";

/** A closed roof prism, rather than a screen-facing roof silhouette. */
export function gable(
  mesh: MeshBuilder,
  [x, y, z]: Vec3,
  [width, rise, depth]: Vec3,
  color: RGB,
): void {
  const left = x - width / 2,
    right = x + width / 2,
    back = z - depth / 2,
    front = z + depth / 2;
  mesh
    .triangle([left, y, front], [right, y, front], [x, y + rise, front], color)
    .triangle([right, y, back], [left, y, back], [x, y + rise, back], color)
    .quad(
      [left, y, back],
      [left, y, front],
      [x, y + rise, front],
      [x, y + rise, back],
      color,
    )
    .quad(
      [x, y + rise, back],
      [x, y + rise, front],
      [right, y, front],
      [right, y, back],
      color,
    )
    .quad(
      [left, y, back],
      [right, y, back],
      [right, y, front],
      [left, y, front],
      color,
    );
}

export function base(mesh: MeshBuilder, width = 0.64, depth = 0.4): void {
  mesh.box([0, 0.018, 0], [width, 0.036, depth], P.steelShade);
}

export const switchgearDepth = 0.06;

/** Drawn cap centers are the conductor endpoints exported to the network. */
export function switchgear(
  mesh: MeshBuilder,
  z = 0.22,
  { bottom = 0.02, width = 0.24, height = 0.09 } = {},
): readonly Vec3[] {
  const top = bottom + height;
  mesh.box(
    [0, bottom + height / 2, z],
    [width, height, switchgearDepth],
    P.steel,
  );
  const terminals: Vec3[] = [];
  for (const x of [-0.085, 0.085]) {
    mesh
      .cylinder([x, top, z], 0.012, 0.012, 0.032, P.cream)
      .cylinder([x, top + 0.009, z], 0.018, 0.018, 0.008, P.steelShade)
      .cylinder([x, top + 0.032, z], 0.014, 0.014, 0.008, P.steelShade);
    terminals.push([x, top + 0.04, z]);
  }
  return terminals;
}

export function windows(
  mesh: MeshBuilder,
  x: number,
  y: number,
  z: number,
  width: number,
): ModelPart {
  const glazing = new MeshBuilder().box(
    [x, y, z],
    [width, 0.039, 0.006],
    P.steelShade,
  );
  for (let i = -1; i <= 1; i++)
    mesh.box(
      [x + (i * width) / 4, y, z + 0.004],
      [0.006, 0.039, 0.004],
      P.cream,
    );
  return {
    mesh: glazing.build(),
    material: "facility-window",
    castsShadow: false,
  };
}

/** Include the renderer's entire motion envelope in terrain clearance and culling. */
export function model(
  kind: string,
  body: MeshBuilder,
  terminals: readonly Vec3[],
  moving: ModelPart[] = [],
): MapModel {
  const parts: ModelPart[] = [
    { mesh: body.build(), castsShadow: true },
    ...moving,
  ];
  let radius = 0,
    height = 0;
  for (const part of parts) {
    const [px, py, pz] = part.position ?? [0, 0, 0];
    const positions = part.mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i],
        y = positions[i + 1],
        z = positions[i + 2];
      if (part.motion === "rotor" || part.motion === "sway") {
        // Full rotation is a conservative bound for the wing's gentle sway too.
        const reach = Math.hypot(x, y);
        radius = Math.max(radius, Math.hypot(Math.abs(px) + reach, pz + z));
        height = Math.max(height, py + reach);
      } else if (part.motion === "steam") {
        radius = Math.max(
          radius,
          Math.hypot(
            Math.abs(px) + Math.abs(x) * 1.3,
            Math.abs(pz) + Math.abs(z) * 1.3,
          ),
        );
        height = Math.max(height, py + Math.max(y * 0.65, y * 1.3) + 0.28);
      } else {
        radius = Math.max(radius, Math.hypot(px + x, pz + z));
        height = Math.max(
          height,
          py +
            y +
            (part.motion === "flow" ? 0.018 : 0) +
            (part.waterLevelRange ? Math.max(...part.waterLevelRange) : 0),
        );
      }
    }
  }
  return {
    key: `structure:${kind}`,
    parts,
    terminals,
    footprint: radius * 2 + 0.002,
    height: height + 0.002,
  };
}

export type FacilityStructureKind = Exclude<
  StructureKind,
  `city-${CitySizeType}` | "tower"
>;

export function facilityModel(
  kind: FacilityStructureKind,
  body: MeshBuilder,
  terminals: readonly Vec3[],
  details: ModelPart[] = [],
): MapModel {
  const result = model(kind, body, terminals, details);
  return {
    ...result,
    parts: result.parts.map((part) => ({
      ...part,
      material: part.material ?? "facility-surface",
    })),
  };
}
