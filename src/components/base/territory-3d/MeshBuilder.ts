import type { MapMesh, RGB, Vec3 } from "./Types";

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const rotate = ([x, y, z]: Vec3, [rx, ry, rz]: Vec3): Vec3 => {
  const cy = Math.cos(rx),
    sy = Math.sin(rx);
  const y1 = y * cy - z * sy,
    z1 = y * sy + z * cy;
  const cx = Math.cos(ry),
    sx = Math.sin(ry);
  const x2 = x * cx + z1 * sx,
    z2 = -x * sx + z1 * cx;
  const cz = Math.cos(rz),
    sz = Math.sin(rz);
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
};

/** Shared solid primitives, built once and cached by the terrain/model factories. */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];

  triangle(a: Vec3, b: Vec3, c: Vec3, color: RGB): this {
    const normal = unit(
      cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      ),
    );
    for (const point of [a, b, c]) {
      this.positions.push(...point);
      this.normals.push(...normal);
      this.colors.push(...color);
    }
    return this;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB): this {
    return this.triangle(a, b, c, color).triangle(a, c, d, color);
  }

  box(center: Vec3, size: Vec3, color: RGB, rotation: Vec3 = [0, 0, 0]): this {
    const [x, y, z] = size.map((n) => n / 2);
    const mesh = new MeshBuilder()
      .quad([-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], color)
      .quad([-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z], color)
      .quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], color)
      .quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], color)
      .quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], color)
      .quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], color)
      .build();
    return this.merge(mesh, center, rotation);
  }

  cylinder(
    base: Vec3,
    bottomRadius: number,
    topRadius: number,
    height: number,
    color: RGB,
    sides = 6,
  ): this {
    const [x, y, z] = base;
    for (let i = 0; i < sides; i++) {
      const a = (i * Math.PI * 2) / sides,
        b = ((i + 1) * Math.PI * 2) / sides;
      const lowA: Vec3 = [
        x + Math.cos(a) * bottomRadius,
        y,
        z + Math.sin(a) * bottomRadius,
      ];
      const lowB: Vec3 = [
        x + Math.cos(b) * bottomRadius,
        y,
        z + Math.sin(b) * bottomRadius,
      ];
      const highA: Vec3 = [
        x + Math.cos(a) * topRadius,
        y + height,
        z + Math.sin(a) * topRadius,
      ];
      const highB: Vec3 = [
        x + Math.cos(b) * topRadius,
        y + height,
        z + Math.sin(b) * topRadius,
      ];
      if (bottomRadius === 0) this.triangle(lowB, highA, highB, color);
      else if (topRadius === 0) this.triangle(lowB, lowA, highA, color);
      else this.quad(lowB, lowA, highA, highB, color);
      if (bottomRadius > 0) this.triangle([x, y, z], lowA, lowB, color);
      if (topRadius > 0) this.triangle([x, y + height, z], highB, highA, color);
    }
    return this;
  }

  beam(a: Vec3, b: Vec3, radius: number, color: RGB, sides = 4): this {
    const direction = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const u = unit(
      cross(direction, Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]),
    );
    const v = cross(direction, u);
    const ring = (center: Vec3, index: number): Vec3 => {
      const angle = (index * Math.PI * 2) / sides;
      const c = radius * Math.cos(angle),
        s = radius * Math.sin(angle);
      return [
        center[0] + u[0] * c + v[0] * s,
        center[1] + u[1] * c + v[1] * s,
        center[2] + u[2] * c + v[2] * s,
      ];
    };
    for (let i = 0; i < sides; i++)
      this.quad(ring(a, i), ring(a, i + 1), ring(b, i + 1), ring(b, i), color);
    return this;
  }

  merge(
    mesh: MapMesh,
    position: Vec3 = [0, 0, 0],
    rotation: Vec3 = [0, 0, 0],
    scale: Vec3 = [1, 1, 1],
  ): this {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const point = rotate(
        [
          mesh.positions[i] * scale[0],
          mesh.positions[i + 1] * scale[1],
          mesh.positions[i + 2] * scale[2],
        ],
        rotation,
      );
      const normal = unit(
        rotate(
          [
            mesh.normals[i] / scale[0],
            mesh.normals[i + 1] / scale[1],
            mesh.normals[i + 2] / scale[2],
          ],
          rotation,
        ),
      );
      this.positions.push(
        point[0] + position[0],
        point[1] + position[1],
        point[2] + position[2],
      );
      this.normals.push(...normal);
      this.colors.push(mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2]);
    }
    return this;
  }

  build(): MapMesh {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
    };
  }
}
