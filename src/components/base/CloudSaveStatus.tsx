import { useState } from "react";
import { Alert, AlertTitle, Button, Stack, Typography } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { sessionChanged } from "../../SaveLibrary";
import { login } from "../../Globals";
import { refreshToUpdate } from "../../helpers/Cache";
import { downloadCloudRecovery, retryCloudSync } from "../../CloudSaves";
import type { IncompatibleCloudSave } from "../../Types";

function RecoveryDownload({
  issue,
}: {
  issue: IncompatibleCloudSave;
}): React.JSX.Element {
  const [state, setState] = useState<
    "idle" | "downloading" | "downloaded" | "failed"
  >("idle");
  const download = async () => {
    setState("downloading");
    try {
      await downloadCloudRecovery(issue);
      setState("downloaded");
    } catch {
      setState("failed");
    }
  };
  return (
    <Stack spacing={1}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" } }}
      >
        <Typography sx={{ flex: 1, overflowWrap: "anywhere", minWidth: 0 }}>
          {issue.name}
        </Typography>
        <Button
          variant="outlined"
          disabled={state === "downloading"}
          onClick={() => void download()}
          aria-label={`Download recovery file for ${issue.name}`}
          sx={{ flexShrink: 0 }}
        >
          {state === "downloading" ? "Downloading…" : "Download recovery file"}
        </Button>
      </Stack>
      {state === "downloaded" && (
        <Typography variant="body2" role="status">
          Recovery file downloaded.
        </Typography>
      )}
      {state === "failed" && (
        <Typography variant="body2" role="alert">
          Couldn't download this backup. Check your connection and account, then
          try again.
        </Typography>
      )}
    </Stack>
  );
}

export default function CloudSaveStatus(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const {
    cloudState,
    cloudError,
    cloudConflicts,
    incompatibleCloudSaves = [],
  } = useAppSelector((state) => state.saves);
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
      ? incompatibleCloudSaves.length
        ? "Compatible cloud backups are up to date. Games load from this device."
        : "Cloud backup up to date. Games load from this device."
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
      {!!incompatibleCloudSaves.length && (
        <Alert
          severity="warning"
          sx={{ "& .MuiAlert-message": { width: "100%", minWidth: 0 } }}
        >
          <AlertTitle>Some backups need the latest version</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            A newer version of Electrify saved these games. They're safe in your
            account. Refresh to update, and they'll load normally.
          </Typography>
          <Button variant="contained" onClick={refreshToUpdate} sx={{ mb: 2 }}>
            Refresh to update
          </Button>
          <Typography variant="body2" sx={{ mb: 1 }}>
            If they still don't open, keep a copy of the original data:
          </Typography>
          <Stack spacing={2}>
            {incompatibleCloudSaves.map((issue) => (
              <RecoveryDownload
                key={`${issue.id}/${issue.version}`}
                issue={issue}
              />
            ))}
          </Stack>
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
