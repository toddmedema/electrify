import { revealControl } from "../components/base/RevealControl";
import { isTvLayout } from "../TvLayout";
import type { AppStore } from "../Store";
import type {
  DesktopBridge,
  DesktopInputAction,
  DesktopInputContext,
  DesktopInputFrame,
} from "../Desktop";
import type { MenuCue } from "../audio/MenuFeedback";
import { setSpeed } from "../reducers/Game";
import { navigate } from "../reducers/Card";
import {
  backInput,
  confirmInput,
  inputScope,
  moveInputFocus,
  visibleControls,
} from "./InputNavigation";
import {
  applyTextInput,
  availableTextControl,
  focusedTextControl,
  highlightedTextOption,
  textInputRequest,
} from "./InputText";

import {
  getInputPresentation,
  resetInputPresentation,
  updateInputPresentation as present,
} from "./InputPresentation";
export {
  getInputPresentation,
  subscribeInputPresentation,
} from "./InputPresentation";

const overlay = (scope: HTMLElement) =>
  scope.matches(
    '[role="dialog"],[role="menu"],[role="listbox"],.MuiModal-root,[data-manual-help],[data-scenario-choice],[data-data-center-guide]',
  );

/** Semantic actions operate the existing controls, including their tutorial and co-op rules. */
export function startDesktopInput(
  store: Pick<AppStore, "getState" | "subscribe" | "dispatch">,
  desktop: DesktopBridge,
  feedback: (cue: MenuCue) => void = () => {},
): () => void {
  if (!desktop.setInputContext || !desktop.onInput) return () => {};
  let live = true;
  let foreground = true;
  let context: DesktopInputContext | undefined;
  let generation = 0;
  let ready = false;
  let pauseLocked = false;
  let runningSpeed = "NORMAL";
  let previousState = store.getState();
  let chartFrame: number | undefined;
  let editingText = false;
  let choosingTextOption: HTMLElement | null = null;
  const gameplay = () =>
    !!document.querySelector(".base_main:not([inert]) .gameWorkspace");
  const controls = () => visibleControls(inputScope());
  const speedButtons = () =>
    // A roving group exposes one tab stop; semantic speed actions address every option.
    visibleControls(inputScope(), { tabStopsOnly: false }).filter((button) =>
      button.matches(".speedToggles button"),
    );
  const releasePause = () => {
    pauseLocked = false;
    present({ pausedAfterDisconnect: false });
  };
  const pauseDisconnected = () => {
    const game = store.getState().game;
    if (!game.inGame) return;
    if (game.speed !== "PAUSED") runningSpeed = game.speed;
    pauseLocked = true;
    present({ pausedAfterDisconnect: true });
    store.dispatch(setSpeed("PAUSED"));
  };
  const updateFrame = (frame: DesktopInputFrame) => {
    if (!frame.connected)
      delete document.documentElement.dataset.controllerInput;
    present({
      connected: frame.connected,
      glyphs: frame.glyphs,
      active: frame.connected && getInputPresentation().active,
    });
    if (frame.disconnected) pauseDisconnected();
  };
  const sync = () => {
    if (!live) return;
    const state = store.getState();
    if (!state.game.inGame && pauseLocked) releasePause();
    // A dialog closing or a window regaining focus must not restart a disconnected run.
    if (pauseLocked && state.game.inGame && state.game.speed !== "PAUSED") {
      store.dispatch(setSpeed("PAUSED"));
      return;
    }
    const next = gameplay() && !overlay(inputScope()) ? "Gameplay" : "Menu";
    if (next === context) return;
    context = next;
    ready = false;
    present({ context: next });
    const request = ++generation;
    void desktop.setInputContext!(next)
      .then((frame) => {
        if (!live || request !== generation) return;
        updateFrame(frame);
        ready = true;
      })
      .catch(() => {
        if (!live || request !== generation) return;
        present({ active: false, connected: false, glyphs: {} });
      });
  };
  /** Change the owning seat's requested speed, preserving its last running choice and ready-up intent.
   * Solo input activates only the speed buttons available in the current layout. */
  const speed = (action: "pause" | "speedUp" | "speedDown") => {
    const clock = store.getState().game.multiplayer?.clock;
    if (clock) {
      const speeds = ["PAUSED", "SLOW", "NORMAL", "FAST", "ULTRA"] as const;
      const selected = clock?.selectedSpeed ?? "PAUSED";
      if (selected !== "PAUSED") runningSpeed = selected;
      const index = Math.max(0, speeds.indexOf(selected));
      const next =
        action === "pause"
          ? selected === "PAUSED" || (clock?.readyRequired && !clock.ready)
            ? (speeds.find((value) => value === runningSpeed) ?? "NORMAL")
            : "PAUSED"
          : speeds[
              Math.max(
                0,
                Math.min(
                  speeds.length - 1,
                  index + (action === "speedUp" ? 1 : -1),
                ),
              )
            ];
      releasePause();
      store.dispatch(setSpeed(next));
      return;
    }
    const buttons = speedButtons();
    if (!buttons.length) return;
    const selected = buttons.find(
      (button) => button.getAttribute("aria-pressed") === "true",
    );
    const value = selected?.getAttribute("value");
    if (value && value !== "PAUSED") runningSpeed = value;
    const index = Math.max(0, buttons.indexOf(selected!));
    const next =
      action === "pause"
        ? value === "PAUSED"
          ? (buttons.find(
              (button) => button.getAttribute("value") === runningSpeed,
            ) ?? buttons[1])
          : buttons[0]
        : buttons[
            Math.max(
              0,
              Math.min(
                buttons.length - 1,
                index + (action === "speedUp" ? 1 : -1),
              ),
            )
          ];
    releasePause();
    next?.click();
  };
  const pane = (delta: number) => {
    const buttons = controls().filter((button) =>
      button.matches(".gameActionDock button"),
    );
    const active =
      document.activeElement?.closest<HTMLElement>("[data-game-tool]")?.dataset
        .gameTool ??
      (isTvLayout()
        ? document.querySelector<HTMLElement>(".gameToolPanel:not([hidden])")
            ?.dataset.gameTool
        : undefined);
    const opened = buttons.findIndex(
      (button) => button.getAttribute("aria-controls") === `tool-${active}`,
    );
    const current = active ? opened + 1 : 0;
    const next = (current + delta + buttons.length + 1) % (buttons.length + 1);
    if (next === 0) {
      store.dispatch(navigate("FACILITIES"));
      const fleet = document.querySelector<HTMLElement>(
        ".base_main:not([inert]) .gameFleet",
      );
      if (fleet && !isTvLayout()) visibleControls(fleet)[0]?.focus();
    } else {
      const button = buttons[next - 1];
      const panelId = button.getAttribute("aria-controls");
      if (!panelId) button.click();
      const id = panelId ?? button.getAttribute("aria-controls");
      const panel = id ? document.getElementById(id) : null;
      if (panel && !isTvLayout()) visibleControls(panel)[0]?.focus();
    }
  };
  const chart = (delta: number) => {
    const charts = controls().filter((element) =>
      element.matches('.accessibleChart > [role="img"][tabindex="0"]'),
    );
    if (!charts.length) {
      if (
        document.querySelector(
          '.gameStage[data-layout="sheet"] .gameToolPanel:not([hidden])',
        )
      ) {
        store.dispatch(navigate("FACILITIES"));
        if (chartFrame !== undefined) cancelAnimationFrame(chartFrame);
        chartFrame = requestAnimationFrame(() => {
          chartFrame = undefined;
          if (
            live &&
            foreground &&
            store.getState().card.name === "FACILITIES" &&
            !overlay(inputScope())
          )
            chart(delta);
        });
      }
      return;
    }
    const current = charts.indexOf(document.activeElement as HTMLElement);
    const next =
      current < 0
        ? delta > 0
          ? 0
          : charts.length - 1
        : (current + delta + charts.length) % charts.length;
    charts[next].focus();
    revealControl(charts[next]);
  };
  /** Apply controller intent to real focused controls in this document's current input scope.
   * Couch menu actions cross the authenticated shell route; company tool actions remain local. */
  const act = (action: DesktopInputAction) => {
    const scope = inputScope();
    if (action === "menu" || action === "menuAlt") {
      if (window.electrifyCouch?.role === "seat")
        window.electrifyCouch.post({
          kind: "global-menu",
          requestId: crypto.randomUUID(),
        });
      else if (document.querySelector("[data-couch-shell]"))
        window.dispatchEvent(new CustomEvent("electrify:couch-menu"));
      else {
        if (action === "menu" && context === "Gameplay") speed("pause");
        else act("back");
        return;
      }
      feedback("confirm");
    } else if (["up", "down", "left", "right"].includes(action)) {
      const textControl = focusedTextControl();
      moveInputFocus(action as "up" | "down" | "left" | "right");
      choosingTextOption =
        (action === "up" || action === "down") &&
        textControl &&
        highlightedTextOption(textControl)
          ? textControl
          : null;
      feedback("select");
    } else if (action === "confirm") {
      const textControl = focusedTextControl();
      if (
        textControl &&
        desktop.showTextInput &&
        !(
          choosingTextOption === textControl &&
          highlightedTextOption(textControl)
        )
      ) {
        choosingTextOption = null;
        editingText = true;
        const request = textInputRequest(textControl);
        void desktop
          .showTextInput(request)
          .then((result) => {
            if (
              !live ||
              !textControl.isConnected ||
              !availableTextControl(textControl)
            )
              return;
            if (result.status === "submitted") {
              applyTextInput(textControl, result.text);
              choosingTextOption = textControl;
            }
          })
          .catch(() => {
            // Steam/Big Picture may be unavailable. Physical text entry still works.
          })
          .finally(() => {
            editingText = false;
            if (
              live &&
              textControl.isConnected &&
              availableTextControl(textControl)
            )
              textControl.focus({ preventScroll: true });
          });
        feedback("confirm");
        return;
      }
      const target = document.activeElement as HTMLElement | null;
      choosingTextOption = null;
      if (target && speedButtons().includes(target)) releasePause();
      confirmInput();
      feedback("confirm");
    } else if (action === "back") {
      choosingTextOption = null;
      const blocked = overlay(scope);
      const cardBefore = store.getState().card;
      if (!backInput() && !blocked && store.getState().card === cardBefore) {
        if (gameplay()) {
          if (window.electrifyCouch?.role === "seat")
            window.electrifyCouch.post({
              kind: "global-menu",
              requestId: crypto.randomUUID(),
            });
          else
            document
              .querySelector<HTMLElement>(
                ".base_main:not([inert]) .gameMenuButton",
              )
              ?.click();
        } else
          controls()
            .find((button) => button.getAttribute("aria-label") === "Back")
            ?.click();
      }
      feedback("back");
    } else if (!overlay(scope) && gameplay()) {
      if (action === "pause" || action === "speedUp" || action === "speedDown")
        speed(action);
      else if (action === "previousPane" || action === "nextPane")
        pane(action === "nextPane" ? 1 : -1);
      else if (action === "build") {
        const button = controls().find((element) => element.id === "buildNav");
        if (button?.getAttribute("aria-expanded") === "false") button.click();
      } else if (action === "previousChart" || action === "nextChart")
        chart(action === "nextChart" ? 1 : -1);
    }
  };
  const stopInput = desktop.onInput((frame) => {
    if (!live) return;
    updateFrame(frame);
    sync();
    if (
      !ready ||
      editingText ||
      !foreground ||
      (!window.electrifyCouch && document.visibilityState === "hidden") ||
      store.getState().saves.transitioning ||
      !frame.connected ||
      !frame.actions.length
    )
      return;
    document.documentElement.dataset.controllerInput = "true";
    present({ active: true });
    // Prefer one-shot intent over a held direction repeating in the same sample.
    // One intent per sample also keeps simultaneous buttons out of a newly opened dialog.
    const action =
      frame.actions.find(
        (action) => !["up", "down", "left", "right"].includes(action),
      ) ?? frame.actions[0];
    act(action);
    sync();
  });
  const stopFocus = desktop.onGameFocusChanged((focused) => {
    foreground = focused;
  });
  const stopQuit = desktop.onBeforeQuit(() => {
    foreground = false;
  });
  const stopStore = store.subscribe(() => {
    const next = store.getState();
    const changed =
      next.card !== previousState.card ||
      next.ui.dialog.open !== previousState.ui.dialog.open ||
      next.game.inGame !== previousState.game.inGame ||
      (pauseLocked && next.game.speed !== "PAUSED");
    previousState = next;
    if (changed) sync();
  });
  const surfaceSelector =
    "[role=dialog],[role=menu],[role=listbox],.MuiModal-root,.base_main,.gameWorkspace";
  const observer = new MutationObserver((mutations) => {
    if (
      isTvLayout() &&
      getInputPresentation().active &&
      mutations.some(
        (mutation) =>
          mutation.type === "childList" &&
          mutation.target.contains(document.activeElement),
      )
    )
      scheduleReveal();
    if (
      mutations.some((mutation) =>
        mutation.type === "attributes"
          ? (mutation.target as Element).matches(surfaceSelector)
          : [
              ...Array.from(mutation.addedNodes),
              ...Array.from(mutation.removedNodes),
            ].some(
              (node) =>
                node instanceof Element &&
                (node.matches(surfaceSelector) ||
                  !!node.querySelector(surfaceSelector)),
            ),
      )
    )
      sync();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "hidden", "inert"],
  });
  // TV text, disclosure and chart layout can settle after focus moves. Keep that actual
  // control exposed as its ancestors resize, without changing focus or a remembered scroll.
  let revealFrame: number | undefined;
  function scheduleReveal() {
    if (revealFrame !== undefined) return;
    revealFrame = requestAnimationFrame(() => {
      revealFrame = undefined;
      const target = document.activeElement;
      if (
        isTvLayout() &&
        getInputPresentation().active &&
        target instanceof HTMLElement &&
        inputScope().contains(target)
      )
        revealControl(target);
    });
  }
  const revealObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleReveal)
      : undefined;
  const trackFocus = () => {
    revealObserver?.disconnect();
    const target = document.activeElement;
    if (!isTvLayout() || !(target instanceof HTMLElement)) return;
    for (
      let element: HTMLElement | null = target;
      element;
      element = element.parentElement
    )
      revealObserver?.observe(element);
  };
  document.addEventListener("focusin", trackFocus);
  const pointer = (event: Event) => {
    if (!event.isTrusted) return;
    // The hints own an explicit help action. Keep its trigger mounted through activation.
    if (
      event.target instanceof Element &&
      event.target.closest(".controllerHints")
    )
      return;
    choosingTextOption = null;
    delete document.documentElement.dataset.controllerInput;
    present({ active: false });
  };
  const keyboard = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    pointer(event);
    if (
      !overlay(inputScope()) &&
      gameplay() &&
      !(event.target as HTMLElement)?.matches(
        "input:not([type=range]),textarea,select,[contenteditable=true]",
      ) &&
      ["`", " ", "0", "1", "2", "3", "4"].includes(event.key)
    )
      releasePause();
  };
  const click = (event: MouseEvent) => {
    if (
      event.isTrusted &&
      (event.target as HTMLElement)?.closest(".speedToggles button")
    )
      releasePause();
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("click", click, true);
  sync();
  return () => {
    live = false;
    if (chartFrame !== undefined) cancelAnimationFrame(chartFrame);
    observer.disconnect();
    revealObserver?.disconnect();
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    document.removeEventListener("focusin", trackFocus);
    stopInput();
    stopFocus();
    stopQuit();
    stopStore();
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("click", click, true);
    delete document.documentElement.dataset.controllerInput;
    resetInputPresentation();
  };
}
