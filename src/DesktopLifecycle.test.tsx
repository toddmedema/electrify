import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import App from "./App";
import { DesktopBridge } from "./Desktop";
import { store } from "./Store";
import { delta as gameDelta } from "./reducers/Game";
import { change } from "./reducers/Settings";
import { pause, resume } from "./data/Audio";
import { quit } from "./reducers/GameActions";

jest.mock("./components/CompositorContainer", () => () => null);
jest.mock("./components/base/CloudSavePrompt", () => () => null);
jest.mock("./components/base/SharedGameDialog", () => () => null);
jest.mock("./components/base/ScenarioChoiceDialog", () => () => null);
jest.mock("./CloudSaves", () => ({ startCloudSaves: () => () => {} }));
jest.mock("./SaveSession", () => ({
  startSaveSessions: () => () => {},
  saveSessionMiddleware: () => (next: (action: unknown) => unknown) => next,
}));
jest.mock("./EventToasts", () => ({ startEventToasts: () => () => {} }));
jest.mock("./data/Audio", () => ({
  ...jest.requireActual("./data/Audio"),
  pause: jest.fn(),
  resume: jest.fn(),
}));
jest.mock("./Globals", () => ({
  ...jest.requireActual("./Globals"),
  firebaseAppAuth: undefined,
}));
jest.mock("firebase/auth", () => ({
  ...jest.requireActual("firebase/auth"),
  getAuth: jest.fn(),
}));

it("keeps gameplay and audio paused through visibility/pageshow events until native focus returns", () => {
  const focusListeners = new Set<(focused: boolean) => void>();
  const focused = (value: boolean) =>
    focusListeners.forEach((listener) => listener(value));
  const unsubscribe = jest.fn();
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: (listener: (focused: boolean) => void) => {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
        unsubscribe();
      };
    },
    onStateChanged: () => () => {},
    onBeforeQuit: () => () => {},
    getState: jest.fn().mockResolvedValue({ steam: {} }),
    setActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as DesktopBridge;
  store.dispatch(gameDelta({ inGame: true, speed: "NORMAL" }));
  store.dispatch(change({ audioEnabled: true }));
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
  try {
    act(() => focused(false));
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(pause).toHaveBeenCalled();
    (resume as jest.Mock).mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(resume).not.toHaveBeenCalled();
    act(() => focused(true));
    expect(store.getState().game.speed).toBe("NORMAL");
    expect(resume).toHaveBeenCalled();
  } finally {
    view.unmount();
    delete window.electrifyDesktop;
    store.dispatch(quit());
  }
  expect(unsubscribe).toHaveBeenCalled();
  expect(focusListeners.size).toBe(0);
});
