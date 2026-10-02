import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { createSharedSave } from "../../CloudSaveTransport";
import { firebaseAppAuth, login } from "../../Globals";
import { snapshotSavedGame } from "../../SaveSession";
import type { SaveFileType } from "../../Types";

export default function ShareSaveDialog({
  id,
  onClose,
}: {
  id?: string;
  onClose: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<SaveFileType>();
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const create = async (snapshot: SaveFileType, generation: number) => {
    const uid = firebaseAppAuth.currentUser?.uid;
    if (!uid) return;
    setBusy(true);
    try {
      const link = await createSharedSave(uid, snapshot);
      if (request.current === generation) setUrl(link);
    } catch (_error) {
      if (request.current === generation)
        setError(
          "Couldn't create a share link. Check your connection and try again.",
        );
    } finally {
      if (request.current === generation) setBusy(false);
    }
  };
  useEffect(() => {
    const generation = ++request.current;
    setUrl("");
    setError("");
    setCopied(false);
    setFile(undefined);
    if (id) {
      setBusy(true);
      void snapshotSavedGame(id)
        .then((snapshot) => {
          if (request.current !== generation) return;
          setFile(snapshot);
          setBusy(false);
          if (firebaseAppAuth.currentUser) void create(snapshot, generation);
        })
        .catch(() => {
          if (request.current === generation) {
            setBusy(false);
            setError("This save couldn't be opened for sharing.");
          }
        });
    }
    return () => {
      request.current = generation + 1;
    };
  }, [id]);
  const signInAndShare = async () => {
    if (!file) return;
    const generation = request.current;
    setError("");
    setBusy(true);
    if (!firebaseAppAuth.currentUser && !(await login())) {
      if (generation === request.current) {
        setBusy(false);
        setError("Sign-in didn't finish. Please try again.");
      }
      return;
    }
    if (generation === request.current) await create(file, generation);
  };
  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="share-save-title"
    >
      <DialogTitle id="share-save-title">Share a frozen copy</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography>
            Anyone with the link can add this copy to their saved games. Your
            later changes won't affect it.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The link expires after a year without being opened.
          </Typography>
          {busy && (
            <Typography role="status">
              {file ? "Creating share link…" : "Preparing saved game…"}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {url && (
            <TextField
              label="Share link"
              value={url}
              inputRef={input}
              fullWidth
              slotProps={{ input: { readOnly: true } }}
              onFocus={() => input.current?.select()}
            />
          )}
          {!url && !busy && !firebaseAppAuth.currentUser && (
            <Typography variant="body2">
              Sign in with Google to create a share link. No account is needed
              to open it.
            </Typography>
          )}
          {copied && (
            <Typography role="status" color="success.main">
              Link copied
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {url ? (
          <Button
            variant="contained"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                input.current?.focus();
                input.current?.select();
                setError("Select and copy the link above.");
              }
            }}
          >
            Copy link
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={busy || !file}
            onClick={() => void signInAndShare()}
          >
            {firebaseAppAuth.currentUser
              ? "Create share link"
              : "Sign in and share"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
