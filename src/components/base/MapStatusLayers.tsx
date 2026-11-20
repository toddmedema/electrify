import * as React from "react";
import {
  Checkbox,
  FormControlLabel,
  FormGroup,
  Popover,
  Tooltip,
} from "@mui/material";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";

/** Workspace-only visibility; facility operation and its accessible status remain intact. */
export default function MapStatusLayers({
  showStatus,
  onStatusChange,
  showNames,
  onNamesChange,
}: {
  showStatus: boolean;
  onStatusChange: (value: boolean) => void;
  showNames: boolean;
  onNamesChange: (value: boolean) => void;
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
          className="territoryMapControl territoryMapLayerToggle"
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
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={showStatus}
                onChange={(_, checked) => onStatusChange(checked)}
              />
            }
            label="Facility status"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={showNames}
                onChange={(_, checked) => onNamesChange(checked)}
              />
            }
            label="Names"
          />
        </FormGroup>
      </Popover>
    </>
  );
}
