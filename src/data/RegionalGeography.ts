import type { LocationType, TerrainType } from "../Types";
import { cos } from "../helpers/Libm";
import {
  getDataCenterCustomerProfile,
  type DataCenterCustomerSources,
} from "./DataCenterCustomers";
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
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
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
const WATER_TERRAIN = { o: "ocean", l: "lake", r: "river" } as const;
const waterEntries: Readonly<
  Partial<Record<string, readonly (string | number)[]>>
> = waterAtlas.regions;
const coreHexes = regionalHexes(REGIONAL_MAP_RADIUS);
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
  return { east, south, distance: Math.hypot(east, south) };
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
    sources && sameLocation
      ? getDataCenterCustomerProfile(location, sources)
      : undefined;
  const sourcedUtility =
    reference?.basis === "local-utility" &&
    !region &&
    (reference.sourceYear === undefined || startingYear >= reference.sourceYear)
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
  const offshore =
    typeof offshoreLat === "number" && typeof offshoreLong === "number"
      ? { lat: offshoreLat, long: offshoreLong }
      : location.offshore
        ? nearestOffshore(location)
        : undefined;
  const water = new Map<string, TerrainType>();
  if (typeof samples === "string") {
    coreHexes.forEach(({ q, r }, index) => {
      const terrain =
        WATER_TERRAIN[samples[index] as keyof typeof WATER_TERRAIN];
      if (terrain) water.set(`${q}:${r}`, terrain);
    });
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
