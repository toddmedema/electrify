import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import gameReducer from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import * as client from "../../helpers/PolicyPreviewClient";
import { previewPolicy } from "../../helpers/PolicyPreview";
import CustomerPrograms from "./CustomerPrograms";
import { PolicyId } from "../../Types";
import { POLICIES } from "../../data/Policies";
import { formatMoneyConcise } from "../../helpers/Format";
import { emptyPolicies } from "../../helpers/Policies";

jest.mock("../../helpers/PolicyPreviewClient", () => ({
  createPolicyPreviewWorker: jest.fn(),
}));

test("stale and failed worker results cannot enable Apply, and closing terminates preview", () => {
  jest.useFakeTimers();
  const workers: Array<{
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: (() => void) | null;
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
  const result = previewPolicy(
    game,
    { id: "solar", tier: "Small", month: 1 },
    1,
  );
  const store = configureStore({
    reducer: { game: gameReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Rooftop solar rebates · Off" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: /^Small/ }));
  act(() => {
    jest.advanceTimersByTime(250);
  });
  const old = workers[workers.length - 1];
  fireEvent.click(screen.getByRole("radio", { name: /^Large/ }));
  expect(old.terminate).toHaveBeenCalled();
  act(() => {
    old.onmessage!({ data: { result } });
  });
  const apply = screen.getByRole("button", { name: "Apply next month" });
  expect(apply).toBeDisabled();
  act(() => {
    jest.advanceTimersByTime(250);
  });
  act(() => {
    workers[workers.length - 1].onerror!();
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Could not estimate");
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /^Small/ }));
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
      ...previewPolicy(game, { id, tier: "Large", month: 1 }, 12),
      current: [47000000, 40000000],
      changed: [47000000, 30000000],
    };
    const store = configureStore({
      reducer: { game: gameReducer },
      preloadedState: { game },
    });
    const view = render(
      <Provider store={store}>
        <CustomerPrograms game={game} onViewDemand={jest.fn()} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
    fireEvent.click(
      screen.getByRole("button", { name: `${POLICIES[id].name} · Off` }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /^Large/ }));
    fireEvent.click(screen.getByRole("button", { name: "After 12 months" }));
    act(() => jest.advanceTimersByTime(250));
    act(() => worker.onmessage!({ data: { result } }));

    expect(screen.getByText(/^Electricity supplied:/)).toBeVisible();
    expect(screen.getByText(/^Change in utility cash/)).toBeVisible();
    expect(screen.getByText(/^Change in utility cash/)).toHaveTextContent(
      `Jan 2021: ${formatMoneyConcise(result.cashChange)}`,
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

test("stopped funding describes retained upgrades without announcing another change", () => {
  const game = createGame({ scenarioId: 106 });
  game.policies = emptyPolicies();
  game.policies.programs.efficiency.adoption = 0.05;
  const store = configureStore({
    reducer: { game: gameReducer },
    preloadedState: { game },
  });
  const view = render(
    <Provider store={store}>
      <CustomerPrograms game={game} onViewDemand={jest.fn()} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Customer programs" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Efficiency rebates · Off" }),
  );
  expect(screen.getByText(/Installed upgrades retained/)).toHaveTextContent(
    "5%",
  );
  expect(screen.queryByText(/Building up/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Funding stops/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /^Small/ }));
  expect(screen.getByText(/Charges start Feb 2020/)).toBeVisible();
  view.unmount();
});
