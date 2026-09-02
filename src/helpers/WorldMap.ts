export interface MapLocation {
  id: string;
  lat: number;
  long: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapViewport {
  center: MapPoint;
  zoom: number;
}

export interface MapMarker<T extends MapLocation> extends MapPoint {
  kind: "marker";
  id: string;
  locations: [T];
}

export interface MapCluster<T extends MapLocation> extends MapPoint {
  kind: "cluster";
  id: string;
  locations: T[];
}

export type MapControl<T extends MapLocation> = MapMarker<T> | MapCluster<T>;

export const MAP_ZOOM_SCALES = [1, 2, 4, 8] as const;

export function projectLocation(
  location: Pick<MapLocation, "lat" | "long">,
): MapPoint {
  return {
    x: (location.long + 180) / 360,
    y: (90 - location.lat) / 180,
  };
}

export function clampViewport(viewport: MapViewport): MapViewport {
  const zoom = Math.max(0, Math.min(MAP_ZOOM_SCALES.length - 1, viewport.zoom));
  const scale = MAP_ZOOM_SCALES[zoom];
  const half = 0.5 / scale;
  return {
    zoom,
    center: {
      x: Math.max(half, Math.min(1 - half, viewport.center.x)),
      y: Math.max(half, Math.min(1 - half, viewport.center.y)),
    },
  };
}

/** Changes zoom while keeping the world point under a screen-space anchor stationary. */
export function zoomViewportAt(
  viewport: MapViewport,
  zoom: number,
  anchor: MapPoint,
): MapViewport {
  const current = clampViewport(viewport);
  const targetZoom = Math.max(
    0,
    Math.min(MAP_ZOOM_SCALES.length - 1, Math.round(zoom)),
  );
  const currentScale = MAP_ZOOM_SCALES[current.zoom];
  const targetScale = MAP_ZOOM_SCALES[targetZoom];
  const screen = {
    x: Math.max(0, Math.min(1, anchor.x)),
    y: Math.max(0, Math.min(1, anchor.y)),
  };
  const world = {
    x: current.center.x + (screen.x - 0.5) / currentScale,
    y: current.center.y + (screen.y - 0.5) / currentScale,
  };
  return clampViewport({
    zoom: targetZoom,
    center: {
      x: world.x - (screen.x - 0.5) / targetScale,
      y: world.y - (screen.y - 0.5) / targetScale,
    },
  });
}

/** Moves a zoomed viewport by screen pixels, clamping it at the edge of the world. */
export function panViewport(
  viewport: MapViewport,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): MapViewport {
  const clamped = clampViewport(viewport);
  if (clamped.zoom === 0 || width <= 0 || height <= 0) {
    return clamped;
  }
  const scale = MAP_ZOOM_SCALES[clamped.zoom];
  return clampViewport({
    zoom: clamped.zoom,
    center: {
      x: clamped.center.x + deltaX / (width * scale),
      y: clamped.center.y + deltaY / (height * scale),
    },
  });
}

export function pointInViewport(
  point: MapPoint,
  viewport: MapViewport,
): MapPoint | undefined {
  const clamped = clampViewport(viewport);
  const scale = MAP_ZOOM_SCALES[clamped.zoom];
  const x = (point.x - clamped.center.x) * scale + 0.5;
  const y = (point.y - clamped.center.y) * scale + 0.5;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return undefined;
  }
  return { x, y };
}

/**
 * Deterministically groups nearby projected locations. The selected location remains a marker,
 * so the current game location is always represented as selected rather than disappearing into
 * an anonymous count.
 */
export function clusterLocations<T extends MapLocation>(
  locations: T[],
  viewport: MapViewport,
  width: number,
  height: number,
  thresholdPx: number,
  selectedId?: string,
): MapControl<T>[] {
  const visible = locations
    .map((location: T) => ({
      location,
      point: pointInViewport(projectLocation(location), viewport),
    }))
    .filter((entry): entry is { location: T; point: MapPoint } => !!entry.point)
    .sort((a, b) => a.location.id.localeCompare(b.location.id));

  const groups: Array<{ locations: T[]; x: number; y: number }> = [];
  visible.forEach(({ location, point }) => {
    if (location.id === selectedId) {
      return;
    }
    const nearest = groups
      .map((group, index) => ({
        group,
        index,
        distance: Math.hypot(
          (point.x - group.x) * width,
          (point.y - group.y) * height,
        ),
      }))
      .filter((candidate) => candidate.distance < thresholdPx)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.group.locations[0].id.localeCompare(b.group.locations[0].id),
      )[0];
    if (!nearest) {
      groups.push({ locations: [location], x: point.x, y: point.y });
      return;
    }
    const count = nearest.group.locations.length;
    nearest.group.x = (nearest.group.x * count + point.x) / (count + 1);
    nearest.group.y = (nearest.group.y * count + point.y) / (count + 1);
    nearest.group.locations.push(location);
  });

  const controls: MapControl<T>[] = groups.map((group) =>
    group.locations.length === 1
      ? {
          kind: "marker",
          id: `location-${group.locations[0].id}`,
          locations: [group.locations[0]],
          x: group.x,
          y: group.y,
        }
      : {
          kind: "cluster",
          id: `cluster-${group.locations.map((location) => location.id).join("-")}`,
          locations: group.locations,
          x: group.x,
          y: group.y,
        },
  );

  const selected = visible.find(({ location }) => location.id === selectedId);
  if (selected) {
    controls.push({
      kind: "marker",
      id: `location-${selected.location.id}`,
      locations: [selected.location],
      x: selected.point.x,
      y: selected.point.y,
    });
  }
  return controls.sort((a, b) => a.id.localeCompare(b.id));
}

export type MapDirection = "left" | "right" | "up" | "down";

export function directionalNeighbor<T extends MapPoint & { id: string }>(
  controls: T[],
  currentId: string,
  direction: MapDirection,
): T | undefined {
  const current = controls.find((control) => control.id === currentId);
  if (!current) {
    return undefined;
  }
  return controls
    .filter((control) => {
      if (control.id === currentId) return false;
      if (direction === "left") return control.x < current.x;
      if (direction === "right") return control.x > current.x;
      if (direction === "up") return control.y < current.y;
      return control.y > current.y;
    })
    .map((control) => {
      const dx = control.x - current.x;
      const dy = control.y - current.y;
      const primary =
        direction === "left" || direction === "right"
          ? Math.abs(dx)
          : Math.abs(dy);
      const cross =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);
      return { control, score: primary + cross * 2 };
    })
    .sort(
      (a, b) => a.score - b.score || a.control.id.localeCompare(b.control.id),
    )[0]?.control;
}
