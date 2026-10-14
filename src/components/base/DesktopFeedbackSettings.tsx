import { Box, Switch, Typography } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";

export default function DesktopFeedbackSettings(props: {
  kind: "vibration" | "timeline";
  timelineSupported?: boolean;
}) {
  const key =
    props.kind === "vibration"
      ? "controllerVibrationEnabled"
      : "steamTimelineEnabled";
  const enabled = useAppSelector((state) => !!state.settings[key]);
  const dispatch = useAppDispatch();
  const label =
    props.kind === "vibration" ? "Controller vibration" : "Recorded highlights";
  const description =
    props.kind === "vibration"
      ? "Brief feedback for confirmations and milestones on supported controllers. Respects your device's reduced motion setting."
      : "Adds markers to Steam Game Recording; it does not start video recording.";
  return (
    <Box
      className="settingsRow"
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 2,
        px: 2,
        py: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="label" htmlFor={key} sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {description}
        </Typography>
        {props.kind === "timeline" && props.timelineSupported === false && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Steam Game Recording is unavailable right now. Your preference is
            saved.
          </Typography>
        )}
      </Box>
      <Switch
        id={key}
        checked={enabled}
        slotProps={{ input: { "aria-label": label } }}
        onChange={(_event, checked) => dispatch(change({ [key]: checked }))}
        sx={{
          height: 44,
          padding: "15px 12px",
          "& .MuiSwitch-switchBase": { padding: "12px 9px" },
        }}
      />
    </Box>
  );
}
