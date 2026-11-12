import {
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import TvIcon from "@mui/icons-material/Tv";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";
import { normalizeTvInset, TV_INSETS } from "../../TvLayout";
import TvModeSuggestion from "./TvModeSuggestion";

/** Shared by the title screen setup and Display settings. */
export default function TvLayoutSettings({
  compact = false,
}: {
  compact?: boolean;
}) {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.settings);
  const enabled = settings.tvMode === true;
  if (compact)
    return (
      <>
        <TvModeSuggestion />
        <Button
          className="tvPresetEntry"
          variant="outlined"
          startIcon={<TvIcon />}
          aria-pressed={enabled}
          onClick={() => dispatch(change({ tvMode: !enabled }))}
        >
          {enabled
            ? "TV layout on · switch to desktop"
            : "Playing on a TV? Use TV layout"}
        </Button>
      </>
    );
  return (
    <Box className="tvLayoutSettings">
      <Typography component="h3" variant="subtitle1">
        TV layout
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Larger controls and one active tool for playing from the couch. Saved on
        this device.
      </Typography>
      <ToggleButtonGroup
        className="settingsKeyboardRow"
        exclusive
        value={enabled ? "tv" : "desktop"}
        aria-label="Interface layout"
        onChange={(_event, value: string | null) =>
          value && dispatch(change({ tvMode: value === "tv" }))
        }
      >
        <ToggleButton value="desktop">Desktop</ToggleButton>
        <ToggleButton value="tv">TV</ToggleButton>
      </ToggleButtonGroup>
      {enabled && (
        <>
          <Typography component="h4" variant="subtitle2" id="tv-inset-label">
            Screen-edge inset
          </Typography>
          <ToggleButtonGroup
            className="settingsKeyboardRow"
            exclusive
            value={normalizeTvInset(settings.tvInset)}
            aria-labelledby="tv-inset-label"
            onChange={(_event, value: number | null) =>
              value !== null && dispatch(change({ tvInset: value }))
            }
          >
            {TV_INSETS.map((inset) => (
              <ToggleButton key={inset} value={inset}>
                {inset}%
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </>
      )}
    </Box>
  );
}
