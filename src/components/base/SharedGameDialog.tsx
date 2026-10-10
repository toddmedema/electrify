import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { loadSharedSave } from "../../CloudSaveTransport";
import { importSavedGame, resumeSavedGame } from "../../SaveSession";
import { isResumableStatus, SaveRepositoryError } from "../../SaveModel";
import { refreshToUpdate } from "../../helpers/Cache";
import { useAppDispatch } from "../../Store";
import { navigate } from "../../reducers/Card";
import type { SaveFileType } from "../../Types";

export default function SharedGameDialog(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const [id, setId] = useState(() =>
    new URLSearchParams(window.location.search).get("game"),
  );
  const [file, setFile] = useState<SaveFileType>();
  const [error, setError] = useState("");
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    setBusy(true);
    setError("");
    setNeedsUpdate(false);
    void loadSharedSave(id)
      .then((save) => {
        if (current) setFile(save);
      })
      .catch((failure: unknown) => {
        if (!current) return;
        const newer =
          failure instanceof SaveRepositoryError &&
          failure.code === "incompatible";
        setNeedsUpdate(newer);
        if (newer)
          setError(
            "This game was shared from a newer version of Electrify. Refresh to update, then open it.",
          );
        else
          setError(
            failure instanceof Error &&
              /expired|invalid|no longer available/.test(failure.message)
              ? failure.message
              : "Couldn't load this shared game. Check your connection and try again.",
          );
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [id, attempt]);
  const close = () => {
    setId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("game");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  };
  return (
    <Dialog
      open={id !== null}
      onClose={busy ? undefined : close}
      fullWidth
      maxWidth="sm"
      aria-labelledby="shared-game-title"
    >
      <DialogTitle id="shared-game-title">Shared game</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {busy && (
            <Typography role="status">
              {file ? "Opening shared game…" : "Loading shared game…"}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {file && (
            <>
              <Typography
                variant="h6"
                component="h2"
                sx={{ overflowWrap: "anywhere" }}
              >
                {file.name}
              </Typography>
              <Typography color="text.secondary">
                {file.save.game.location.name} · {file.save.game.difficulty} ·{" "}
                {file.save.game.date.month} {file.save.game.date.year}
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button onClick={close} disabled={busy}>
          Close
        </Button>
        {!file && error && needsUpdate && (
          <Button variant="contained" onClick={refreshToUpdate}>
            Refresh to update
          </Button>
        )}
        {!file && error && !needsUpdate && (
          <Button onClick={() => setAttempt(attempt + 1)}>Retry</Button>
        )}
        {file && (
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const saveId = await importSavedGame(file);
                close();
                if (isResumableStatus(file.status))
                  await resumeSavedGame(saveId);
                else dispatch(navigate("SAVED_GAMES"));
              } catch {
                setError(
                  "Couldn't add this game. Check device storage and try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Play
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
