import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import cardReducer, { initialCard } from "../../reducers/Card";
import GameWorkspace from "./GameWorkspace";

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
  const { GameToolCloseContext } = jest.requireActual("./GameWorkspaceContext");
  return function MockBuildFacilities({ category }: { category: string }) {
    const dispatch = useDispatch();
    const close = useContext(GameToolCloseContext);
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
        <button onClick={close}>Finish purchase</button>
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
      game: () => ({ eventLog: [], eventLogReadThroughId: 0 }),
    },
    preloadedState: {
      card: { ...initialCard, name: "FACILITIES" as const },
    },
  });
  render(
    <Provider store={store}>
      <GameWorkspace />
    </Provider>,
  );
  return {
    store,
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

it("keeps one tool per semantic rail and uses desktop tabs to switch siblings", async () => {
  const { user, action } = setup(2240);
  await user.click(action("Build"));
  await user.click(action("Insights"));
  expect(screen.getAllByRole("region")).toHaveLength(2);
  const decisions = screen.getByRole("tablist", { name: "Decisions" });
  const intelligence = screen.getByRole("tablist", { name: "Intelligence" });
  await user.click(within(decisions).getByRole("tab", { name: "Programs" }));
  expect(screen.queryByRole("region", { name: "Build" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(
    within(decisions).getByRole("tab", { name: "Programs" }),
  ).toHaveFocus();
  expect(
    within(decisions).getByRole("tab", { name: "Programs" }),
  ).toHaveAttribute("aria-selected", "true");
  await user.click(within(intelligence).getByRole("tab", { name: "Events" }));
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(screen.getByRole("region", { name: "Events" })).toBeVisible();
  expect(screen.getAllByRole("region")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /^(?:Unpin|Pin) /i })).toBeNull();
  await user.click(action("Events"));
  expect(screen.queryByRole("region", { name: "Events" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
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

it("reveals a remembered compact tool instead of toggling an unseen rail closed", async () => {
  const { user, action } = setup(1600);
  await user.click(action("Insights"));
  await user.click(action("Programs"));
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(action("Insights")).toHaveAttribute("aria-expanded", "false");
  await user.click(action("Insights"));
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Programs" })).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  expect(action("Insights")).toHaveFocus();
  resize(2240);
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.queryByRole("region", { name: "Insights" })).toBeNull();
});

it("switches at layout boundaries without discarding the other group's selection", async () => {
  const { user, action } = setup(1800);
  await user.click(action("Events"));
  await user.click(action("Programs"));
  expect(screen.getAllByRole("region")).toHaveLength(2);
  resize(1799);
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.getByRole("tablist", { name: "Decisions" })).toBeVisible();
  resize(1200);
  expect(screen.getByRole("tablist", { name: "Decisions" })).toBeVisible();
  resize(1199);
  expect(screen.queryByRole("tablist", { name: "Decisions" })).toBeNull();
  expect(screen.getByRole("region", { name: "Programs" })).toBeVisible();
  resize(1800);
  expect(screen.getAllByRole("region")).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Events" })).toBeVisible();
});

it("retains Build tab focus and restores its category after closing another tool", async () => {
  const { store, user, action } = setup(1600);
  await user.click(action("Build"));
  const storage = screen.getByRole("tab", { name: "Storage" });
  await user.click(storage);
  expect(storage).toHaveFocus();
  expect(storage).toHaveAttribute("aria-selected", "true");
  expect(store.getState().card.name).toBe("BUILD_STORAGE");
  await user.click(action("Insights"));
  await user.click(screen.getByRole("button", { name: "Close Insights" }));
  expect(store.getState().card.name).toBe("BUILD_STORAGE");
  expect(screen.getByRole("tab", { name: "Storage" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(action("Insights")).toHaveFocus();
});

it("finishes a purchase without closing the opposite desktop rail", async () => {
  const { store, user, action } = setup(2240);
  await user.click(action("Insights"));
  await user.click(action("Build"));
  await user.click(screen.getByRole("button", { name: "Finish purchase" }));
  expect(screen.queryByRole("region", { name: "Build" })).toBeNull();
  expect(screen.getByRole("region", { name: "Insights" })).toBeVisible();
  expect(store.getState().card.name).toBe("INSIGHTS");
  expect(action("Build")).toHaveFocus();
});
