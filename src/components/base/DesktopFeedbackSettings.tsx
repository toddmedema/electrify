import { Typography } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";
import SettingRow from "./SettingRow";
import SettingsSwitch from "./SettingsSwitch";

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
    <SettingRow
      label={label}
      htmlFor={key}
      description={
        <>
          {description}
          {props.kind === "timeline" && props.timelineSupported === false && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Steam Game Recording is unavailable right now. Your preference is
              saved.
            </Typography>
          )}
        </>
      }
    >
      <SettingsSwitch
        id={key}
        checked={enabled}
        slotProps={{ input: { "aria-label": label } }}
        onChange={(_event, checked) => dispatch(change({ [key]: checked }))}
      />
    </SettingRow>
  );
}
