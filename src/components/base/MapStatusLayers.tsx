import * as React from "react";
import {
  Checkbox,
  FormControlLabel,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import type { FacilityMapStatusKind } from "./FacilityMapStatus";

export interface MapStatusLayerSettings {
  producing: boolean;
  inactive: boolean;
  construction: boolean;
}
export const DEFAULT_MAP_STATUS_LAYERS: MapStatusLayerSettings = {
  producing: true,
  inactive: true,
  construction: true,
};

export function showsMapStatus(
  kind: FacilityMapStatusKind,
  layers: MapStatusLayerSettings,
): boolean {
  if (kind === "unknown") return false;
  if (kind === "construction") return layers.construction;
  if (kind === "idle" || kind === "paused") return layers.inactive;
  return layers.producing;
}

/** Workspace-only visibility; facility operation and its accessible status remain intact. */
export default function MapStatusLayers({
  value,
  onChange,
}: {
  value: MapStatusLayerSettings;
  onChange: (value: MapStatusLayerSettings) => void;
}) {
  const [anchor, setAnchor] = React.useState<HTMLButtonElement>();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const heading = React.useId();
  const close = () => {
    setAnchor(undefined);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <Tooltip title="Map layers" placement="top" arrow>
        <button
          className="territoryMapBuyToggle territoryMapLayerToggle"
          type="button"
          ref={trigger}
          aria-label="Map layers"
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <LayersOutlinedIcon aria-hidden="true" />
        </button>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        transitionDuration={0}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{
          paper: {
            role: "dialog",
            "aria-labelledby": heading,
            className: "mapStatusLayersPanel",
          },
        }}
      >
        <Typography id={heading} component="h3">
          Facility status
        </Typography>
        {(
          [
            ["producing", "Producing and charging"],
            ["inactive", "Idle and paused"],
            ["construction", "Construction"],
          ] as const
        ).map(([key, label]) => (
          <FormControlLabel
            key={key}
            control={
              <Checkbox
                checked={value[key]}
                onChange={(_, checked) =>
                  onChange({ ...value, [key]: checked })
                }
              />
            }
            label={label}
          />
        ))}
      </Popover>
    </>
  );
}
