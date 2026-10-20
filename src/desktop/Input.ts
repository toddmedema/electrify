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

interface InputPresentation {
  active: boolean;
  connected: boolean;
  pausedAfterDisconnect: boolean;
  context: DesktopInputContext;
  glyphs: DesktopInputFrame["glyphs"];
}
const initial: InputPresentation = {
  active: false,
  connected: false,
  pausedAfterDisconnect: false,
  context: "Menu",
  glyphs: {},
};
let presentation = initial;
const listeners = new Set<() => void>();
export const getInputPresentation = () => presentation;
export const subscribeInputPresentation = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function present(update: Partial<InputPresentation>) {
  const next = { ...presentation, ...update };
  const glyphs = Object.entries(next.glyphs);
  const sameGlyphs =
    next.glyphs === presentation.glyphs ||
    (glyphs.length === Object.keys(presentation.glyphs).length &&
      glyphs.every(([action, glyph]) => {
        const previous = presentation.glyphs[action as DesktopInputAction];
        return (
          previous?.label === glyph.label && previous?.image === glyph.image
        );
      }));
  if (
    sameGlyphs &&
    next.active === presentation.active &&
    next.connected === presentation.connected &&
    next.pausedAfterDisconnect === presentation.pausedAfterDisconnect &&
    next.context === presentation.context
  )
    return;
  if (sameGlyphs) next.glyphs = presentation.glyphs;
  presentation = next;
  listeners.forEach((listener) => listener());
}
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
      active: frame.connected && presentation.active,
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
  const speed = (action: "pause" | "speedUp" | "speedDown") => {
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
        .gameTool;
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
      if (fleet) visibleControls(fleet)[0]?.focus();
    } else {
      const button = buttons[next - 1];
      const panelId = button.getAttribute("aria-controls");
      if (!panelId) button.click();
      const id = panelId ?? button.getAttribute("aria-controls");
      const panel = id ? document.getElementById(id) : null;
      if (panel) visibleControls(panel)[0]?.focus();
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
    charts[next].scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  };
  const act = (action: DesktopInputAction) => {
    const scope = inputScope();
    if (["up", "down", "left", "right"].includes(action)) {
      moveInputFocus(action as "up" | "down" | "left" | "right");
      feedback("select");
    } else if (action === "confirm") {
      const target = document.activeElement as HTMLElement | null;
      if (target && speedButtons().includes(target)) releasePause();
      confirmInput();
      feedback("confirm");
    } else if (action === "back") {
      const blocked = overlay(scope);
      const cardBefore = store.getState().card;
      if (!backInput() && !blocked && store.getState().card === cardBefore) {
        if (gameplay())
          document
            .querySelector<HTMLElement>(
              ".base_main:not([inert]) .gameMenuButton",
            )
            ?.click();
        else
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
      !foreground ||
      document.visibilityState === "hidden" ||
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
  const pointer = (event: Event) => {
    if (!event.isTrusted) return;
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
    stopInput();
    stopFocus();
    stopQuit();
    stopStore();
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("click", click, true);
    delete document.documentElement.dataset.controllerInput;
    present(initial);
  };
}
