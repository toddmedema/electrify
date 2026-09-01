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
import {
  clampViewport,
  clusterLocations,
  directionalNeighbor,
  MapControl,
  MapDirection,
  MapPoint,
  MapViewport,
  MAP_ZOOM_SCALES,
  projectLocation,
} from "../../helpers/WorldMap";

interface Props {
  locations: CityType[];
  value?: CityType;
  loading?: boolean;
  onChange: (location: CityType) => void;
}

const WORLD_VIEW: MapViewport = { center: { x: 0.5, y: 0.5 }, zoom: 0 };
const MAX_ZOOM = 3;

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
  const mapRef = React.useRef<HTMLDivElement>(null);
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

  const setZoom = (zoom: number, center = viewport.center, focus = false) => {
    const next = clampViewport({ center, zoom });
    setViewport(next);
    setAnnouncement(
      next.zoom === 0
        ? "Showing the whole world"
        : `Map zoom level ${next.zoom + 1}`,
    );
    if (focus) setFocusAfterZoom({ x: 0.5, y: 0.5 });
  };

  const select = (location: CityType, centerSearch = false) => {
    onChange(location);
    setAnnouncement(`${location.name} selected`);
    setRovingId(`location-${location.id}`);
    if (centerSearch) {
      setViewport(
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

  return (
    <section className="locationPicker" aria-labelledby="location-picker-title">
      <div className="locationPickerHeading">
        <Typography id="location-picker-title" variant="h6" component="h2">
          Location
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Choose a playable city. Location changes weather, demand, fuel prices,
          and available build sites.
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
        {value && (
          <div
            className="locationPickerSelection"
            aria-label="Selected location"
          >
            <Typography variant="subtitle1" component="p">
              {value.name}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {locationDetail(value)}
            </Typography>
          </div>
        )}
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
        className="worldMap"
        ref={mapRef}
        role="group"
        aria-label="Playable locations map"
        aria-describedby="location-map-instructions"
      >
        <span id="location-map-instructions" className="visuallyHidden">
          Use arrow keys to move between map locations. Press Enter or Space to
          select a city or zoom into a cluster. Press Home to show the world.
        </span>
        <svg
          className="worldMapLand"
          viewBox="0 0 1000 500"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g
            transform={`translate(${500 - viewport.center.x * 1000 * MAP_ZOOM_SCALES[viewport.zoom]} ${250 - viewport.center.y * 500 * MAP_ZOOM_SCALES[viewport.zoom]}) scale(${MAP_ZOOM_SCALES[viewport.zoom]})`}
          >
            <g className="worldMapGrid">
              <path d="M0 125H1000M0 250H1000M0 375H1000M250 0V500M500 0V500M750 0V500" />
            </g>
            <g className="worldMapContinents">
              <path d="M45 86L115 42 230 54 286 102 258 145 204 157 170 211 118 196 92 145 48 127Z" />
              <path d="M219 232L279 249 300 310 270 420 235 463 224 361 190 281Z" />
              <path d="M430 92L492 69 548 92 572 128 645 112 715 69 862 78 953 130 905 188 804 180 745 226 670 211 620 165 569 173 525 143 468 151 420 125Z" />
              <path d="M462 177L551 174 602 232 573 343 524 411 485 329 451 253Z" />
              <path d="M797 315L861 289 929 325 912 388 846 405 800 364Z" />
              <path d="M950 228L968 243 958 277 944 251Z" />
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
                onClick={(event) => activate(control, event.currentTarget)}
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
