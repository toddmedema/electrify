import {
  clampViewport,
  clusterLocations,
  directionalNeighbor,
  panViewport,
  pointInViewport,
  projectLocation,
  zoomViewportAt,
} from "./WorldMap";

const world = { center: { x: 0.5, y: 0.5 }, zoom: 0 };

it("projects geographic extremes onto the map", () => {
  expect(projectLocation({ lat: 90, long: -180 })).toEqual({ x: 0, y: 0 });
  expect(projectLocation({ lat: -90, long: 180 })).toEqual({ x: 1, y: 1 });
  expect(pointInViewport({ x: 0.5, y: 0.5 }, world)).toEqual({
    x: 0.5,
    y: 0.5,
  });
});

it("clamps zoom and map centers to visible bounds", () => {
  expect(clampViewport({ center: { x: -2, y: 4 }, zoom: 99 })).toEqual({
    center: { x: 0.0625, y: 0.9375 },
    zoom: 3,
  });
});

it("pans zoomed viewports in screen pixels and stops at the world edge", () => {
  expect(
    panViewport({ center: { x: 0.5, y: 0.5 }, zoom: 1 }, 100, -50, 400, 200),
  ).toEqual({ center: { x: 0.625, y: 0.375 }, zoom: 1 });
  expect(
    panViewport(
      { center: { x: 0.5, y: 0.5 }, zoom: 3 },
      10000,
      10000,
      400,
      200,
    ),
  ).toEqual({ center: { x: 0.9375, y: 0.9375 }, zoom: 3 });
  expect(panViewport(world, 100, 100, 400, 200)).toEqual(world);
});

it("zooms around a screen point and keeps its world location stationary", () => {
  const anchor = { x: 0.75, y: 0.25 };
  const zoomed = zoomViewportAt(world, 1, anchor);

  expect(zoomed).toEqual({ center: { x: 0.625, y: 0.375 }, zoom: 1 });
  expect(pointInViewport({ x: 0.75, y: 0.25 }, zoomed)).toEqual(anchor);
  expect(zoomViewportAt(zoomed, 99, anchor).zoom).toBe(3);
});

it("clusters close locations deterministically but keeps selection visible", () => {
  const locations = [
    { id: "b", lat: 40, long: -74 },
    { id: "a", lat: 40.01, long: -74.01 },
    { id: "far", lat: 0, long: 80 },
  ];
  const clustered = clusterLocations(locations, world, 800, 400, 32);
  expect(
    clustered.map((control) => [control.kind, control.locations.length]),
  ).toEqual([
    ["cluster", 2],
    ["marker", 1],
  ]);

  const withSelection = clusterLocations(locations, world, 800, 400, 32, "a");
  expect(
    withSelection.find((control) => control.id === "location-a")?.kind,
  ).toBe("marker");
});

it("finds the nearest directional control", () => {
  const controls = [
    { id: "center", x: 0.5, y: 0.5 },
    { id: "right-near", x: 0.6, y: 0.52 },
    { id: "right-far", x: 0.8, y: 0.5 },
    { id: "up", x: 0.5, y: 0.2 },
  ];
  expect(directionalNeighbor(controls, "center", "right")?.id).toBe(
    "right-near",
  );
  expect(directionalNeighbor(controls, "center", "up")?.id).toBe("up");
  expect(directionalNeighbor(controls, "center", "left")).toBeUndefined();
});
