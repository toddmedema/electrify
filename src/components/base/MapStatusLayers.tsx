import * as React from "react";
import { Checkbox, FormControlLabel, Popover, Tooltip } from "@mui/material";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";

/** Workspace-only visibility; facility operation and its accessible status remain intact. */
export default function MapStatusLayers({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const [anchor, setAnchor] = React.useState<HTMLButtonElement>();
  const trigger = React.useRef<HTMLButtonElement>(null);
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
            "aria-label": "Map layers",
            className: "mapStatusLayersPanel",
          },
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={value}
              onChange={(_, checked) => onChange(checked)}
            />
          }
          label="Facility status"
        />
      </Popover>
    </>
  );
}
