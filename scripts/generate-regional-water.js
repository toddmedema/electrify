#!/usr/bin/env node

// Run from the repository root with the three pinned Natural Earth GeoJSON layers.
// See docs/regional-maps.md for their source and the coordinate scale.
const fs = require("node:fs");
const path = require("node:path");

const source = process.argv[2];
if (!source) throw new Error("Supply the Natural Earth GeoJSON directory.");
const radius = 5;
const tileKm = 10;
const kmPerDegree = 111.195;
const riverThreshold = tileKm * 0.46;

function pointSets(layer, polygon) {
  const { features } = JSON.parse(
    fs.readFileSync(path.join(source, `ne_10m_${layer}.geojson`), "utf8"),
  );
  return features.flatMap(({ geometry }) => {
    if (!geometry) return [];
    const sets = geometry.type.startsWith("Multi")
      ? geometry.coordinates
      : [geometry.coordinates];
    return sets.map((coordinates) => {
      const points = polygon ? coordinates[0] : coordinates;
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of points) {
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      return { coordinates, bounds };
    });
  });
}

function inBounds([west, south, east, north], x, y, dx = 0, dy = 0) {
  return x >= west - dx && x <= east + dx && y >= south - dy && y <= north + dy;
}

function insideRing(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    const crosses = ay > y ? by <= y : by > y;
    if (crosses && x < ax + ((bx - ax) * (y - ay)) / (by - ay))
      inside = !inside;
  }
  return inside;
}

function inPolygon(polygons, x, y) {
  return polygons.some(
    ({ coordinates: [outer, ...holes], bounds }) =>
      inBounds(bounds, x, y) &&
      insideRing(outer, x, y) &&
      !holes.some((hole) => insideRing(hole, x, y)),
  );
}

function nearLine(lines, x, y, longitudeScale) {
  return lines.some(({ coordinates, bounds }) => {
    if (
      !inBounds(
        bounds,
        x,
        y,
        riverThreshold / longitudeScale,
        riverThreshold / kmPerDegree,
      )
    )
      return false;
    for (let index = 1; index < coordinates.length; index++) {
      const [ax, ay] = coordinates[index - 1];
      const [bx, by] = coordinates[index];
      const px = (x - ax) * longitudeScale;
      const py = (y - ay) * kmPerDegree;
      const dx = (bx - ax) * longitudeScale;
      const dy = (by - ay) * kmPerDegree;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared
        ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
        : 0;
      if (Math.hypot(px - t * dx, py - t * dy) <= riverThreshold) return true;
    }
    return false;
  });
}

const land = pointSets("land", true);
const lakes = pointSets("lakes", true);
const rivers = pointSets("rivers_lake_centerlines", false);
const { cities } = require("../public/data/weather/index.json");
const citySources = new Map(
  require("./cities.json").cities.map((city) => [city.id, city]),
);
const regions = {};
for (const [id, { lat, long, offshore }] of Object.entries(cities).sort()) {
  const longitudeScale = Math.max(
    1,
    kmPerDegree * Math.cos((lat * Math.PI) / 180),
  );
  let cells = "";
  for (let q = -radius; q <= radius; q++) {
    const firstR = Math.max(-radius, -radius - q);
    const lastR = Math.min(radius, radius - q);
    for (let r = firstR; r <= lastR; r++) {
      const unwrapped = long + ((q + r / 2) * tileKm) / longitudeScale;
      const x = ((((unwrapped + 180) % 360) + 360) % 360) - 180;
      const y = lat - (r * Math.sqrt(3) * tileKm) / (2 * kmPerDegree);
      cells +=
        q === 0 && r === 0
          ? "."
          : inPolygon(lakes, x, y)
            ? "l"
            : !inPolygon(land, x, y)
              ? "o"
              : nearLine(rivers, x, y, longitudeScale)
                ? "r"
                : ".";
    }
  }
  const offshorePoint = offshore && citySources.get(id)?.offshore;
  regions[id] = [lat, long, cells.replace(/\.+$/, "")];
  if (offshorePoint) regions[id].push(offshorePoint.lat, offshorePoint.long);
}
const output = "src/data/RegionalWater.json";
const contents = JSON.stringify({ radius, tileKm, regions });
require("prettier")
  .format(contents, { filepath: output })
  .then((formatted) => {
    fs.writeFileSync(output, formatted);
  });
