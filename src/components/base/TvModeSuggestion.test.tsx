import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import TvModeSuggestion from "./TvModeSuggestion";
import settingsReducer, {
  change,
  initialSettings,
} from "../../reducers/Settings";
import type { DesktopBridge, DesktopState } from "../../Desktop";
import cardReducer, { navigate } from "../../reducers/Card";

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

function mount(
  presentation?: DesktopState["steam"]["presentation"],
  tvMode?: boolean,
) {
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
    preloadedState: { settings: { ...initialSettings, tvMode } },
  });
  const view = render(
    <Provider store={store}>
      <TvModeSuggestion />
    </Provider>,
  );
  return { store, ...view };
}

afterEach(() => {
  delete window.electrifyDesktop;
  localStorage.clear();
});

it.each([
  { bigPicture: true, steamDeck: false },
  { remotePlayTv: true, steamDeck: true },
])(
  "offers a choice for eligible Steam presentation %p without enabling TV",
  async (signals) => {
    const { store } = mount(signals);
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Playing on a TV?",
    );
    expect(store.getState().settings.tvMode).toBeUndefined();
    expect(localStorage.getItem("tvMode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use TV layout" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(store.getState().settings.tvMode).toBe(true);
    expect(localStorage.getItem("tvMode")).toBe("true");
  },
);

it.each([
  undefined,
  { bigPicture: false, steamDeck: false },
  { bigPicture: true, steamDeck: true },
  { bigPicture: true },
  { remotePlayTv: false },
])(
  "keeps handheld or unknown hardware and normal desktop play unchanged: %p",
  async (signals) => {
    const { store } = mount(signals);
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.getState().settings.tvMode).toBeUndefined();
    expect(localStorage.getItem("tvMode")).toBeNull();
  },
);

it.each([true, false])(
  "a saved %p choice wins over later detection",
  async (choice) => {
    const { store } = mount({ bigPicture: true, steamDeck: false }, choice);
    await act(async () => undefined);
    act(() => update(state({ remotePlayTv: true })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.getState().settings.tvMode).toBe(choice);
  },
);

it("waits for Steam readiness and remembers declining, even if the signals change", async () => {
  const { store } = mount();
  await act(async () => undefined);
  act(() => update(state({ bigPicture: true, steamDeck: false })));
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep desktop layout" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(localStorage.getItem("tvMode")).toBe("false");
  act(() => update(state({ remotePlayTv: true })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(store.getState().settings.tvMode).toBe(false);
});

it("dismissal keeps desktop and an explicit settings choice closes the suggestion", async () => {
  const { store } = mount({ remotePlayTv: true });
  fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(localStorage.getItem("tvMode")).toBe("false");
  act(() => store.dispatch(change({ tvMode: true })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("late Steam readiness cannot open a portal over the screen replacing the title", async () => {
  const { store } = mount();
  await act(async () => undefined);
  act(() =>
    store.dispatch(navigate({ name: "NEW_GAME", skipBrowserHistory: true })),
  );
  // The outgoing title still receives native events during its exit transition.
  act(() => update(state({ bigPicture: true, steamDeck: false })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(store.getState().settings.tvMode).toBeUndefined();
});

it.each(["surface", "secondary"] as const)(
  "resolves initial %s focus after the dialog enters without undoing a choice",
  async (focusTarget) => {
    jest.useFakeTimers();
    mount({ bigPicture: true, steamDeck: false });
    await act(async () => undefined);
    const dialog = screen.getByRole("dialog");
    const secondary = screen.getByRole("button", {
      name: "Keep desktop layout",
    });
    act(() => (focusTarget === "surface" ? dialog : secondary).focus());
    act(() => jest.advanceTimersByTime(1000));
    expect(
      screen.getByRole("button", {
        name:
          focusTarget === "surface" ? "Use TV layout" : "Keep desktop layout",
      }),
    ).toHaveFocus();
    jest.useRealTimers();
  },
);
