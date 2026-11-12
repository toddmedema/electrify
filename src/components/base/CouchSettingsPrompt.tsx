import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@mui/material";
import { useDesktopState } from "../../DesktopState";
import { getLocalStorage } from "../../Globals";
import { setStorageKeyValue } from "../../LocalStorage";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";
import {
  getInputPresentation,
  subscribeInputPresentation,
} from "../../desktop/InputPresentation";

function hasReceipt(): boolean {
  if (getLocalStorage().getItem("couchPromptShown") === "true") return true;
  // Either valid legacy choice already answered the old couch suggestion. Its independent
  // display preferences migrate in Settings; malformed text is not an intentional answer.
  const legacy = getLocalStorage().getItem("tvMode");
  return legacy === "true" || legacy === "false";
}

/** A title-screen suggestion in normal flow: it never opens a popup or moves focus. */
export default function CouchSettingsPrompt() {
  const desktop = useDesktopState();
  const input = useSyncExternalStore(
    subscribeInputPresentation,
    getInputPresentation,
  );
  const onTitleScreen = useAppSelector(
    (state) => state.card.name === "MAIN_MENU",
  );
  const dispatch = useAppDispatch();
  const received = useRef(hasReceipt());
  const [open, setOpen] = useState(false);
  const signals = desktop?.steam.presentation;
  const qualifies =
    input.connected ||
    signals?.bigPicture === true ||
    signals?.remotePlayTv === true;
  useEffect(() => {
    if (!onTitleScreen) setOpen(false);
    else if (!received.current && qualifies) setOpen(true);
  }, [onTitleScreen, qualifies]);
  useEffect(() => {
    if (!open || !onTitleScreen) return;
    // Persist after this notice has committed, while keeping this launch's notice open.
    received.current = true;
    setStorageKeyValue("couchPromptShown", true);
  }, [open, onTitleScreen]);
  if (!open || !onTitleScreen) return null;
  return (
    <aside
      className="couchSettingsPrompt"
      aria-label="Couch settings suggestion"
    >
      <p>Playing from the couch? Try larger controls and a focused layout.</p>
      <div className="couchSettingsPromptActions">
        <Button
          variant="contained"
          onClick={() => {
            dispatch(change({ interfaceScale: 1.5, workspace: "single" }));
            setOpen(false);
          }}
        >
          Use couch settings
        </Button>
        <Button onClick={() => setOpen(false)}>Dismiss</Button>
      </div>
    </aside>
  );
}
