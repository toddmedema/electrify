import { StrictMode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import cardReducer, { initialCard, navigate } from "../../reducers/Card";
import gameReducer from "../../reducers/Game";
import settingsReducer, { initialSettings } from "../../reducers/Settings";
import type { SettingsType } from "../../Types";
import { createGame } from "../../testing/Simulator";
import { SIDE_TOOL_MIN_WIDTH } from "../../WorkspaceLayout";
import MapWorkspace from "./MapWorkspace";

jest.mock("./GameAppBar", () => () => <div>Game status</div>);
jest.mock("../views/FacilitiesContainer", () => {
  const { useContext } = jest.requireActual("react");
  const { MapWorkspacePanelContext } = jest.requireActual(
    "./GameWorkspaceContext",
  );
  return function MockFacilities({ territoryView }: { territoryView: string }) {
    const catalogue = useContext(MapWorkspacePanelContext)?.buildCatalogue;
    return (
      <div
        data-testid={territoryView === "FACILITIES" ? "base-view" : undefined}
        data-territory-view={territoryView}
      >
        <label>
          Facility notes
          <input aria-label="Facility notes" defaultValue="" />
        </label>
        {territoryView === "FACILITIES" && catalogue && (
          <button id="buildNav" onClick={catalogue.onOpen}>
            Build
          </button>
        )}
      </div>
    );
  };
});
jest.mock("../views/InsightsContainer", () => () => <div>Insight charts</div>);
jest.mock("../views/EventLogContainer", () => () => <div>Event history</div>);
jest.mock("./ScenarioDetails", () => () => <div>Scenario objectives</div>);
jest.mock("../views/Programs", () => () => (
  <input aria-label="Electricity rate" type="range" defaultValue="50" />
));
jest.mock("../views/BuildFacilities", () => {
  const { useContext } = jest.requireActual("react");
  const { useDispatch } = jest.requireActual("react-redux");
  const { GameBuildCompleteContext } = jest.requireActual(
    "./GameWorkspaceContext",
  );
  return function MockBuildFacilities({ category }: { category: string }) {
    const dispatch = useDispatch();
    const complete = useContext(GameBuildCompleteContext);
    return (
      <>
        <div role="tablist" aria-label="Build categories">
          {["GENERATORS", "STORAGE"].map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={category === `BUILD_${name}`}
              onClick={() =>
                dispatch({
                  type: "card/navigate",
                  payload: { name: `BUILD_${name}`, replaceCurrentCard: true },
                })
              }
            >
              {name === "GENERATORS" ? "Generators" : "Storage"}
            </button>
          ))}
        </div>
        <button onClick={complete}>Finish purchase</button>
      </>
    );
  };
});

const originalWidth = window.innerWidth;

function resize(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  fireEvent(window, new Event("resize"));
}

function setup(width = 390, settings: Partial<SettingsType> = {}, map = false) {
  resize(width);
  const game = {
    ...gameReducer(undefined, { type: "workspace-test/init" }),
    inGame: true,
    scenarioId: map ? 116 : 100,
    territoryNetwork: map
      ? createGame({ scenarioId: 116, seed: 188 }).territoryNetwork
      : undefined,
  };
  const store = configureStore({
    reducer: {
      card: cardReducer,
      settings: settingsReducer,
      game: () => game,
    },
    preloadedState: {
      card: { ...initialCard, name: "FACILITIES" as const },
      settings: {
        ...initialSettings,
        interfaceScale: 1,
        ...settings,
      },
    },
  });
  const view = render(
    <StrictMode>
      <Provider store={store}>
        <MapWorkspace />
      </Provider>
    </StrictMode>,
  );
  return {
    store,
    rerender: view.rerender,
    user: userEvent.setup({ delay: null }),
    action: (name: string) =>
      within(
        screen.getByRole("navigation", { name: "Game actions" }),
      ).getByRole("button", { name }),
  };
}

afterEach(() => {
  resize(originalWidth);
  jest.restoreAllMocks();
});

it.each([390, 1280])(
  "keeps the regional map mounted through Fleet and Build at %ipx",
  async (width) => {
    const app = setup(width);
    const map = screen.getByTestId("base-view");
    const notes = within(map).getByRole("textbox", { name: "Facility notes" });
    fireEvent.change(notes, { target: { value: "Keep the map state" } });

    await app.user.click(app.action("Fleet"));
    expect(screen.getByRole("region", { name: "Fleet" })).toBeVisible();
    await app.user.click(screen.getByRole("button", { name: /^Build$/ }));
    const build = screen.getByRole("region", { name: "Build" });
    await app.user.click(within(build).getByRole("tab", { name: "Storage" }));
    expect(within(build).getByRole("tab", { name: "Storage" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await app.user.click(
      within(build).getByRole("button", { name: "Finish purchase" }),
    );
    expect(!!screen.queryByRole("region", { name: "Build" })).toBe(
      width >= SIDE_TOOL_MIN_WIDTH,
    );
    expect(map).toBeVisible();
    expect(notes).toHaveValue("Keep the map state");
  },
);

it.each([360, SIDE_TOOL_MIN_WIDTH - 1])(
  "keeps the map mounted beneath exactly one compact panel at %ipx",
  async (width) => {
    const app = setup(width, {}, true);
    const map = screen.getByTestId("base-view");
    const notes = within(map).getByRole("textbox", { name: "Facility notes" });
    fireEvent.change(notes, { target: { value: "Keep this map position" } });
    expect(map).toHaveAttribute("data-territory-view", "FACILITIES");
    expect(
      screen.queryByRole("button", { name: "Map" }),
    ).not.toBeInTheDocument();
    for (const name of [
      "Fleet",
      "Agreements",
      "Programs",
      "Insights",
      "Events",
      "Scenario",
    ]) {
      await app.user.click(app.action(name));
      const panel = screen.getByRole("region", { name });
      expect(screen.getAllByRole("region")).toHaveLength(1);
      expect(panel).toBeVisible();
      expect(map).toBeVisible();
      expect(map).toHaveAttribute("data-territory-view", "FACILITIES");
      expect(notes).toHaveValue("Keep this map position");
      expect(app.action(name)).toHaveAttribute("aria-expanded", "true");
    }
    await app.user.click(
      screen.getByRole("button", { name: "Close Scenario" }),
    );
    expect(app.store.getState().card.name).toBe("FACILITIES");
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(map).toBeVisible();
    expect(app.action("Scenario")).toHaveFocus();
    await app.user.click(app.action("Fleet"));
    await app.user.click(app.action("Fleet"));
    expect(app.store.getState().card.name).toBe("FACILITIES");
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  },
);

it("keeps desktop map tools open and only closes the selected window", async () => {
  const app = setup(1280, {}, true);
  const map = screen.getByTestId("base-view");
  await app.user.click(app.action("Fleet"));
  const fleet = screen.getByRole("region", { name: "Fleet" });
  const notes = within(fleet).getByRole("textbox", { name: "Facility notes" });
  fireEvent.change(notes, { target: { value: "Inspect this plant" } });
  await app.user.click(app.action("Agreements"));
  const agreements = screen.getByRole("region", { name: "Agreements" });
  expect(agreements).toHaveAttribute("data-map-window-front", "true");

  await app.user.click(notes);
  expect(notes).toHaveFocus();
  expect(fleet).toHaveAttribute("data-map-window-front", "true");
  expect(app.store.getState().card.name).toBe("AGREEMENTS");

  act(() => {
    app.store.dispatch(
      navigate({
        name: "AGREEMENTS",
        replaceCurrentCard: true,
        skipBrowserHistory: true,
      }),
    );
  });
  expect(agreements).toHaveAttribute("data-map-window-front", "true");
  await app.user.click(notes);
  act(() => resize(800));
  expect(notes).toHaveFocus();
  expect(agreements).not.toBeInTheDocument();
  act(() => resize(1280));
  expect(screen.getByRole("region", { name: "Agreements" })).toBeVisible();

  await app.user.click(app.action("Agreements"));
  expect(screen.getByRole("region", { name: "Agreements" })).toHaveAttribute(
    "data-map-window-front",
    "true",
  );
  await app.user.click(app.action("Agreements"));
  expect(
    screen.queryByRole("region", { name: "Agreements" }),
  ).not.toBeInTheDocument();
  expect(fleet).toBeVisible();
  expect(notes).toHaveValue("Inspect this plant");
  expect(app.action("Agreements")).toHaveFocus();
  expect(app.action("Fleet")).toHaveAttribute("aria-expanded", "true");
  await app.user.keyboard("{Escape}");
  expect(fleet).not.toBeInTheDocument();
  expect(app.action("Fleet")).toHaveFocus();
  expect(map).toBeVisible();
});
