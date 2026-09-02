import * as React from "react";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import PublicIcon from "@mui/icons-material/Public";
import {
  Autocomplete,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { CityType } from "../../data/Cities";
import { WORLD_LAND_PATH } from "../../data/WorldLand";
import {
  clampViewport,
  clusterLocations,
  directionalNeighbor,
  MapControl,
  MapDirection,
  MapPoint,
  MapViewport,
  MAP_ZOOM_SCALES,
  panViewport,
  projectLocation,
  zoomViewportAt,
} from "../../helpers/WorldMap";

interface Props {
  locations: CityType[];
  value?: CityType;
  loading?: boolean;
  onChange: (location: CityType) => void;
}

const WORLD_VIEW: MapViewport = { center: { x: 0.5, y: 0.5 }, zoom: 0 };
const MAX_ZOOM = 3;

interface MapDrag {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

interface MapPinch {
  distance: number;
}

const PINCH_ZOOM_IN_RATIO = 1.25;
const PINCH_ZOOM_OUT_RATIO = 0.8;
const WHEEL_ZOOM_THRESHOLD = 40;

function locationDetail(location: CityType): string {
  return [location.admin, location.country, location.region]
    .filter((part, index, all) => !!part && all.indexOf(part) === index)
    .join(" · ");
}

function accessibleLocationName(location: CityType): string {
  const country = location.country;
  return country && !location.name.toLowerCase().includes(country.toLowerCase())
    ? `${location.name}, ${country}`
    : location.name;
}

function clusterArea(locations: CityType[]): string {
  const regions = Array.from(
    new Set(locations.map((location) => location.region)),
  );
  return regions.length === 1 ? regions[0] : "this area";
}

function nearestControl(
  controls: MapControl<CityType>[],
  point: MapPoint,
): MapControl<CityType> | undefined {
  return [...controls].sort(
    (a, b) =>
      Math.hypot(a.x - point.x, a.y - point.y) -
        Math.hypot(b.x - point.x, b.y - point.y) || a.id.localeCompare(b.id),
  )[0];
}

/** An offline, explicitly-controlled world map backed by the same city catalogue as search. */
export default function LocationPicker({
  locations,
  value,
  loading = false,
  onChange,
}: Props): React.JSX.Element {
  const [viewport, setViewport] = React.useState<MapViewport>(WORLD_VIEW);
  const [mapSize, setMapSize] = React.useState({ width: 600, height: 300 });
  const [rovingId, setRovingId] = React.useState(
    value ? `location-${value.id}` : "",
  );
  const [announcement, setAnnouncement] = React.useState("");
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [menuLocations, setMenuLocations] = React.useState<CityType[]>([]);
  const [focusAfterZoom, setFocusAfterZoom] = React.useState<MapPoint>();
  const [panning, setPanning] = React.useState(false);
  const mapRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef(viewport);
  const dragRef = React.useRef<MapDrag>();
  const pinchRef = React.useRef<MapPinch>();
  const pointersRef = React.useRef(new Map<number, MapPoint>());
  const wheelDeltaRef = React.useRef(0);
  const suppressClickRef = React.useRef(false);
  const controlRefs = React.useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

  React.useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const measure = () => {
      const width = map.clientWidth;
      if (width) setMapSize({ width, height: width / 2 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // A wheel gesture begun over the map belongs to the map. A non-passive native listener is
    // required here because React's delegated wheel handler may be passive in browsers. Leave the
    // event bubbling so the React handler below can still apply the map zoom.
    const captureWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    map.addEventListener("wheel", captureWheel, { passive: false });
    return () => map.removeEventListener("wheel", captureWheel);
  }, []);

  const controls = React.useMemo(
    () =>
      clusterLocations(
        locations,
        viewport,
        mapSize.width,
        mapSize.height,
        mapSize.width < 700 ? 44 : 32,
        value?.id,
      ),
    [locations, viewport, mapSize, value?.id],
  );

  React.useEffect(() => {
    if (controls.length === 0) return;
    if (focusAfterZoom) {
      const next = nearestControl(controls, focusAfterZoom);
      if (next) {
        setRovingId(next.id);
        requestAnimationFrame(() => controlRefs.current[next.id]?.focus());
      }
      setFocusAfterZoom(undefined);
      return;
    }
    if (!controls.some((control) => control.id === rovingId)) {
      const selected = controls.find((control) =>
        control.locations.some((location) => location.id === value?.id),
      );
      setRovingId((selected || controls[0]).id);
    }
  }, [controls, rovingId, value?.id, focusAfterZoom]);

  viewportRef.current = viewport;

  const applyViewport = (next: MapViewport) => {
    viewportRef.current = next;
    setViewport(next);
  };

  const announceZoom = (zoom: number) => {
    setAnnouncement(
      zoom === 0 ? "Showing the whole world" : `Map zoom level ${zoom + 1}`,
    );
  };

  const setZoom = (
    zoom: number,
    center = viewportRef.current.center,
    focus = false,
  ) => {
    const next = clampViewport({ center, zoom });
    applyViewport(next);
    announceZoom(next.zoom);
    if (focus) setFocusAfterZoom({ x: 0.5, y: 0.5 });
  };

  const zoomAtPoint = (delta: number, point: MapPoint) => {
    const current = viewportRef.current;
    const next = zoomViewportAt(current, current.zoom + delta, point);
    if (next.zoom === current.zoom) return;
    applyViewport(next);
    announceZoom(next.zoom);
  };

  const screenPoint = (clientX: number, clientY: number): MapPoint => {
    const rect = mapRef.current?.getBoundingClientRect();
    const width = rect?.width || mapSize.width;
    const height = rect?.height || mapSize.height;
    return {
      x: (clientX - (rect?.left || 0)) / width,
      y: (clientY - (rect?.top || 0)) / height,
    };
  };

  const select = (location: CityType, centerSearch = false) => {
    onChange(location);
    setAnnouncement(`${location.name} selected`);
    setRovingId(`location-${location.id}`);
    if (centerSearch) {
      applyViewport(
        clampViewport({ center: projectLocation(location), zoom: 2 }),
      );
    }
  };

  const activate = (control: MapControl<CityType>, element: HTMLElement) => {
    if (control.kind === "marker") {
      select(control.locations[0]);
      return;
    }
    if (viewport.zoom < MAX_ZOOM) {
      setZoom(
        viewport.zoom + 1,
        projectLocation({
          lat:
            control.locations.reduce((sum, location) => sum + location.lat, 0) /
            control.locations.length,
          long:
            control.locations.reduce(
              (sum, location) => sum + location.long,
              0,
            ) / control.locations.length,
        }),
        true,
      );
      return;
    }
    setMenuLocations(control.locations);
    setMenuAnchor(element);
  };

  const handleMapKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    control: MapControl<CityType>,
  ) => {
    const directions: Partial<Record<string, MapDirection>> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "Spacebar"
    ) {
      event.preventDefault();
      activate(control, event.currentTarget);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setZoom(0, WORLD_VIEW.center, true);
      return;
    }
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = directionalNeighbor(controls, control.id, direction);
    if (next) {
      setRovingId(next.id);
      controlRefs.current[next.id]?.focus();
    }
  };

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest(".worldMapControls, .worldMapMarker")
    ) {
      return;
    }
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      dragRef.current = undefined;
      suppressClickRef.current = true;
      pointersRef.current.forEach((_point, pointerId) =>
        event.currentTarget.setPointerCapture?.(pointerId),
      );
      setPanning(true);
      event.preventDefault();
      return;
    }
    if (viewportRef.current.zoom === 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanning(true);
  };

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      event.preventDefault();
      const [a, b] = Array.from(pointersRef.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / Math.max(1, pinchRef.current.distance);
      const delta =
        ratio >= PINCH_ZOOM_IN_RATIO
          ? 1
          : ratio <= PINCH_ZOOM_OUT_RATIO
            ? -1
            : 0;
      if (delta !== 0) {
        zoomAtPoint(delta, screenPoint((a.x + b.x) / 2, (a.y + b.y) / 2));
        pinchRef.current.distance = distance;
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (deltaX === 0 && deltaY === 0) return;
    event.preventDefault();
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = true;
    applyViewport(
      panViewport(
        viewportRef.current,
        -deltaX,
        -deltaY,
        mapSize.width,
        mapSize.height,
      ),
    );
  };

  const resetClickSuppression = () => {
    if (pointersRef.current.size === 0 && suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const wasPinching = !!pinchRef.current || pointersRef.current.size > 1;
    pointersRef.current.delete(event.pointerId);
    if (wasPinching) {
      suppressClickRef.current = true;
      dragRef.current = undefined;
      if (pointersRef.current.size < 2) {
        pinchRef.current = undefined;
        setPanning(false);
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      resetClickSuppression();
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      resetClickSuppression();
      return;
    }
    suppressClickRef.current = drag.moved;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const wheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    const rawDelta = event.deltaY || event.deltaX;
    if (rawDelta === 0) return;
    event.preventDefault();
    const modeScale =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const delta = rawDelta * modeScale;
    if (
      wheelDeltaRef.current !== 0 &&
      Math.sign(wheelDeltaRef.current) !== Math.sign(delta)
    ) {
      wheelDeltaRef.current = 0;
    }
    wheelDeltaRef.current += delta;
    if (Math.abs(wheelDeltaRef.current) < WHEEL_ZOOM_THRESHOLD) return;
    zoomAtPoint(
      wheelDeltaRef.current < 0 ? 1 : -1,
      screenPoint(event.clientX, event.clientY),
    );
    wheelDeltaRef.current = 0;
  };

  return (
    <section className="locationPicker" aria-labelledby="location-picker-title">
      <div className="locationPickerHeading">
        <Typography id="location-picker-title" variant="h6" component="h2">
          Location
        </Typography>
      </div>

      <div className="locationPickerDetails">
        <Autocomplete
          id="location"
          options={locations}
          groupBy={(location: CityType) => location.region}
          getOptionLabel={(location: CityType) => location.name}
          isOptionEqualToValue={(a: CityType, b: CityType) => a.id === b.id}
          value={value}
          onChange={(_event, picked: CityType | null) => {
            if (picked) select(picked, true);
          }}
          disableClearable
          autoHighlight
          openOnFocus
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search playable cities"
              size="small"
            />
          )}
        />
        <Typography
          className="locationPickerCount"
          variant="caption"
          aria-live="polite"
        >
          {loading
            ? "Loading playable locations"
            : `${locations.length} playable locations`}
        </Typography>
      </div>

      <div
        className={`worldMap${viewport.zoom > 0 ? " zoomed" : ""}${panning ? " panning" : ""}`}
        ref={mapRef}
        role="group"
        aria-label="Playable locations map"
        aria-describedby="location-map-instructions"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={(event) => {
          pointersRef.current.delete(event.pointerId);
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = undefined;
          }
          if (pointersRef.current.size < 2) pinchRef.current = undefined;
          if (!dragRef.current && !pinchRef.current) setPanning(false);
          resetClickSuppression();
        }}
        onWheel={wheelZoom}
      >
        <span id="location-map-instructions" className="visuallyHidden">
          Use arrow keys to move between map locations. Press Enter or Space to
          select a city or zoom into a cluster. When zoomed in, drag, swipe, or
          pinch to explore the map. Scroll to zoom in or out. Press Home to show
          the world.
        </span>
        <svg
          className="worldMapLand"
          viewBox="0 0 1000 500"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g
            data-testid="world-map-content"
            transform={`translate(${500 - viewport.center.x * 1000 * MAP_ZOOM_SCALES[viewport.zoom]} ${250 - viewport.center.y * 500 * MAP_ZOOM_SCALES[viewport.zoom]}) scale(${MAP_ZOOM_SCALES[viewport.zoom]})`}
          >
            <g className="worldMapGrid">
              <path d="M0 125H1000M0 250H1000M0 375H1000M250 0V500M500 0V500M750 0V500" />
            </g>
            <g className="worldMapContinents">
              <path d={WORLD_LAND_PATH} />
            </g>
          </g>
        </svg>

        <div className="worldMapMarkers">
          {controls.map((control) => {
            const selected =
              control.kind === "marker" &&
              control.locations[0].id === value?.id;
            const label =
              control.kind === "marker"
                ? `Select ${accessibleLocationName(control.locations[0])}`
                : `Zoom to ${control.locations.length} locations near ${clusterArea(
                    control.locations,
                  )}, including ${control.locations[0].name}`;
            return (
              <button
                key={control.id}
                ref={(element) => {
                  controlRefs.current[control.id] = element;
                }}
                type="button"
                className={`worldMapMarker ${control.kind}${selected ? " selected" : ""}`}
                style={{
                  left: `${control.x * 100}%`,
                  top: `${control.y * 100}%`,
                }}
                aria-label={label}
                aria-pressed={control.kind === "marker" ? selected : undefined}
                tabIndex={control.id === rovingId ? 0 : -1}
                title={
                  control.kind === "marker"
                    ? `${control.locations[0].name} — ${locationDetail(control.locations[0])}`
                    : label
                }
                onFocus={() => setRovingId(control.id)}
                onKeyDown={(event) => handleMapKey(event, control)}
                onClick={(event) => {
                  if (!suppressClickRef.current) {
                    activate(control, event.currentTarget);
                  }
                }}
              >
                {control.kind === "cluster"
                  ? control.locations.length
                  : selected
                    ? "✓"
                    : ""}
              </button>
            );
          })}
        </div>

        <div
          className="worldMapControls"
          role="group"
          aria-label="Map zoom controls"
        >
          <Tooltip title="Zoom out">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom out"
                disabled={viewport.zoom === 0}
                onClick={() => setZoom(viewport.zoom - 1)}
              >
                <ZoomOutIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Zoom in">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom in"
                disabled={viewport.zoom === MAX_ZOOM}
                onClick={() => setZoom(viewport.zoom + 1)}
              >
                <ZoomInIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Show world">
            <IconButton
              size="small"
              aria-label="Show world"
              onClick={() => setZoom(0, WORLD_VIEW.center)}
            >
              <PublicIcon />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <span className="visuallyHidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ list: { "aria-label": "Locations in this cluster" } }}
      >
        {menuLocations.map((location) => (
          <MenuItem
            key={location.id}
            onClick={() => {
              select(location);
              setMenuAnchor(null);
            }}
          >
            {location.name}{" "}
            {locationDetail(location) && `— ${locationDetail(location)}`}
          </MenuItem>
        ))}
      </Menu>
    </section>
  );
}
