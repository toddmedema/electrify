import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import * as client from "../../helpers/PolicyPreviewClient";
import * as preview from "../../helpers/PolicyPreview";
import { previewPolicy } from "../../helpers/PolicyPreview";
import CustomerPrograms from "./CustomerPrograms";
import { PolicyId } from "../../Types";
import { POLICIES } from "../../data/Policies";
import { formatMoneyConcise } from "../../helpers/Format";
import { emptyPolicies, policyBudget } from "../../helpers/Policies";
import { suggestedPolicyStartHour } from "../../helpers/PolicyWindow";

jest.mock("../../helpers/PolicyPreviewClient", () => ({
  createPolicyPreviewWorker: jest.fn(),
}));

test("window defaults to the forecast peak and only a fresh preview can schedule a changed window", () => {
  jest.useFakeTimers();
  const workers: Array<{
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: jest.Mock;
    terminate: jest.Mock;
  }> = [];
  const stub = jest
    .spyOn(client, "createPolicyPreviewWorker")
    .mockImplementation(() => {
      const worker = {
        onmessage: null,
        postMessage: jest.fn(),
        terminate: jest.fn(),
      };
      workers.push(worker);
      return worker as unknown as Worker;
    });
  const game = createGame({ scenarioId: 106 });
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  expect(screen.queryByLabelText("Daily window")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /^On$/ }));
  expect(screen.getByLabelText("Daily window")).toHaveValue(
    String(suggestedPolicyStartHour(game)),
  );
  act(() => jest.advanceTimersByTime(250));
  const old = workers[workers.length - 1];
  fireEvent.change(screen.getByLabelText("Daily window"), {
    target: { value: "22" },
  });
  const result = previewPolicy(
    game,
    { id: "timeOfUse", tier: "On", month: 1, startHour: 22 },
    1,
  );
  act(() => old.onmessage!({ data: { result } }));
  const apply = screen.getByRole("button", { name: "Turn on next month" });
  expect(apply).toBeDisabled();
  act(() => jest.advanceTimersByTime(250));
  const worker = workers[workers.length - 1];
  expect(worker.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      change: { id: "timeOfUse", tier: "On", month: 1, startHour: 22 },
    }),
  );
  act(() => worker.onmessage!({ data: { result } }));
  fireEvent.click(apply);
  expect(
    store.getState().game.policies!.programs.timeOfUse.pending!.startHour,
  ).toBe(22);
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  expect(screen.getByLabelText("Daily window")).toHaveValue("22");
  expect(
    screen.getByRole("button", { name: "Update next month" }),
  ).toBeDisabled();
  view.unmount();
  stub.mockRestore();
  jest.useRealTimers();
});

test("stale and failed worker results cannot enable Apply, and closing terminates preview", () => {
  jest.useFakeTimers();
  const workers: Array<{
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage: jest.Mock;
    terminate: jest.Mock;
  }> = [];
  const stub = jest
    .spyOn(client, "createPolicyPreviewWorker")
    .mockImplementation(() => {
      const worker = {
        onmessage: null,
        onerror: null,
        postMessage: jest.fn(),
        terminate: jest.fn(),
      };
      workers.push(worker);
      return worker as unknown as Worker;
    });
  const game = createGame({ scenarioId: 106 });
  const result = previewPolicy(game, { id: "solar", tier: "On", month: 1 }, 1);
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Rooftop solar rebates · Not started" }),
  );
  act(() => {
    jest.advanceTimersByTime(250);
  });
  const old = workers[workers.length - 1];
  fireEvent.click(
    screen.getByRole("button", { name: "At completion (Jan 2022)" }),
  );
  expect(old.terminate).toHaveBeenCalled();
  act(() => {
    old.onmessage!({ data: { result } });
  });
  const apply = screen.getByRole("button", {
    name: "Start build-out next month",
  });
  expect(apply).toBeDisabled();
  act(() => {
    jest.advanceTimersByTime(250);
  });
  const failure = { preventDefault: jest.fn() } as unknown as ErrorEvent;
  const fallback = jest
    .spyOn(preview, "previewPolicy")
    .mockImplementation(() => {
      throw new Error("no data");
    });
  act(() => {
    workers[workers.length - 1].onerror!(failure);
  });
  expect(failure.preventDefault).toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Could not estimate");
  expect(apply).toBeDisabled();
  fallback.mockRestore();
  fireEvent.click(
    screen.getByRole("button", { name: "First effective month" }),
  );
  act(() => {
    jest.advanceTimersByTime(250);
  });
  act(() => {
    workers[workers.length - 1].onmessage!({ data: { result } });
  });
  expect(apply).toBeEnabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(workers[workers.length - 1].terminate).toHaveBeenCalled();
  expect(store.getState().game.policyPause).toBeUndefined();
  view.unmount();
  stub.mockRestore();
  jest.useRealTimers();
});

test.each<PolicyId>(["solar", "efficiency"])(
  "%s keeps energy and cash tradeoffs visible when peak demand is unchanged",
  (id) => {
    jest.useFakeTimers();
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: jest.fn(),
      terminate: jest.fn(),
    };
    const stub = jest
      .spyOn(client, "createPolicyPreviewWorker")
      .mockReturnValue(worker as unknown as Worker);
    const game = createGame({ scenarioId: 106 });
    const result = {
      ...previewPolicy(game, { id, tier: "On", month: 1 }, 24),
      current: [47000000, 40000000],
      changed: [47000000, 30000000],
    };
    const store = configureStore({
      reducer: { game: gameReducer, ui: uiReducer },
      preloadedState: { game },
    });
    const view = render(
      <Provider store={store}>
        <CustomerPrograms game={game} onViewDemand={jest.fn()} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: `${POLICIES[id].name} · Not started`,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "At completion (Jan 2022)" }),
    );
    act(() => jest.advanceTimersByTime(250));
    act(() => worker.onmessage!({ data: { result } }));

    expect(screen.getByText(/^Electricity supplied:/)).toBeVisible();
    expect(screen.getByText(/^Change in utility cash/)).toBeVisible();
    expect(screen.getByText(/^Change in utility cash/)).toHaveTextContent(
      `Jan 2022: ${formatMoneyConcise(result.cashChange)}`,
    );
    const hint = screen.getByText(/^Little change in peak demand/);
    expect(hint).toBeVisible();
    expect(hint).toHaveTextContent(
      id === "solar"
        ? "Little change in peak demand. Daylight savings may leave the evening peak unchanged."
        : "Little change in peak demand. Efficiency savings build gradually as upgrades are installed.",
    );

    view.unmount();
    stub.mockRestore();
    jest.useRealTimers();
  },
);

test("a paused build-out keeps its progress and offers to resume", () => {
  const game = createGame({ scenarioId: 106 });
  game.policies = emptyPolicies();
  game.policies.programs.efficiency.adoption = 8 / 24;
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Efficiency rebates · Paused · 33% installed",
    }),
  );
  expect(
    screen.getByRole("progressbar", {
      name: "Efficiency rebates build-out progress",
    }),
  ).toHaveAttribute("aria-valuenow", "33");
  expect(screen.getByText(/^Paused after month 8 of 24/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Resume build-out next month" }),
  ).toBeDisabled();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Larger funding|Monthly funding/),
  ).not.toBeInTheDocument();
  view.unmount();
});

test("in-progress and completed build-outs read as projects in the list and toolbar", () => {
  const game = createGame({ scenarioId: 106 });
  game.policies = emptyPolicies(game.date.monthsElapsed);
  Object.assign(game.policies.programs.solar, {
    tier: "On",
    adoption: 8 / 24,
    spent: 1000000,
  });
  Object.assign(game.policies.programs.efficiency, {
    tier: "On",
    adoption: 1,
    spent: 2000000,
    completedMonth: 24,
  });
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  const entry = screen.getByRole("button", { name: "Customer programs" });
  // The finished project is neither active nor part of the monthly rebate total.
  expect(entry.title).toBe(
    `Customer programs: 1 active · Rooftop solar build-out · month 8 of 24 · ${formatMoneyConcise(
      policyBudget(game, "solar", "On", 0),
    )}/month in rebates`,
  );
  fireEvent.click(entry);
  const completed = screen.getByRole("region", { name: "Completed" });
  expect(
    within(completed).getByRole("button", {
      name: "Efficiency rebates · Completed Jan 2022",
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Rooftop solar rebates · In progress · month 8 of 24",
    }),
  );
  expect(
    screen.getByText(/^Month 8 of 24 · \$1M spent of about/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Pause new installations next month" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Efficiency rebates · Completed Jan 2022",
    }),
  );
  expect(
    screen.getByText("Completed Jan 2022 · no further cost"),
  ).toBeVisible();
  expect(screen.queryByText(/next month$/)).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Estimated utility demand/),
  ).not.toBeInTheDocument();
  view.unmount();
});

test("estimates on the page when the preview worker cannot load its data", () => {
  jest.useFakeTimers();
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
  };
  const stub = jest
    .spyOn(client, "createPolicyPreviewWorker")
    .mockImplementation(() => worker as unknown as Worker);
  const game = createGame({ scenarioId: 106 });
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Rooftop solar rebates · Not started" }),
  );
  act(() => {
    jest.advanceTimersByTime(250);
  });
  act(() => {
    worker.onmessage!({ data: { error: "offline" } });
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Start build-out next month" }),
  ).toBeEnabled();
  stub.mockRestore();
  jest.useRealTimers();
});
