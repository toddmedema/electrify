import { Alert, Button, Stack, Typography } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { sessionChanged } from "../../SaveLibrary";
import { login } from "../../Globals";
import { retryCloudSync } from "../../CloudSaves";

export default function CloudSaveStatus(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const { cloudState, cloudError, cloudConflicts } = useAppSelector(
    (state) => state.saves,
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
        <Button
          variant="outlined"
          onClick={() => void login()}
          sx={{ flexShrink: 0 }}
        >
          Sign in with Google
        </Button>
      </Stack>
    );
  const message =
    cloudState === "synced"
      ? "Cloud backup up to date. Games load from this device."
      : cloudState === "offline"
        ? "You're offline. Games save on this device; cloud backup resumes when you reconnect."
        : cloudState === "failed"
          ? cloudError
          : cloudState === "initializing"
            ? "Saves stay on this device. Checking cloud sign-in…"
            : "Syncing cloud backup. Games load from this device.";
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary" role="status">
        {message}
      </Typography>
      {cloudState === "failed" && (
        <Button
          variant="outlined"
          onClick={retryCloudSync}
          sx={{ alignSelf: "flex-start" }}
        >
          Retry cloud backup
        </Button>
      )}
      {cloudConflicts && (
        <Alert
          severity="info"
          onClose={() => dispatch(sessionChanged({ cloudConflicts: false }))}
        >
          A game changed on two devices. Both copies were kept in your saved
          games.
        </Alert>
      )}
    </Stack>
  );
}
