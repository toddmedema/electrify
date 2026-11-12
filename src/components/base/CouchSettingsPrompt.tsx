import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@mui/material";
import { useDesktopState } from "../../DesktopState";
import { getLocalStorage } from "../../Globals";
import { setStorageKeyValue } from "../../LocalStorage";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";
import { inputScope, moveInputFocus } from "../../desktop/InputNavigation";
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
  useEffect(() => {
    if (!open || !onTitleScreen) return;
    const directions = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    } as const;
    const navigate = (event: KeyboardEvent) => {
      // Controller navigation sends its own widget keys; handle physical keys once.
      const direction = directions[event.key as keyof typeof directions];
      const target = event.target;
      if (
        !event.isTrusted ||
        event.defaultPrevented ||
        !direction ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(target instanceof HTMLElement) ||
        !target.closest("#menuCard,.couchSettingsPrompt") ||
        inputScope() !== target.closest(".appFrame")
      )
        return;
      event.preventDefault();
      moveInputFocus(direction);
    };
    document.addEventListener("keydown", navigate);
    return () => document.removeEventListener("keydown", navigate);
  }, [open, onTitleScreen]);
  const close = () => {
    setOpen(false);
    document
      .querySelector<HTMLElement>("#menuCard [data-main-action]")
      ?.focus({ preventScroll: true });
  };
  if (!open || !onTitleScreen) return null;
  return (
    <aside
      className="couchSettingsPrompt"
      aria-label="Couch settings suggestion"
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !(event.target instanceof Element))
          return;
        const button = event.target.closest<HTMLElement>("button");
        if (button) {
          delete document.documentElement.dataset.touchInput;
          button.focus({ preventScroll: true });
        }
      }}
    >
      <p>Playing from the couch? Try larger controls and a focused layout.</p>
      <div className="couchSettingsPromptActions">
        <Button
          variant="text"
          disableRipple
          onClick={() => {
            dispatch(change({ interfaceScale: 1.5, workspace: "single" }));
            close();
          }}
        >
          Use couch settings
        </Button>
        <Button variant="text" disableRipple onClick={close}>
          Dismiss
        </Button>
      </div>
    </aside>
  );
}
