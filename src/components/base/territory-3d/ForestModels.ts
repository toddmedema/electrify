import { MeshBuilder } from "./MeshBuilder";
import { PALETTE, rgb } from "./Palette";
import { tintTerrainMesh } from "./TerrainWeatherMaterials";
import { GROUND_RADIUS } from "./Projection";
import type {
  MapMesh,
  MapModel,
  ModelPart,
  TerrainModelOptions,
  Vec3,
} from "./Types";

const CLEAR_WIDTHS = [0, 0.55, 0.65, 0.8, 1.2] as const;
const EDGES = 6;
const EDGE_MASK = (1 << EDGES) - 1;
const EDGE_RADIUS = 0.079;
const EDGE_HEIGHT = 0.238;
const crowns = [
  [-0.398, -0.118, 0.065, 0.26],
  [0.404, 0.098, 0.07, 0.3],
  [-0.394, 0.165, 0.059, 0.27],
  [0.03, -0.481, 0.057, 0.285],
  [-0.033, 0.477, 0.059, 0.291],
  [-0.33, -0.232, 0.051, 0.215],
  [0.339, 0.265, 0.057, 0.225],
  [0.06, 0.35, 0.06, 0.26],
  [0.247, -0.294, 0.069, 0.295],
  [-0.17, -0.065, 0.076, 0.332],
  [0.06, -0.212, 0.061, 0.271],
  [0.167, 0.111, 0.069, 0.31],
  [-0.12, 0.171, 0.063, 0.257],
] as const;
const corners: readonly Vec3[] = [
  [0, 0, -GROUND_RADIUS],
  [0.5, 0, -GROUND_RADIUS / 2],
  [0.5, 0, GROUND_RADIUS / 2],
  [0, 0, GROUND_RADIUS],
  [-0.5, 0, GROUND_RADIUS / 2],
  [-0.5, 0, -GROUND_RADIUS / 2],
];

function conifer(
  builder: MeshBuilder,
  x: number,
  z: number,
  radius: number,
  height: number,
  light: boolean,
) {
  const upper = height * 0.43;
  builder
    .cylinder([x, 0, z], 0.013, 0.009, 0.085, PALETTE.timber, 4)
    .cylinder([x, 0.051, z], radius, 0, height * 0.7 - 0.051, PALETTE.forest, 5)
    .cylinder(
      [x, upper, z],
      radius * 0.81,
      0,
      height - upper,
      light ? PALETTE.forestLight : PALETTE.forest,
      5,
    );
}

function clearsPad(x: number, z: number, radius: number, halfWidth: number) {
  return (
    Math.abs(x) - radius >= halfWidth ||
    Math.abs(z) - radius >= halfWidth ||
    halfWidth === 0
  );
}

const charredWood = rgb("#4a413d");

function canopy(halfWidth: number, charred = false) {
  const builder = new MeshBuilder();
  let height = 0;
  for (const [index, [x, z, radius, top]] of crowns.entries()) {
    if (!clearsPad(x, z, radius, halfWidth)) continue;
    if (charred) {
      if (index % 3 === 1) continue;
      const snagHeight = top * 0.68;
      builder.cylinder([x, 0, z], 0.018, 0.009, snagHeight, charredWood, 4);
      builder.beam(
        [x, snagHeight * 0.61, z],
        [x + (index % 2 ? 0.039 : -0.041), snagHeight * 0.82, z + 0.018],
        0.006,
        charredWood,
      );
      height = Math.max(height, snagHeight);
    } else {
      conifer(builder, x, z, radius, top, index % 3 !== 1);
      height = Math.max(height, top);
    }
  }
  return { mesh: builder.build(), height };
}

const interiorCanopies = CLEAR_WIDTHS.map((width) => canopy(width / 2));
const burnedCanopies = CLEAR_WIDTHS.map((width) => canopy(width / 2, true));
const edgeTree = new MeshBuilder();
conifer(edgeTree, 0, 0, EDGE_RADIUS, EDGE_HEIGHT, false);
const edgeMesh = edgeTree.build();
// Every seam crown uses the same mesh. Offsetting its position lets the renderer
// batch all six edge directions across different tile and clearance variants.
const edgeCanopies: readonly (ModelPart & { position: Vec3 })[] = corners.map(
  (a, edge) => {
    const b = corners[(edge + 1) % EDGES];
    // Both neighboring trunks stay on their own tiles. Clockwise offsets stagger
    // the two crowns along the seam so they don't meet at an identical point.
    const position: Vec3 = [
      (a[0] + (b[0] - a[0]) * 0.39) * 0.932,
      0,
      (a[2] + (b[2] - a[2]) * 0.39) * 0.932,
    ];
    return {
      mesh: edgeMesh,
      position,
      castsShadow: true,
      receivesShadow: false,
    };
  },
);
const models: Partial<
  Record<"healthy" | "dry" | "parched" | "scorched", (MapModel | undefined)[]>
> = {};
let ground: MapMesh | undefined;

export function getForestModel(
  options: TerrainModelOptions | undefined,
  buildGround: () => MapMesh,
): MapModel {
  const requested = options?.footprint ?? 0;
  const maxBucket = CLEAR_WIDTHS.length - 1;
  const match = CLEAR_WIDTHS.findIndex((width, bucket) =>
    bucket === 0 ? requested <= 0 : requested <= width,
  );
  const bucket = match < 0 ? maxBucket : match;
  const edges = (options?.adjacentEdges ?? 0) & EDGE_MASK;
  const index = bucket * (1 << EDGES) + edges;
  const appearance =
    options?.weather === "burning"
      ? "scorched"
      : (options?.weather ?? "healthy");
  const variant = (models[appearance] ??= []);
  const cached = variant[index];
  if (cached) return cached;

  const burned = appearance === "scorched";
  const tint =
    appearance === "dry" || appearance === "parched" ? appearance : undefined;
  const interior = (burned ? burnedCanopies : interiorCanopies)[bucket];
  const groundMesh = (ground ??= buildGround());
  const halfWidth = CLEAR_WIDTHS[bucket] / 2;
  const border = (burned ? [] : edgeCanopies).filter(
    ({ position }, edge) =>
      !!(edges & (1 << edge)) &&
      clearsPad(position[0], position[2], EDGE_RADIUS, halfWidth),
  );
  return (variant[index] = {
    key: `terrain:forest:${bucket}:${edges}${appearance === "healthy" ? "" : `:${appearance}`}`,
    parts: [
      {
        mesh: burned ? tintTerrainMesh(groundMesh, "ash") : groundMesh,
        castsShadow: false,
        receivesShadow: true,
      },
      ...(interior.mesh.positions.length
        ? [
            {
              mesh: tint ? tintTerrainMesh(interior.mesh, tint) : interior.mesh,
              castsShadow: true,
              receivesShadow: false,
            },
          ]
        : []),
      ...border.map((part) =>
        tint ? { ...part, mesh: tintTerrainMesh(part.mesh, tint) } : part,
      ),
    ],
    terminals: [],
    footprint: 1,
    height: Math.max(interior.height, border.length ? EDGE_HEIGHT : 0),
  });
}
