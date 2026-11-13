import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import CouchSettingsPrompt from "./CouchSettingsPrompt";
import settingsReducer, { initialSettings } from "../../reducers/Settings";
import type { DesktopBridge, DesktopState } from "../../Desktop";
import cardReducer, { navigate } from "../../reducers/Card";
import {
  getInputPresentation,
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";

jest.mock("../../Globals", () => ({
  getLocalStorage: () => globalThis.localStorage,
  logEvent: jest.fn(),
}));
jest.mock("../../data/Audio", () => ({ pause: jest.fn(), resume: jest.fn() }));

let update: (state: DesktopState) => void;
const state = (
  presentation?: DesktopState["steam"]["presentation"],
): DesktopState => ({
  display: { fullscreen: true, width: 1920, height: 1080, resolutions: [] },
  steam: { available: true, online: true, cloudEnabled: false, presentation },
});

function mount(presentation?: DesktopState["steam"]["presentation"]) {
  window.electrifyDesktop = {
    apiVersion: 1,
    getState: () => Promise.resolve(state(presentation)),
    onStateChanged: (callback) => {
      update = callback;
      return () => {};
    },
  } as DesktopBridge;
  const store = configureStore({
    reducer: { settings: settingsReducer, card: cardReducer },
    preloadedState: {
      settings: {
        ...initialSettings,
        interfaceScale: 1.75,
        workspace: "automatic" as const,
        screenEdgePadding: 4 as const,
      },
    },
  });
  const view = render(
    <Provider store={store}>
      <div className="appFrame">
        <main className="base_main" id="menuCard">
          <button data-main-action>Play</button>
        </main>
        <CouchSettingsPrompt />
      </div>
    </Provider>,
  );
  return { store, ...view };
}

const prompt = () =>
  screen.queryByRole("complementary", { name: "Couch settings suggestion" });
afterEach(() => {
  act(() => resetInputPresentation());
  delete window.electrifyDesktop;
  localStorage.clear();
});

it.each([
  { bigPicture: true, steamDeck: false },
  { bigPicture: true, steamDeck: true },
  { bigPicture: true },
  { remotePlayTv: true, steamDeck: true },
])(
  "offers couch settings for Steam presentation %p without changing preferences or focus",
  async (signals) => {
    const { store } = mount();
    const play = screen.getByRole("button", { name: "Play" });
    play.focus();
    await act(async () => undefined);
    act(() => update(state(signals)));
    expect(prompt()).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(play).toHaveFocus();
    expect(localStorage.getItem("couchPromptShown")).toBe("true");
    expect(store.getState().settings).toMatchObject({
      interfaceScale: 1.75,
      workspace: "automatic",
      screenEdgePadding: 4,
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(prompt()).toBeVisible();
  },
);

it("qualifies a connected controller before it becomes the active input, including late startup", async () => {
  mount();
  await act(async () => undefined);
  expect(prompt()).toBeNull();
  act(() => updateInputPresentation({ connected: true }));
  expect(getInputPresentation().active).toBe(false);
  expect(prompt()).toBeVisible();
});

it("applies only scale and Single tool on acceptance, retaining hardware padding", async () => {
  const { store } = mount({ bigPicture: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Use couch settings" }),
  );
  expect(prompt()).toBeNull();
  expect(store.getState().settings).toMatchObject({
    interfaceScale: 1.5,
    workspace: "single",
    screenEdgePadding: 4,
  });
  expect(localStorage.getItem("interfaceScale")).toBe("1.5");
  expect(localStorage.getItem("workspace")).toBe("single");
  expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
});

it.each(["dismiss", "restart"])(
  "remembers having shown the prompt after %s without requiring an answer",
  async (exit) => {
    const { unmount } = mount({ bigPicture: true });
    await screen.findByRole("button", { name: "Dismiss" });
    if (exit === "dismiss")
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    unmount();
    const restored = mount({ remotePlayTv: true });
    await act(async () => undefined);
    act(() => updateInputPresentation({ connected: true }));
    expect(prompt()).toBeNull();
    expect(restored.store.getState().settings).toMatchObject({
      interfaceScale: 1.75,
      workspace: "automatic",
      screenEdgePadding: 4,
    });
  },
);

it("does not repeat when leaving and returning to the title", async () => {
  const { store } = mount({ bigPicture: true });
  await screen.findByRole("button", { name: "Dismiss" });
  act(() =>
    store.dispatch(navigate({ name: "NEW_GAME", skipBrowserHistory: true })),
  );
  expect(prompt()).toBeNull();
  act(() =>
    store.dispatch(navigate({ name: "MAIN_MENU", skipBrowserHistory: true })),
  );
  expect(prompt()).toBeNull();
});

it.each([undefined, { bigPicture: false, steamDeck: true }])(
  "does not consume a launch without a qualifying signal: %p",
  async (signals) => {
    mount(signals);
    await act(async () => undefined);
    expect(prompt()).toBeNull();
    expect(localStorage.getItem("couchPromptShown")).toBeNull();
  },
);

it("waits for a future title visit when detection arrives after play begins", async () => {
  const { store } = mount();
  await act(async () => undefined);
  act(() =>
    store.dispatch(navigate({ name: "NEW_GAME", skipBrowserHistory: true })),
  );
  act(() => update(state({ bigPicture: true })));
  expect(prompt()).toBeNull();
  expect(localStorage.getItem("couchPromptShown")).toBeNull();
  act(() =>
    store.dispatch(navigate({ name: "MAIN_MENU", skipBrowserHistory: true })),
  );
  expect(prompt()).toBeVisible();
});

it.each(["true", "false"])(
  "honors a valid legacy answer %p",
  async (legacy) => {
    localStorage.setItem("tvMode", legacy);
    mount({ bigPicture: true });
    await act(async () => undefined);
    expect(prompt()).toBeNull();
  },
);

it.each(["invalid", "", "null", '"false"'])(
  "does not mistake malformed legacy choice %p for an answer",
  async (legacy) => {
    localStorage.setItem("tvMode", legacy);
    mount({ bigPicture: true });
    expect(
      await screen.findByRole("button", { name: "Dismiss" }),
    ).toBeVisible();
  },
);
