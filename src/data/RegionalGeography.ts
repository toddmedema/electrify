import type { LocationType, TerrainType } from "../Types";
import { closestHexEdge, HEX_NEIGHBORS } from "../helpers/HexNeighbors";
import { cos } from "../helpers/Libm";
import type { DataCenterCustomerSources } from "./DataCenterCustomers";
import { territoryCoordinateHash } from "./Territories";
import waterAtlas from "./RegionalWater.json";

export interface HexCoordinate {
  q: number;
  r: number;
}

export const REGIONAL_MAP_RADIUS = waterAtlas.radius;
export const REGIONAL_MAP_TILE_KM = waterAtlas.tileKm;
export const hexRadius = ({ q, r }: HexCoordinate): number =>
  Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

export function regionalHexes(radius: number): HexCoordinate[] {
  const cells: HexCoordinate[] = [];
  for (let q = -radius; q <= radius; q++) {
    const firstR = Math.max(-radius, -radius - q);
    const lastR = Math.min(radius, radius - q);
    for (let r = firstR; r <= lastR; r++) cells.push({ q, r });
  }
  return cells;
}

type Ridge = readonly [q: number, r: number, width: number];
interface ResearchedRegion {
  city: string;
  utility: readonly (readonly [since: number, name: string])[];
  relief?: readonly Ridge[];
  treeCover?: "sparse" | "wooded";
  /** Small waterways identifiable from local maps but below the global layer's resolution. */
  river?: readonly (readonly [q: number, r: number])[];
}

/** Local source notes and historical utility attribution are in docs/regional-maps.md. */
const RESEARCHED_REGIONS: Readonly<Partial<Record<string, ResearchedRegion>>> =
  {
    SF: {
      city: "San Francisco",
      utility: [[1905, "Pacific Gas and Electric"]],
      relief: [
        [-1, 2, 2],
        [3, -4, 3],
        [4, 0, 2],
      ],
      treeCover: "wooded",
    },
    PIT: {
      city: "Pittsburgh",
      utility: [[1912, "Duquesne Light Company"]],
      relief: [
        [0, -3, 3],
        [-3, 4, 3],
        [4, -2, 3],
      ],
      treeCover: "wooded",
    },
    HNL: {
      city: "Honolulu",
      utility: [[1891, "Hawaiian Electric"]],
      relief: [
        [0, -2, 2],
        [-1, -3, 2],
        [-1, -5, 2],
      ],
      treeCover: "wooded",
    },
    SJU: {
      city: "San Juan",
      utility: [
        [2021, "LUMA Energy"],
        [1979, "Puerto Rico Electric Power Authority"],
      ],
      relief: [
        [-2, 5, 3],
        [-4, 4, 2],
        [0, 5, 2],
      ],
      treeCover: "wooded",
    },
    Manassas: {
      city: "Manassas",
      utility: [[2020, "City of Manassas Electric Department"]],
      relief: [
        [-3, 0, 2],
        [-4, 1, 2],
      ],
      treeCover: "wooded",
      river: [
        [-1, -2],
        [0, -2],
        [1, -2],
        [1, -1],
        [1, 0],
        [0, 1],
      ],
    },
    Austin: {
      city: "Austin",
      utility: [
        [2012, "Austin Energy"],
        [1893, "City of Austin electric utility"],
      ],
      relief: [
        [-4, 1, 3],
        [-3, -1, 2],
      ],
      treeCover: "sparse",
      river: [
        [-5, 1],
        [-4, 0],
        [-3, 0],
        [-2, 0],
        [-2, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [2, 2],
        [3, 2],
      ],
    },
    Madrid: {
      city: "Madrid",
      utility: [[2018, "UFD Distribución Electricidad"]],
      relief: [
        [-2, -3, 3],
        [-3, -1, 2],
      ],
      treeCover: "sparse",
      river: [
        [0, -5],
        [-1, -4],
        [-1, -3],
        [-1, -2],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    },
    Paris: {
      city: "Paris",
      utility: [
        [2016, "Enedis"],
        [2008, "ERDF"],
        [1946, "Électricité de France"],
      ],
      treeCover: "wooded",
    },
    London: {
      city: "London",
      utility: [
        [2010, "UK Power Networks"],
        [2003, "EDF Energy Networks"],
        [1999, "24seven Utility Services"],
        [1990, "London Electricity"],
        [1948, "London Electricity Board"],
      ],
    },
    LA: {
      city: "Los Angeles",
      utility: [[1937, "Los Angeles Department of Water and Power"]],
      relief: [
        [-3, 0, 3],
        [1, -4, 3],
        [3, -4, 2],
      ],
      treeCover: "sparse",
    },
    Johannesburg: {
      city: "Johannesburg",
      utility: [[2001, "City Power Johannesburg"]],
      relief: [
        [-2, 0, 2],
        [1, 0, 2],
      ],
      treeCover: "sparse",
    },
    Lusaka: {
      city: "Lusaka",
      utility: [[1970, "ZESCO"]],
      relief: [
        [-3, 4, 2],
        [-1, 4, 2],
      ],
      treeCover: "sparse",
    },
    Delhi: {
      city: "Delhi",
      utility: [[2002, "BSES and Tata Power-DDL"]],
      relief: [
        [-3, 4, 2],
        [-2, 3, 2],
        [-1, 0, 1],
      ],
      treeCover: "sparse",
    },
    BurlingtonVT: {
      city: "Burlington",
      utility: [[1905, "Burlington Electric Department"]],
      relief: [
        [-4, 1, 3],
        [4, -1, 3],
        [4, 1, 3],
      ],
      treeCover: "wooded",
    },
    Kyiv: {
      city: "Kyiv",
      utility: [
        [2018, "DTEK Kyiv Electric Networks"],
        [1930, "Kyivenergo"],
      ],
      relief: [
        [-3, 1, 2],
        [-2, 2, 2],
      ],
      treeCover: "wooded",
    },
  };

// The customer research checked undated utility references in 2026.
const CUSTOMER_RESEARCH_YEAR = 2026;
const WATER_TERRAIN = { o: "ocean", l: "lake", r: "river" } as const;
const waterEntries: Readonly<
  Partial<Record<string, readonly (string | number)[]>>
> = waterAtlas.regions;
const coreHexes = regionalHexes(REGIONAL_MAP_RADIUS);

const regionalWaterCells = new Map(
  coreHexes.map((cell) => [
    `${cell.q}:${cell.r}`,
    {
      radius: hexRadius(cell),
      ring: HEX_NEIGHBORS.map(([dq, dr]) => `${cell.q + dq}:${cell.r + dr}`),
    },
  ]),
);

function classifyInlandWater(water: Map<string, TerrainType>) {
  const unclassified = new Set(
    Array.from(water).flatMap(([id, terrain]) =>
      terrain === "ocean" ? [id] : [],
    ),
  );
  for (const root of unclassified) {
    const basin = [root];
    unclassified.delete(root);
    for (const id of basin) {
      for (const neighbor of regionalWaterCells.get(id)!.ring)
        if (unclassified.delete(neighbor)) basin.push(neighbor);
    }
    const reachesEdge = basin.some(
      (id) => regionalWaterCells.get(id)!.radius === REGIONAL_MAP_RADIUS,
    );
    // An isolated sample at the edge is weak evidence of a coast.
    if (reachesEdge && basin.length > 1) continue;
    for (const id of basin) water.set(id, "lake");
  }
}

function routeRivers(water: Map<string, TerrainType>) {
  const rivers = new Set(
    Array.from(water).flatMap(([id, terrain]) =>
      terrain === "river" && id !== "0:0" && regionalWaterCells.has(id)
        ? [id]
        : [],
    ),
  );
  const ring = (id: string) => regionalWaterCells.get(id)!.ring;
  const neighbors = (id: string) => ring(id).filter((next) => rivers.has(next));
  // Adjacent entries in each ring also border each other. Two consecutive river
  // neighbors would draw a tiny loop at the corner shared by all three tiles.
  const trianglesAt = (id: string) =>
    ring(id).filter(
      (next, edge, cells) =>
        rivers.has(next) && rivers.has(cells[(edge + 1) % cells.length]),
    ).length;
  const outlet = (id: string) =>
    ring(id).some(
      (next) => water.get(next) === "ocean" || water.get(next) === "lake",
    );

  function component(start: string) {
    const reached = new Set([start]);
    // Set iteration visits appended entries in order, giving a breadth-first walk.
    for (const id of reached)
      for (const next of neighbors(id)) reached.add(next);
    return reached;
  }

  function removeRedundant(id: string) {
    const entries = neighbors(id);
    if (outlet(id) && !entries.some(outlet)) return false;
    rivers.delete(id);
    const reached = component(entries[0]);
    if (entries.every((entry) => reached.has(entry))) return true;
    rivers.add(id);
    return false;
  }

  function moveJunction(id: string) {
    const entries = neighbors(id);
    const original = component(id);
    const triangles = trianglesAt(id);
    const needsOutlet = outlet(id) && !entries.some(outlet);
    const candidates = ring(id).filter(
      (next) =>
        next !== "0:0" &&
        regionalWaterCells.has(next) &&
        !rivers.has(next) &&
        water.get(next) !== "ocean" &&
        water.get(next) !== "lake",
    );
    rivers.delete(id);
    for (const candidate of candidates) {
      if (
        trianglesAt(candidate) >= triangles ||
        (needsOutlet && !outlet(candidate)) ||
        neighbors(candidate).some((next) => !original.has(next))
      )
        continue;
      rivers.add(candidate);
      const reached = component(candidate);
      if (entries.every((entry) => reached.has(entry))) return true;
      rivers.delete(candidate);
    }
    rivers.add(id);
    return false;
  }

  function severedLength(id: string) {
    const entries = neighbors(id);
    rivers.delete(id);
    const seen = new Set<string>();
    let longest = 0;
    for (const entry of entries) {
      if (seen.has(entry)) continue;
      const branch = component(entry);
      longest = Math.max(longest, branch.size);
      for (const next of branch) seen.add(next);
    }
    rivers.add(id);
    return seen.size - longest;
  }

  function thinRivers() {
    for (;;) {
      const crowded = [...rivers]
        .map((id) => ({ id, triangles: trianglesAt(id) }))
        .filter(({ triangles }) => triangles > 0)
        .sort(
          (a, b) =>
            b.triangles - a.triangles ||
            regionalWaterCells.get(b.id)!.radius -
              regionalWaterCells.get(a.id)!.radius,
        );
      if (crowded.length === 0) break;
      if (crowded.some(({ id }) => removeRedundant(id))) continue;
      if (crowded.some(({ id }) => moveJunction(id))) continue;

      // There may be no room for a confluence. Favor the longest connected reach
      // and leave a gap to the smaller branch.
      const cuts = crowded.map(({ id }) => ({
        id,
        mouth: outlet(id) && !neighbors(id).some(outlet),
        severed: severedLength(id),
      }));
      cuts.sort(
        (a, b) => Number(a.mouth) - Number(b.mouth) || a.severed - b.severed,
      );
      rivers.delete(cuts[0].id);
    }
  }

  const boundary = (id: string) =>
    regionalWaterCells.get(id)!.radius === REGIONAL_MAP_RADIUS;
  const dry = (id: string) =>
    id !== "0:0" &&
    regionalWaterCells.has(id) &&
    !rivers.has(id) &&
    water.get(id) !== "ocean" &&
    water.get(id) !== "lake";

  function joinNearbyReaches() {
    for (const end of rivers) {
      if (boundary(end) || outlet(end) || neighbors(end).length > 1) continue;
      const own = component(end);
      const bridge = ring(end).find(
        (next) => dry(next) && neighbors(next).some((other) => !own.has(other)),
      );
      if (bridge) rivers.add(bridge);
    }
  }

  function extendToOutlet(starts: readonly string[]) {
    const path = [...starts];
    const previous = new Map<string, string | undefined>(
      starts.map((id) => [id, undefined]),
    );
    for (const id of path) {
      if (!rivers.has(id) && (boundary(id) || outlet(id))) {
        for (
          let step: string | undefined = id;
          step && !rivers.has(step);
          step = previous.get(step)
        )
          rivers.add(step);
        return true;
      }
      // Leave room around an extension so it joins the starting reach only.
      const contacts = rivers.has(id) ? 1 : 0;
      for (const next of ring(id)) {
        if (
          previous.has(next) ||
          !dry(next) ||
          neighbors(next).length !== contacts
        )
          continue;
        previous.set(next, id);
        path.push(next);
      }
    }
    return false;
  }

  function completeReaches() {
    const visited = new Set<string>();
    for (const id of [...rivers]) {
      if (visited.has(id)) continue;
      const reach = [...component(id)];
      for (const tile of reach) visited.add(tile);
      if (reach.length === 1 && !outlet(id)) {
        // A lone sample that failed to join a reach is usually a clipped bend.
        rivers.delete(id);
        continue;
      }
      const ends = reach.filter((tile) => neighbors(tile).length <= 1);
      if (reach.some(outlet) || ends.some(boundary)) continue;
      if (extendToOutlet(ends.length ? ends : reach)) continue;
      // Where the board can't fit a route to the edge, form a receiving lake.
      const basin = ends[0] ?? id;
      rivers.delete(basin);
      water.set(basin, "lake");
    }
  }

  thinRivers();
  joinNearbyReaches();
  thinRivers();
  completeReaches();

  for (const [id, terrain] of water)
    if (terrain === "river" && regionalWaterCells.has(id) && !rivers.has(id))
      water.delete(id);
  for (const id of rivers) water.set(id, "river");
}

type RiverExit = HexCoordinate & { dq: number; dr: number };

const cross = (aq: number, ar: number, bq: number, br: number) =>
  aq * br - ar * bq;

function exitsTouch(a: RiverExit, b: RiverExit) {
  const determinant = cross(a.dq, a.dr, b.dq, b.dr);
  return [[0, 0], ...HEX_NEIGHBORS].some(([dq, dr]) => {
    const q = b.q + dq - a.q;
    const r = b.r + dr - a.r;
    if (determinant) {
      const alongA = cross(q, r, b.dq, b.dr) / determinant;
      const alongB = cross(q, r, a.dq, a.dr) / determinant;
      return (
        alongA >= 1 &&
        alongB >= 1 &&
        Number.isInteger(alongA) &&
        Number.isInteger(alongB)
      );
    }
    if (cross(q, r, a.dq, a.dr) !== 0) return false;
    // Parallel lines can meet after any number of rings. Opposing lines meet
    // only if there is room to take at least one step from each start.
    return (
      (a.dq === b.dq && a.dr === b.dr) || (a.dq ? q / a.dq : r / a.dr) >= 2
    );
  });
}

// Keep edge channels going when the board grows beyond the sampled region.
function riverExits(water: ReadonlyMap<string, TerrainType>) {
  const exits: RiverExit[] = [];
  const tileAt = ({ q, r }: HexCoordinate) => water.get(`${q}:${r}`);
  for (const cell of coreHexes) {
    if (hexRadius(cell) !== REGIONAL_MAP_RADIUS || tileAt(cell) !== "river")
      continue;
    const around = HEX_NEIGHBORS.map(([dq, dr]) => ({
      q: cell.q + dq,
      r: cell.r + dr,
    }));
    const wet = around.flatMap((next, edge) =>
      tileAt(next) === "river" ? [edge] : [],
    );
    if (
      wet.length !== 1 ||
      around.some((next) => tileAt(next) === "ocean" || tileAt(next) === "lake")
    )
      continue;
    const exposed = around.flatMap((next, edge) => {
      if (hexRadius(next) <= REGIONAL_MAP_RADIUS) return [];
      const attached = HEX_NEIGHBORS.filter(
        ([dq, dr]) => tileAt({ q: next.q + dq, r: next.r + dr }) === "river",
      );
      const [dq, dr] = HEX_NEIGHBORS[edge];
      return attached.length === 1 &&
        !exits.some((other) => exitsTouch({ ...cell, dq, dr }, other))
        ? [edge]
        : [];
    });
    const exit = closestHexEdge(exposed, (wet[0] + 3) % HEX_NEIGHBORS.length);
    if (exit === undefined) continue;
    const [dq, dr] = HEX_NEIGHBORS[exit];
    exits.push({ ...cell, dq, dr });
  }
  return exits;
}

type GeographicPoint = Pick<LocationType, "lat" | "long">;
const offshorePoints = Object.values(waterEntries).flatMap((entry) => {
  const lat = entry?.[3];
  const long = entry?.[4];
  return typeof lat === "number" && typeof long === "number"
    ? [{ lat, long }]
    : [];
});

function towardOffshore(location: LocationType, point: GeographicPoint) {
  const longitude = ((point.long - location.long + 540) % 360) - 180;
  const east = longitude * cos((location.lat * Math.PI) / 180);
  const south = location.lat - point.lat;
  // Engines implement Math.hypot differently. Square root is correctly rounded everywhere,
  // so every crossplay device derives the same coastline.
  return { east, south, distance: Math.sqrt(east * east + south * south) };
}

function nearestOffshore(location: LocationType): GeographicPoint | undefined {
  let nearest: GeographicPoint | undefined;
  let shortest = Infinity;
  for (const point of offshorePoints) {
    const { distance } = towardOffshore(location, point);
    if (distance > 0 && distance < shortest) {
      nearest = point;
      shortest = distance;
    }
  }
  return nearest;
}

export interface RegionalGeography {
  city: string;
  utility: string;
  offshore?: GeographicPoint;
  terrainAt: (cell: HexCoordinate) => TerrainType;
}

export function getRegionalGeography(
  location: LocationType,
  startingYear: number,
  scenarioId: number,
  sources?: DataCenterCustomerSources,
): RegionalGeography {
  const entry = Object.hasOwn(waterEntries, location.id)
    ? waterEntries[location.id]
    : undefined;
  const sameLocation =
    entry &&
    Math.abs(Number(entry[0]) - location.lat) < 0.05 &&
    Math.abs(Number(entry[1]) - location.long) < 0.05;
  const region =
    sameLocation && Object.hasOwn(RESEARCHED_REGIONS, location.id)
      ? RESEARCHED_REGIONS[location.id]
      : undefined;
  const city =
    region?.city ?? (location.name.split(",")[0].trim() || location.name);
  const reference =
    !region && sources && sameLocation && Object.hasOwn(sources, location.id)
      ? sources[location.id]
      : undefined;
  const sourcedUtility =
    reference &&
    startingYear >= (reference.sourceYear ?? CUSTOMER_RESEARCH_YEAR)
      ? reference.serviceArea
      : undefined;
  // Load Shedding models Eskom's generation system at regional scale.
  const utility =
    (scenarioId === 113 && region?.city === "Johannesburg"
      ? "Eskom"
      : region?.utility.find(([year]) => startingYear >= year)?.[1]) ??
    sourcedUtility ??
    `${city} model grid`;
  const [, , samples, offshoreLat, offshoreLong] = sameLocation ? entry : [];
  const mappedCoast =
    typeof offshoreLat === "number" && typeof offshoreLong === "number"
      ? { lat: offshoreLat, long: offshoreLong }
      : undefined;
  const offshore =
    mappedCoast ?? (location.offshore ? nearestOffshore(location) : undefined);
  const water = new Map<string, TerrainType>();
  if (typeof samples === "string") {
    coreHexes.forEach(({ q, r }, index) => {
      const terrain =
        WATER_TERRAIN[samples[index] as keyof typeof WATER_TERRAIN];
      if (terrain) water.set(`${q}:${r}`, terrain);
    });
    // A vetted offshore reference preserves sampled tidal water where the atlas
    // is too coarse to show a narrow strait. Explicit lake samples stay lakes.
    if (!mappedCoast) classifyInlandWater(water);
  }
  for (const [q, r] of region?.river ?? []) {
    const key = `${q}:${r}`;
    if (!water.has(key)) water.set(key, "river");
  }
  // Fill missing coverage for an explicitly declared resource. An offshore weather
  // point supplies the direction. A watershed without sampled geography gets a schematic river.
  const salt = `regional-landscape-v1:${location.id}:${location.lat}:${location.long}`;
  if (offshore && ![...water.values()].includes("ocean")) {
    const { east, south, distance } = towardOffshore(location, offshore);
    for (const { q, r } of coreHexes) {
      const projection =
        ((q + r / 2) * east + ((r * Math.sqrt(3)) / 2) * south) / distance;
      const key = `${q}:${r}`;
      if (!water.has(key) && projection > REGIONAL_MAP_RADIUS - 2)
        water.set(key, "ocean");
    }
  }
  const declaredHydro = location.resources?.hydro ?? !!location.watershedId;
  if (!sameLocation && declaredHydro) {
    const axis = territoryCoordinateHash(0, 0, salt) % 3;
    for (const { q, r } of coreHexes) {
      const key = `${q}:${r}`;
      if (!water.has(key) && [q, r, q + r][axis] === 1) water.set(key, "river");
    }
  }
  routeRivers(water);
  const exits = riverExits(water);
  // Texture between landmarks is schematic and fixed to the location, across starts and saves.
  const treeChance =
    region?.treeCover === "wooded"
      ? 45
      : region?.treeCover === "sparse"
        ? 12
        : 25;
  const terrainAt = ({ q, r }: HexCoordinate): TerrainType => {
    if (q === 0 && r === 0) return "plains";
    const wet = water.get(`${q}:${r}`);
    if (wet) return wet;
    const beyondAtlas = hexRadius({ q, r }) - REGIONAL_MAP_RADIUS;
    if (
      beyondAtlas > 0 &&
      exits.some(
        (exit) =>
          q === exit.q + beyondAtlas * exit.dq &&
          r === exit.r + beyondAtlas * exit.dr,
      )
    )
      return "river";
    const roll = territoryCoordinateHash(q, r, salt) % 100;
    for (const [centerQ, centerR, width] of region?.relief ?? []) {
      const distance = hexRadius({ q: q - centerQ, r: r - centerR });
      if (distance < width - 1 && width >= 3) return "mountain";
      if (distance < width) return "hills";
    }
    if (!region && (location.elevation ?? 0) > 800 && roll >= 82)
      return "hills";
    return roll < treeChance ? "forest" : "plains";
  };
  return { city, utility, offshore, terrainAt };
}
