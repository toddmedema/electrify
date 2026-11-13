import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { sessionChanged } from "../../SaveLibrary";
import SignInButtons from "./SignInButtons";
import { refreshToUpdate } from "../../helpers/Cache";
import { isDesktopApp } from "../../Desktop";

/**
 * Cloud backup messages that need the player: the sign-in invitation and the alerts that ask
 * for an action. Routine sync state lives in the header (CloudSyncIndicator).
 */
export default function CloudSaveStatus(): React.JSX.Element | null {
  const dispatch = useAppDispatch();
  const {
    cloudState,
    cloudConflicts,
    incompatibleCloudSaves = [],
  } = useAppSelector((state) => state.saves);
  if (
    process.env.REACT_APP_DESKTOP === "true" &&
    isDesktopApp() &&
    (cloudState === "offline" ||
      cloudState === "signedOut" ||
      cloudState === "initializing" ||
      !cloudState)
  )
    return (
      <Typography variant="body2" color="text.secondary">
        Games save on this device. Steam Cloud syncs when Steam is online and
        cloud saves are enabled.
      </Typography>
    );
  if (cloudState === "signedOut" || !cloudState)
    return (
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          Saves stay on this device. Sign in for cloud backup and access on
          other devices.
        </Typography>
        <SignInButtons />
      </Stack>
    );
  if (!incompatibleCloudSaves.length && !cloudConflicts) return null;
  return (
    <Stack spacing={1}>
      {!!incompatibleCloudSaves.length && (
        <Alert severity="warning">
          <AlertTitle>Some backups need the latest version</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            A newer version of Electrify saved some of your cloud backups.
            They're safe in your account. Refresh to update, and they'll load
            normally.
          </Typography>
          <Button variant="contained" onClick={refreshToUpdate}>
            Refresh to update
          </Button>
        </Alert>
      )}
      {cloudConflicts && (
        <Alert
          severity="info"
          onClose={() => dispatch(sessionChanged({ cloudConflicts: false }))}
        >
          A game changed on two devices. Both copies were kept
          {incompatibleCloudSaves.length
            ? " on this device and in your account."
            : " in your saved games."}
        </Alert>
      )}
    </Stack>
  );
}
