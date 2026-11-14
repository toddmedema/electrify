import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import { BuildForecastProvider, useBuildForecast } from "./BuildForecast";
import type { GameType } from "../../Types";
import type { BuildForecast } from "./OutlookForecast";

const originalWorker = global.Worker;
let worker: {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  onmessage?: (event: { data: unknown }) => void;
};
let factory: jest.SpyInstance;
const flush = () => act(() => jest.runAllTimers());
const result: BuildForecast = {
  timeline: [],
  windSpeeds: [12],
  offshoreWindSpeeds: [],
  airborneWindSpeeds: [],
  solarIrradiances: [],
};
function Catalog(props: { game: GameType }) {
  const forecast = useBuildForecast(props.game);
  return <div>{forecast ? `Wind ${forecast.windSpeeds[0]}` : "Pending"}</div>;
}

beforeEach(() => {
  jest.useFakeTimers();
  global.Worker = jest.fn() as unknown as typeof Worker;
  worker = { postMessage: jest.fn(), terminate: jest.fn() };
  factory = jest
    .spyOn(jest.requireMock("./OutlookWorkerClient"), "createOutlookWorker")
    .mockReturnValue(worker);
});
afterEach(() => {
  factory.mockRestore();
  global.Worker = originalWorker;
  jest.useRealTimers();
});

it("warms before opening the catalog, shares in-flight work and retains it across remounts", () => {
  const game = createGame({ scenarioId: 103, seed: 12345 });
  const store = configureStore({ reducer: { game: () => game } });
  const workspace = (open: boolean) => (
    <Provider store={store}>
      <BuildForecastProvider>
        {open && <Catalog game={game} />}
      </BuildForecastProvider>
    </Provider>
  );
  const view = render(workspace(false));
  expect(worker.postMessage).not.toHaveBeenCalled();
  flush();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(worker.postMessage.mock.calls[0][0].kind).toBe("build");
  view.rerender(workspace(true));
  expect(screen.getByText("Pending")).toBeInTheDocument();
  flush();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  act(() =>
    worker.onmessage?.({
      data: {
        requestId: worker.postMessage.mock.calls[0][0].requestId,
        result,
      },
    }),
  );
  expect(screen.getByText("Wind 12")).toBeInTheDocument();
  view.rerender(workspace(false));
  expect(worker.terminate).not.toHaveBeenCalled();
  view.rerender(workspace(true));
  expect(screen.getByText("Wind 12")).toBeInTheDocument();
  flush();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it("clears warmed estimates when a different saved run replaces the game", () => {
  const game = createGame({ scenarioId: 103, seed: 12345 });
  const store = configureStore({
    reducer: {
      game: (state = game, action: { type: string; payload?: GameType }) =>
        action.type === "replace" ? action.payload! : state,
    },
  });
  function CurrentCatalog() {
    const state = store.getState().game;
    return <Catalog game={state} />;
  }
  render(
    <Provider store={store}>
      <BuildForecastProvider>
        <CurrentCatalog />
      </BuildForecastProvider>
    </Provider>,
  );
  flush();
  act(() =>
    worker.onmessage?.({
      data: {
        requestId: worker.postMessage.mock.calls[0][0].requestId,
        result,
      },
    }),
  );
  expect(screen.getByText("Wind 12")).toBeInTheDocument();
  act(() =>
    store.dispatch({
      type: "replace",
      payload: createGame({ scenarioId: 103, seed: 12345 }),
    }),
  );
  expect(screen.getByText("Pending")).toBeInTheDocument();
  flush();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
