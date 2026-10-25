import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { cloudSavePromptVisible } from "../../reducers/GameActions";
import { getLocalStorage, login } from "../../Globals";
import { setStorageKeyValue } from "../../LocalStorage";
import { isDesktopApp } from "../../Desktop";
import SignInButtons from "./SignInButtons";

export const CLOUD_PROMPT_KEY = "electrify-cloud-save-prompt-seen";
export default function CloudSavePrompt(): React.JSX.Element {
  const saves = useAppSelector((state) => state.saves);
  const dispatch = useAppDispatch();
  const seen = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const visible =
    !(process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) &&
    open &&
    saves.cloudState === "signedOut";
  useEffect(() => {
    if (!visible) return;
    dispatch(cloudSavePromptVisible(true));
    return () => {
      dispatch(cloudSavePromptVisible(false));
    };
  }, [dispatch, visible]);
  useEffect(() => {
    if (
      (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) ||
      seen.current ||
      saves.cloudState !== "signedOut" ||
      !saves.cloudPromptRequested ||
      new URLSearchParams(window.location.search).has("game")
    )
      return;
    try {
      if (getLocalStorage().getItem(CLOUD_PROMPT_KEY)) return;
    } catch {
      return;
    }
    setStorageKeyValue(CLOUD_PROMPT_KEY, true);
    seen.current = true;
    setOpen(true);
  }, [saves.cloudState, saves.cloudPromptRequested]);
  const dismiss = () => {
    if (!busy) setOpen(false);
  };
  return (
    <Dialog
      open={visible}
      onClose={dismiss}
      maxWidth="xs"
      fullWidth
      aria-labelledby="cloud-prompt-title"
      aria-describedby="cloud-prompt-description"
    >
      <DialogTitle id="cloud-prompt-title">
        Back up your saves to the cloud
      </DialogTitle>
      <DialogContent>
        <Typography id="cloud-prompt-description">
          Sign in with Google or Apple to keep a private cloud backup and
          continue on another device. Your games still save and load on this
          device, even offline.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          You can also sign in later from Saved games.
        </Typography>
      </DialogContent>
      <DialogActions
        sx={{
          flexDirection: "column",
          gap: 1,
          px: 3,
          pb: 2,
          "& > :not(style) ~ :not(style)": { ml: 0 },
        }}
      >
        <SignInButtons
          onSignIn={async (provider) => {
            setBusy(true);
            try {
              const ok = await login(provider);
              if (ok) setOpen(false);
              return ok;
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button disabled={busy} onClick={dismiss}>
          Continue without syncing
        </Button>
      </DialogActions>
    </Dialog>
  );
}
