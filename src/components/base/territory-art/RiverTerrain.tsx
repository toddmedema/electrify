import React from "react";

type RiverTerrainProps = {
  className?: string;
  ports?: readonly number[];
};

type Point = readonly [number, number];
type Cubic = readonly [Point, Point, Point, Point];

// NE, E, SE, SW, W, NW. The end cross-sections lie on the shared hex edge.
const ENTRIES: readonly {
  anchor: Point;
  control: Point;
  bendControl: Point;
  bend: Point;
  innerControl: Point;
  waterEdge: Point;
  bankEdge: Point;
}[] = [
  {
    anchor: [375, 62.5],
    control: [352, 108],
    bendControl: [438, 155],
    bend: [400, 195],
    innerControl: [370, 238],
    waterEdge: [34, 17],
    bankEdge: [46, 23],
  },
  {
    anchor: [500, 250],
    control: [450, 250],
    bendControl: [426, 315],
    bend: [375, 320],
    innerControl: [320, 325],
    waterEdge: [0, 38],
    bankEdge: [0, 52],
  },
  {
    anchor: [375, 437.5],
    control: [352, 392],
    bendControl: [432, 350],
    bend: [398, 305],
    innerControl: [365, 260],
    waterEdge: [-34, 17],
    bankEdge: [-46, 23],
  },
  {
    anchor: [125, 437.5],
    control: [148, 392],
    bendControl: [62, 345],
    bend: [100, 305],
    innerControl: [130, 262],
    waterEdge: [-34, -17],
    bankEdge: [-46, -23],
  },
  {
    anchor: [0, 250],
    control: [50, 250],
    bendControl: [74, 185],
    bend: [125, 180],
    innerControl: [180, 175],
    waterEdge: [0, -38],
    bankEdge: [0, -52],
  },
  {
    anchor: [125, 62.5],
    control: [148, 108],
    bendControl: [68, 150],
    bend: [102, 195],
    innerControl: [135, 240],
    waterEdge: [34, -17],
    bankEdge: [46, -23],
  },
];
const CENTER: Point = [250, 250];

function entryCurves(port: number, centerControl: Point): Cubic[] {
  const entry = ENTRIES[port];
  return [
    [entry.anchor, entry.control, entry.bendControl, entry.bend],
    [entry.bend, entry.innerControl, centerControl, CENTER],
  ];
}

function sampleCurves(curves: readonly Cubic[]): Point[] {
  return curves.flatMap(([a, b, c, d], index) =>
    Array.from({ length: 17 }, (_, step): Point => {
      const t = step / 16;
      const u = 1 - t;
      return [
        u * u * u * a[0] +
          3 * u * u * t * b[0] +
          3 * u * t * t * c[0] +
          t * t * t * d[0],
        u * u * u * a[1] +
          3 * u * u * t * b[1] +
          3 * u * t * t * c[1] +
          t * t * t * d[1],
      ];
    }).slice(index === 0 ? 0 : 1),
  );
}

function ribbon(
  points: readonly Point[],
  startPort: number,
  endPort: number | undefined,
  bank: boolean,
  taper: boolean,
): string {
  const sides = [1, -1].map((side) =>
    points.map(([x, y], index): Point => {
      const atStart = index === 0;
      const atEnd = index === points.length - 1;
      if (atStart || (atEnd && endPort !== undefined)) {
        const entry = ENTRIES[atStart ? startPort : endPort!];
        const edge = bank ? entry.bankEdge : entry.waterEdge;
        const direction = atStart ? side : -side;
        return [x + edge[0] * direction, y + edge[1] * direction];
      }
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const dx = after[0] - before[0];
      const dy = after[1] - before[1];
      const length = Math.hypot(dx, dy) || 1;
      const progress = index / (points.length - 1);
      const halfWidth =
        (taper ? 38 - 28 * progress * progress : 38) + (bank ? 14 : 0);
      return [
        Math.round(x + (dy / length) * halfWidth * side),
        Math.round(y - (dx / length) * halfWidth * side),
      ];
    }),
  );
  return `M${[...sides[0], ...sides[1].reverse()].map(([x, y]) => `${x} ${y}`).join("L")}Z`;
}

export default function RiverTerrain({
  className,
  ports = [0, 3],
}: RiverTerrainProps) {
  const edges = Array.from(
    new Set(
      ports.filter((port) => Number.isInteger(port) && port >= 0 && port < 6),
    ),
  ).sort((a, b) => a - b);
  const routes: { points: Point[]; start: number; end?: number }[] = [];
  if (edges.length === 2) {
    const [start, end] = edges;
    const a = ENTRIES[start].bend;
    const b = ENTRIES[end].bend;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = Math.round(((b[0] - a[0]) / length) * 65);
    const dy = Math.round(((b[1] - a[1]) / length) * 65);
    const first = entryCurves(start, [250 - dx, 250 - dy]);
    const second = entryCurves(end, [250 + dx, 250 + dy]);
    const reversed = second
      .reverse()
      .map(([a, b, c, d]): Cubic => [d, c, b, a]);
    routes.push({ points: sampleCurves([...first, ...reversed]), start, end });
  } else {
    edges.forEach((start) => {
      const bend = ENTRIES[start].bend;
      routes.push({
        points: sampleCurves(
          entryCurves(start, [
            Math.round((bend[0] + 250) / 2),
            Math.round((bend[1] + 250) / 2),
          ]),
        ),
        start,
      });
    });
  }
  const headwater = edges.length === 1;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M250 0 500 125V375L250 500 0 375V125Z" fill="#B8D9C3" />
      <path
        d="M0 200C108 145 165 176 250 192S414 211 500 165V244C397 272 328 250 243 238S84 203 0 257Z"
        fill="#587F69"
        opacity="0.16"
      />
      <path
        d="M0 372C121 324 182 366 272 384S425 397 500 349V375L250 500 0 375Z"
        fill="#587F69"
        opacity="0.16"
      />
      {routes.map(({ points, start, end }) => (
        <path
          key={`bank-${start}`}
          d={ribbon(points, start, end, true, headwater)}
          fill="#C6B493"
        />
      ))}
      {edges.length > 2 && <circle cx="250" cy="250" r="52" fill="#C6B493" />}
      {headwater && <circle cx="250" cy="250" r="24" fill="#C6B493" />}
      {routes.map(({ points, start, end }) => (
        <path
          key={`water-${start}`}
          d={ribbon(points, start, end, false, headwater)}
          fill="#7FC8CE"
        />
      ))}
      {edges.length > 2 && <circle cx="250" cy="250" r="38" fill="#7FC8CE" />}
      {headwater && <circle cx="250" cy="250" r="10" fill="#7FC8CE" />}
    </svg>
  );
}
