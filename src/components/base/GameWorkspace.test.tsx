import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { flushSync } from "react-dom";
import cardReducer, { initialCard } from "../../reducers/Card";
import GameWorkspace, {
  MIN_FLEET_WIDTH,
  dockCenter,
  SIDE_TOOL_MIN_WIDTH,
  maxOpenTools,
  toolWidth,
} from "./GameWorkspace";

jest.mock("./GameAppBar", () => () => <div>Game status</div>);
jest.mock("../views/FacilitiesContainer", () => () => (
  <label>
    Facility notes
    <input aria-label="Facility notes" defaultValue="" />
  </label>
));
jest.mock("../views/InsightsContainer", () => () => <div>Insight charts</div>);
jest.mock("../views/EventLogContainer", () => () => <div>Event history</div>);
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

function setup(width = 390) {
  resize(width);
  const store = configureStore({
    reducer: {
      card: cardReducer,
      game: () => ({
        eventLog: [],
        eventLogReadThroughId: 0,
        worldEvents: { active: [] },
      }),
    },
    preloadedState: {
      card: { ...initialCard, name: "FACILITIES" as const },
    },
  });
  const view = render(
    <Provider store={store}>
      <GameWorkspace />
    </Provider>,
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

afterEach(() => resize(originalWidth));

it("switches and toggles compact tools while preserving the Facilities stage", async () => {
  const { user, action } = setup();
  const facilityNotes = screen.getByRole("textbox", { name: "Facility notes" });
  await user.type(facilityNotes, "Inspect the coal plant next");
  await user.click(action("Insights"));
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Insights" })).toHaveFocus();
  await user.click(action("Events"));
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(screen.getByRole("region", { name: "Events" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Facility notes" })).toBe(
    facilityNotes,
  );
  expect(facilityNotes).toHaveValue("Inspect the coal plant next");
  await user.click(action("Events"));
  expect(screen.queryByRole("region")).toBeNull();
  expect(action("Events")).toHaveAttribute("aria-expanded", "false");
  expect(action("Events")).toHaveFocus();
});

it("closes a focused range with Escape when only an inactive modal remains mounted", async () => {
  const { user, action } = setup();
  await user.click(action("Programs"));
  const rate = screen.getByRole("slider", { name: "Electricity rate" });
  const modal = document.createElement("div");
  modal.className = "MuiModal-root MuiModal-hidden";
  document.body.appendChild(modal);
  try {
    act(() => rate.focus());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Programs" })).toBeNull();
    expect(action("Programs")).toHaveFocus();
  } finally {
    modal.remove();
  }
});

it("leaves an open tool in place while a visible modal owns Escape", async () => {
  const { user, action } = setup();
  await user.click(action("Programs"));
  const rate = screen.getByRole("slider", { name: "Electricity rate" });
  const modal = document.createElement("div");
  modal.className = "MuiModal-root";
  document.body.appendChild(modal);
  try {
    act(() => rate.focus());
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
    expect(rate).toHaveFocus();
  } finally {
    modal.remove();
  }
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Programs" })).toBeNull();
});

it("keeps as many tools open as fit beside a phone-width fleet", async () => {
  const { user, action } = setup(2240);
  await user.click(action("Build"));
  await user.click(action("Insights"));
  await user.click(action("Programs"));
  expect(screen.getAllByRole("region")).toHaveLength(3);
  expect(screen.queryByRole("tablist", { name: "Decisions" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Programs" })).toHaveFocus();
  // Decision tools sit left of the fleet and intelligence tools right of it, in bar order.
  expect(screen.getByRole("region", { name: "Build" }).style.gridColumn).toBe(
    "1",
  );
  expect(
    screen.getByRole("region", { name: "Programs" }).style.gridColumn,
  ).toBe("2");
  expect(
    screen.getByRole("region", { name: "Insights" }).style.gridColumn,
  ).toBe("4");
  // A fourth tool doesn't fit at this width, so the least recently opened one steps aside.
  await user.click(action("Events"));
  expect(screen.getAllByRole("region")).toHaveLength(3);
  expect(screen.queryByRole("region", { name: "Build" })).toBeNull();
  expect(action("Build")).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: /^(?:Unpin|Pin) /i })).toBeNull();
  await user.click(action("Events"));
  expect(screen.queryByRole("region", { name: "Events" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Build" })).toBeNull();
});

it.each([
  [1023, 1],
  [1024, 1],
  [1300, 2],
  [1512, 2],
  [1920, 3],
  [2560, 4],
  [5120, 5],
])("fits %ipx with %i tools open", (width, tools) => {
  expect(maxOpenTools(width)).toBe(tools);
  // Sheets float over the fleet; columns must leave it at least phone width.
  expect(
    width < SIDE_TOOL_MIN_WIDTH ||
      width - tools * toolWidth(width) >= MIN_FLEET_WIDTH,
  ).toBe(true);
});

it("keeps the active tool mounted when narrowing and restores both rails when widened", async () => {
  const { user, action } = setup(2240);
  await user.click(action("Programs"));
  await user.click(action("Insights"));
  expect(screen.getAllByRole("region")).toHaveLength(2);
  const rate = screen.getByRole("slider", { name: "Electricity rate" });
  act(() => rate.focus());
  resize(390);
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(screen.queryByRole("tablist", { name: "Decisions" })).toBeNull();
  expect(rate).toHaveFocus();
  resize(2240);
  expect(screen.getAllByRole("region")).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(screen.getByRole("slider", { name: "Electricity rate" })).toBe(rate);
  expect(rate).toHaveFocus();
});

it("restores side rails when an earlier resize listener redraws the workspace", async () => {
  let redraw: (() => void) | undefined;
  const redrawBeforeWorkspace = () => flushSync(() => redraw?.());
  // App dispatches layoutChanged from its earlier resize listener. A parent can redraw
  // this component before the browser reaches its own listener for the same event.
  window.addEventListener("resize", redrawBeforeWorkspace);
  try {
    const { store, user, action, rerender } = setup(2240);
    await user.click(action("Programs"));
    await user.click(action("Insights"));
    const rate = screen.getByRole("slider", { name: "Electricity rate" });
    act(() => rate.focus());
    resize(390);
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(rate).toHaveFocus();

    redraw = () =>
      rerender(
        <Provider store={store}>
          <GameWorkspace />
        </Provider>,
      );
    resize(2240);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "Electricity rate" })).toBe(rate);
    expect(rate).toHaveFocus();
  } finally {
    window.removeEventListener("resize", redrawBeforeWorkspace);
  }
});

it("reveals a remembered compact tool instead of toggling an unseen rail closed", async () => {
  const { user, action } = setup(1000);
  await user.click(action("Insights"));
  await user.click(action("Programs"));
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(action("Insights")).toHaveAttribute("aria-expanded", "false");
  await user.click(action("Insights"));
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Programs" })).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Programs" })).toBeNull();
  expect(action("Insights")).toHaveFocus();
  resize(2240);
  expect(screen.queryAllByRole("region")).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
});

it("switches at layout boundaries without discarding the other open tool", async () => {
  const { user, action } = setup(1300);
  await user.click(action("Events"));
  await user.click(action("Programs"));
  expect(screen.getAllByRole("region")).toHaveLength(2);
  resize(1023);
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Programs" })).toBeVisible();
  expect(screen.queryByRole("tablist", { name: "Decisions" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  resize(1300);
  expect(screen.getAllByRole("region")).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Events" })).toBeVisible();
});

it("retains Build tab focus and restores its category after closing another tool", async () => {
  const { store, user, action } = setup(1000);
  await user.click(action("Build"));
  const storage = screen.getByRole("tab", { name: "Storage" });
  await user.click(storage);
  expect(storage).toHaveFocus();
  expect(storage).toHaveAttribute("aria-selected", "true");
  expect(store.getState().card.name).toBe("BUILD_STORAGE");
  await user.click(action("Insights"));
  await user.click(screen.getByRole("button", { name: "Close Insights" }));
  expect(store.getState().card.name).toBe("FACILITIES");
  expect(action("Insights")).toHaveFocus();
  await user.click(action("Build"));
  expect(store.getState().card.name).toBe("BUILD_STORAGE");
  expect(screen.getByRole("tab", { name: "Storage" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("keeps Build and the opposite desktop rail open after a purchase", async () => {
  const { store, user, action } = setup(2240);
  await user.click(action("Insights"));
  await user.click(action("Build"));
  await user.click(screen.getByRole("button", { name: "Finish purchase" }));
  expect(screen.getByRole("region", { name: "Build" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(store.getState().card.name).toBe("BUILD_GENERATORS");
});

it.each([390, SIDE_TOOL_MIN_WIDTH - 1, SIDE_TOOL_MIN_WIDTH])(
  "only closes Build after a purchase when %ipx uses an overlay",
  async (width) => {
    const { user, action } = setup(width);
    await user.click(action("Build"));
    await user.click(screen.getByRole("button", { name: "Finish purchase" }));
    const staysOpen = width >= SIDE_TOOL_MIN_WIDTH;
    expect(screen.queryAllByRole("region", { name: "Build" })).toHaveLength(
      Number(staysOpen),
    );
    expect(action("Build")).toHaveAttribute("aria-expanded", String(staysOpen));
  },
);

it("moves the dock off a side tool only when the window centre would cover it", () => {
  // 1024: a 360px tool reaches past the dock's left edge at the window centre.
  expect(dockCenter(1024, 1, 0, 360)).toBe(692);
  expect(dockCenter(1024, 0, 1, 360)).toBe(332);
  expect(dockCenter(1440, 1, 0, 403)).toBeUndefined();
  expect(dockCenter(1024, 0, 0, 360)).toBeUndefined();
});
