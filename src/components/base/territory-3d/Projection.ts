import { HEX_WIDTH, HEX_HEIGHT } from "../TerritoryHexGeometry";
import type { MapFrame, Vec3 } from "./Types";

/** This camera exactly preserves the existing board's projected ground and hit targets. */
export const GROUND_RADIUS = 1 / Math.sqrt(3);
/** Clockwise corners, starting at the vertex before edge 0 of HEX_NEIGHBORS. */
export const GROUND_HEX_CORNERS = [
  [0, -GROUND_RADIUS],
  [0.5, -GROUND_RADIUS / 2],
  [0.5, GROUND_RADIUS / 2],
  [0, GROUND_RADIUS],
  [-0.5, GROUND_RADIUS / 2],
  [-0.5, -GROUND_RADIUS / 2],
] as const;
export const CAMERA_SIN = ((HEX_HEIGHT / HEX_WIDTH) * Math.sqrt(3)) / 2;
export const CAMERA_COS = Math.sqrt(1 - CAMERA_SIN * CAMERA_SIN);
export const tilePosition3D = ({ q, r }: { q: number; r: number }): Vec3 => [
  q + r / 2,
  0,
  (r * Math.sqrt(3)) / 2,
];

export function projectPoint(
  point: Vec3,
  frame: Pick<MapFrame, "width" | "height" | "cameraX" | "cameraY" | "scale">,
) {
  return {
    x: frame.width / 2 + (point[0] * HEX_WIDTH - frame.cameraX) * frame.scale,
    y:
      frame.height / 2 +
      ((point[2] * CAMERA_SIN - point[1] * CAMERA_COS) * HEX_WIDTH -
        frame.cameraY) *
        frame.scale,
  };
}

export function projectionMatrix(frame: MapFrame): Float32Array {
  const x = (2 * frame.scale * HEX_WIDTH) / Math.max(1, frame.width);
  const y = (2 * frame.scale * HEX_WIDTH) / Math.max(1, frame.height);
  const depth =
    1 /
    (frame.height / (Math.max(0.01, frame.scale) * HEX_WIDTH * CAMERA_SIN) +
      16);
  return new Float32Array([
    x,
    0,
    0,
    0,
    0,
    y * CAMERA_COS,
    -depth * CAMERA_SIN,
    0,
    0,
    -y * CAMERA_SIN,
    -depth * CAMERA_COS,
    0,
    (-2 * frame.scale * frame.cameraX) / Math.max(1, frame.width),
    (2 * frame.scale * frame.cameraY) / Math.max(1, frame.height),
    (frame.cameraY / (HEX_WIDTH * CAMERA_SIN)) * CAMERA_COS * depth,
    1,
  ]);
}
