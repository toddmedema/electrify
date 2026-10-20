import type { AppStore } from "../Store";
import { getDesktop } from "../Desktop";
import { soundEffectsForUpdate, SoundEventSnapshot } from "./SoundEvents";
import { ControllerFeedback, MenuFeedbackAudio, MenuCue } from "./MenuFeedback";

const controlSelector = "button,a[href],input,select,textarea,[role=button]";
const popupSelector = "[role=dialog],[role=menu],[role=listbox]";

/** A desktop-only adapter around native DOM gestures; shared web menu code stays unchanged. */
export function bindDesktopMenuInput(
  play: (cue: MenuCue) => void,
  settingsOpen: () => boolean,
  foreground: () => boolean,
  trusted = (event: Event) => event.isTrusted,
) {
  let navigation = false;
  let keyboardClick: Element | null = null;
  let held = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const control = (target: EventTarget | null) => {
    const element =
      target instanceof Element ? target.closest(controlSelector) : null;
    return element?.closest(".keyboardMenu") &&
      !element.matches(":disabled,[aria-disabled=true]")
      ? element
      : null;
  };
  const clear = () => {
    navigation = false;
    keyboardClick = null;
    clearTimeout(clearTimer);
  };
  const onKey = (event: KeyboardEvent) => {
    clear();
    if (
      !trusted(event) ||
      event.defaultPrevented ||
      !foreground() ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.shiftKey && event.key !== "Tab") ||
      !control(event.target) ||
      document.querySelector(popupSelector)
    )
      return;
    held = event.repeat;
    if (held) return;
    navigation = event.key.startsWith("Arrow") || event.key === "Tab";
    keyboardClick = event.key === "Enter" ? control(event.target) : null;
    if (event.key === "Escape" && settingsOpen()) play("back");
    clearTimer = setTimeout(clear, 0);
  };
  const onFocus = (event: FocusEvent) => {
    if (navigation && foreground() && control(event.target)) {
      navigation = false;
      play("select");
    }
  };
  const onClick = (event: MouseEvent) => {
    const target = control(event.target);
    if (
      !target ||
      !foreground() ||
      held ||
      !(trusted(event) || keyboardClick === target) ||
      target.matches("select,textarea,input:not([type=checkbox])")
    )
      return;
    keyboardClick = null;
    play(target.getAttribute("aria-label") === "Back" ? "back" : "confirm");
  };
  const onChange = (event: Event) => {
    if (
      trusted(event) &&
      foreground() &&
      !held &&
      control(event.target)?.matches("select")
    )
      play("confirm");
  };
  const onKeyUp = () => {
    held = false;
    clear();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("focusin", onFocus);
  // React preference updates run first: switching Sound off never emits a last beep.
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  const reset = () => {
    held = false;
    clear();
  };
  const dispose = () => {
    clear();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("click", onClick);
    document.removeEventListener("change", onChange);
  };
  return Object.assign(dispose, { reset });
}

function snapshot(store: AppStore): SoundEventSnapshot {
  const { game, ui } = store.getState();
  return {
    inGame: game.inGame,
    events: game.eventLog || [],
    victoryOpen: ui.victory?.outcome === "completed",
    dialogOpen: ui.dialog.open,
    dialogTitle: ui.dialog.title,
  };
}

export function startDesktopFeedback(store: AppStore) {
  const desktop = getDesktop();
  if (!desktop)
    return Object.assign(() => {}, { controllerCue: (_cue: MenuCue) => {} });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let nativeFocused = true;
  let windowFocused = document.hasFocus();
  let disposed = false;
  const foreground = () =>
    !disposed &&
    nativeFocused &&
    windowFocused &&
    document.visibilityState !== "hidden";
  const audio = new MenuFeedbackAudio(
    () => store.getState().settings,
    foreground,
  );
  const haptics = new ControllerFeedback(() => {
    const { settings, game } = store.getState();
    return (
      foreground() &&
      !reduced.matches &&
      !!settings.controllerVibrationEnabled &&
      !(game.inGame && game.speed === "PAUSED")
    );
  });
  const stop = () => {
    stopInput.reset();
    audio.stop();
    haptics.stop();
  };
  const controllerCue = (cue: MenuCue) => {
    void audio.play(cue);
    if (cue === "confirm") haptics.play("confirm");
  };
  const stopInput = bindDesktopMenuInput(
    controllerCue,
    () => store.getState().card.name === "SETTINGS",
    foreground,
  );
  let previous = snapshot(store);
  let previousState = store.getState();
  const stopStore = store.subscribe(() => {
    const current = store.getState();
    if (
      !current.settings.audioEnabled ||
      current.settings.soundEffectsVolume === 0
    )
      audio.stop();
    if (
      !current.settings.controllerVibrationEnabled ||
      (previousState.game.inGame && !current.game.inGame) ||
      (previousState.game.speed !== "PAUSED" && current.game.speed === "PAUSED")
    )
      haptics.stop();
    const next = snapshot(store);
    const liveSegment =
      current.game.inGame &&
      previousState.game.inGame &&
      !current.game.replayPlayback &&
      !previousState.game.replayPlayback &&
      !current.saves?.transitioning &&
      !previousState.saves?.transitioning &&
      current.ui.evidenceRunId === previousState.ui.evidenceRunId &&
      current.saves?.activeId === previousState.saves?.activeId &&
      current.game.date.minute >= previousState.game.date.minute;
    if (
      liveSegment &&
      soundEffectsForUpdate(previous, next).some((effect) =>
        ["VICTORY", "CONSTRUCTION_COMPLETE", "POWER_RESTORED"].includes(effect),
      )
    )
      haptics.play("milestone");
    previous = next;
    previousState = current;
  });
  const onBlur = () => {
    windowFocused = false;
    stop();
  };
  const onFocus = () => {
    windowFocused = true;
  };
  const onVisibility = () => {
    if (!foreground()) stop();
  };
  const onReducedMotion = () => {
    if (reduced.matches) haptics.stop();
  };
  const stopNative = desktop.onGameFocusChanged((focused) => {
    nativeFocused = focused;
    if (!focused) stop();
  });
  const stopQuit = desktop.onBeforeQuit(stop);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("gamepaddisconnected", stop);
  reduced.addEventListener("change", onReducedMotion);
  return Object.assign(
    () => {
      disposed = true;
      stop();
      stopInput();
      stopStore();
      stopNative();
      stopQuit();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("gamepaddisconnected", stop);
      reduced.removeEventListener("change", onReducedMotion);
    },
    { controllerCue },
  );
}
