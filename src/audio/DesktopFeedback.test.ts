import { fireEvent, within } from "@testing-library/react";
import type { AppStore, RootState } from "../Store";
import type { DesktopBridge } from "../Desktop";
import type { GameEventType } from "../Types";
import { bindDesktopMenuInput, startDesktopFeedback } from "./DesktopFeedback";

const mockAudioStop = jest.fn();
const mockAudioPlay = jest.fn();
const mockHapticStop = jest.fn();
const mockHapticPulse = jest.fn();
jest.mock("./MenuFeedback", () => ({
  MenuFeedbackAudio: function (
    preferences: () => { audioEnabled?: boolean; soundEffectsVolume: number },
    foreground: () => boolean,
  ) {
    return {
      stop: mockAudioStop,
      play: (cue: string) => {
        if (
          foreground() &&
          preferences().audioEnabled &&
          preferences().soundEffectsVolume
        )
          mockAudioPlay(cue);
        return Promise.resolve();
      },
    };
  },
  ControllerFeedback: function (allowed: () => boolean) {
    return {
      stop: mockHapticStop,
      play: (cue: string) => {
        if (allowed()) mockHapticPulse(cue);
      },
    };
  },
}));

function menu() {
  const root = document.createElement("div");
  root.className = "keyboardMenu";
  root.innerHTML =
    '<button>Start</button><button>Settings</button><button aria-label="Back">Back</button><input type="checkbox" aria-label="Sound"><select><option value="a">A</option><option value="b">B</option></select>';
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = "";
  delete window.electrifyDesktop;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it("sounds only user navigation, ignores autofocus/held keys/popups, and labels confirm/back", () => {
  const root = menu();
  const buttons = within(root).getAllByRole("button");
  const play = jest.fn();
  const stop = bindDesktopMenuInput(
    play,
    () => true,
    () => true,
    () => true,
  );
  buttons[0].focus();
  expect(play).not.toHaveBeenCalled();
  fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
  buttons[1].focus();
  expect(play).toHaveBeenLastCalledWith("select");
  for (let index = 0; index < 5; index++) {
    fireEvent.keyDown(buttons[1], { key: "ArrowDown", repeat: true });
    buttons[index % 2].focus();
  }
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(buttons[0], { key: "ArrowDown" });
  fireEvent.click(buttons[0]);
  expect(play).toHaveBeenLastCalledWith("confirm");
  fireEvent.click(buttons[2]);
  expect(play).toHaveBeenLastCalledWith("back");
  fireEvent.keyDown(buttons[2], { key: "Escape" });
  expect(play).toHaveBeenLastCalledWith("back");
  const count = play.mock.calls.length;
  fireEvent.keyDown(buttons[2], { key: "Escape", repeat: true });
  const popup = document.createElement("div");
  popup.setAttribute("role", "dialog");
  document.body.appendChild(popup);
  fireEvent.keyDown(buttons[2], { key: "Escape" });
  expect(play).toHaveBeenCalledTimes(count);
  stop();
  fireEvent.click(buttons[0]);
  expect(play).toHaveBeenCalledTimes(count);
});

it("rejects programmatic gestures and clears a held key when foreground is lost", () => {
  const root = menu();
  const button = within(root).getByRole("button", { name: "Start" });
  const play = jest.fn();
  const stopUntrusted = bindDesktopMenuInput(
    play,
    () => false,
    () => true,
  );
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "ArrowDown" });
  expect(play).not.toHaveBeenCalled();
  stopUntrusted();
  const stop = bindDesktopMenuInput(
    play,
    () => false,
    () => true,
    () => true,
  );
  fireEvent.keyDown(button, { key: "Enter", repeat: true });
  stop.reset(); // Blur/overlay/disconnect resets it even if keyup happened outside the window.
  fireEvent.click(button);
  expect(play).toHaveBeenCalledTimes(1);
  stop();
});

it("reads preferences after the clicked control's handler so mute-off has no final beep", () => {
  const root = menu();
  const checkbox = within(root).getByRole("checkbox");
  let enabled = true;
  const play = jest.fn();
  checkbox.addEventListener("click", () => {
    enabled = false;
  });
  const stop = bindDesktopMenuInput(
    (cue) => {
      if (enabled) play(cue);
    },
    () => true,
    () => true,
    () => true,
  );
  fireEvent.click(checkbox);
  expect(play).not.toHaveBeenCalled();
  stop();
});

function harness() {
  let state = {
    settings: {
      audioEnabled: false,
      soundEffectsVolume: 0,
      controllerVibrationEnabled: true,
    },
    game: { inGame: true, speed: "NORMAL", date: { minute: 10 }, eventLog: [] },
    ui: { evidenceRunId: 1, victory: null, dialog: { open: false, title: "" } },
    saves: { activeId: "one", transitioning: false },
    card: { name: "MAIN_MENU" },
  } as unknown as RootState;
  let notify = () => {};
  const store = {
    getState: () => state,
    subscribe: (callback: () => void) => {
      notify = callback;
      return jest.fn();
    },
  } as unknown as AppStore;
  let focus!: (value: boolean) => void;
  let quit!: () => void;
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: (callback: (focused: boolean) => void) => {
      focus = callback;
      return jest.fn();
    },
    onBeforeQuit: (callback: () => void) => {
      quit = callback;
      return jest.fn();
    },
  } as unknown as DesktopBridge;
  const reduced = {
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  jest
    .spyOn(window, "matchMedia")
    .mockReturnValue(reduced as unknown as MediaQueryList);
  jest.spyOn(document, "hasFocus").mockReturnValue(true);
  const stop = startDesktopFeedback(store);
  const update = (changes: Partial<RootState>) => {
    state = { ...state, ...changes };
    notify();
  };
  const event = (id: number): GameEventType => ({
    id,
    kind: "CONSTRUCTION",
    label: "Jan 2020",
    message: "Ready",
  });
  const complete = (id: number) =>
    update({
      game: { ...state.game, eventLog: [event(id), ...state.game.eventLog] },
    });
  return { stop, update, state: () => state, complete, focus, quit, reduced };
}

it("rumbles once for a live committed milestone even while sound is muted", () => {
  const h = harness();
  expect(mockHapticPulse).not.toHaveBeenCalled();
  h.complete(1);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  expect(mockHapticPulse).toHaveBeenCalledWith("milestone");
  h.update({ settings: { ...h.state().settings, theme: "dark" } });
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  expect(mockAudioPlay).not.toHaveBeenCalled();
  h.stop();
});

it("ignores replay, restored history, save transitions, rewinds and failed outcomes", () => {
  const h = harness();
  h.update({
    game: { ...h.state().game, replayPlayback: { actions: [], index: 0 } },
  });
  h.complete(1);
  h.update({
    game: { ...h.state().game, replayPlayback: undefined },
    ui: { ...h.state().ui, evidenceRunId: 2 },
  });
  h.update({
    saves: { ...h.state().saves, activeId: "two", transitioning: true },
  });
  h.complete(2);
  h.update({ saves: { ...h.state().saves, transitioning: false } });
  h.update({
    game: {
      ...h.state().game,
      date: { ...h.state().game.date, minute: 0 },
      eventLog: [
        { id: 3, kind: "CONSTRUCTION", label: "Jan", message: "Restored" },
      ],
    },
  });
  h.update({
    ui: {
      ...h.state().ui,
      victory: { outcome: "bankrupt" } as RootState["ui"]["victory"],
    },
  });
  expect(mockHapticPulse).not.toHaveBeenCalled();
  h.complete(4);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  h.stop();
});

it("stops and suppresses feedback for native overlay/blur, pause, disconnect, reduced motion and quit", () => {
  const h = harness();
  h.complete(1);
  h.focus(false);
  expect(mockAudioStop).toHaveBeenCalled();
  expect(mockHapticStop).toHaveBeenCalled();
  h.complete(2);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  h.focus(true);
  fireEvent.blur(window);
  h.complete(3);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  fireEvent.focus(window);
  h.update({ game: { ...h.state().game, speed: "PAUSED" } });
  h.complete(4);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  h.update({ game: { ...h.state().game, speed: "NORMAL" } });
  h.complete(5);
  expect(mockHapticPulse).toHaveBeenCalledTimes(2);
  fireEvent(window, new Event("gamepaddisconnected"));
  h.reduced.matches = true;
  h.complete(6);
  expect(mockHapticPulse).toHaveBeenCalledTimes(2);
  h.reduced.matches = false;
  const resets = mockHapticStop.mock.calls.length;
  h.quit();
  expect(mockHapticStop).toHaveBeenCalledTimes(resets + 1);
  h.stop();
});

it("stops for quit and accepts a fresh user gesture after cancellation without a focus event", () => {
  const listeners = jest.spyOn(document, "addEventListener");
  const h = harness();
  h.update({
    settings: {
      ...h.state().settings,
      audioEnabled: true,
      soundEffectsVolume: 0.4,
    },
  });
  const button = within(menu()).getByRole("button", { name: "Start" });
  const onClick = listeners.mock.calls.find(
    ([name]) => name === "click",
  )?.[1] as EventListener;
  // JSDOM clicks are untrusted; exercise the installed listener with a browser gesture.
  const gesture = { target: button, isTrusted: true } as unknown as MouseEvent;
  onClick(gesture);
  expect(mockAudioPlay).toHaveBeenCalledTimes(1);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  // DesktopSaves pauses the running game before its quit checkpoint.
  h.update({ game: { ...h.state().game, speed: "PAUSED" } });
  const resets = mockHapticStop.mock.calls.length;
  h.quit();
  expect(mockAudioStop).toHaveBeenCalled();
  expect(mockHapticStop).toHaveBeenCalledTimes(resets + 1);
  h.complete(1);
  expect(mockHapticPulse).toHaveBeenCalledTimes(1);
  h.update({ game: { ...h.state().game, speed: "NORMAL" } });
  h.complete(2);
  expect(mockHapticPulse).toHaveBeenCalledTimes(2);
  expect(mockHapticPulse).toHaveBeenLastCalledWith("milestone");
  onClick(gesture);
  expect(mockAudioPlay).toHaveBeenCalledTimes(2);
  expect(mockHapticPulse).toHaveBeenCalledTimes(3);
  h.stop();
});
