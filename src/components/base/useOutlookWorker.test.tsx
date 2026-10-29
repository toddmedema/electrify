import { act, renderHook } from "@testing-library/react";
import { GameType, LocationType } from "../../Types";
import { useOutlookWorker } from "./useOutlookWorker";

const mockCompute = jest.fn();
const mockCreateWorker = jest.fn();
jest.mock("./OutlookForecast", () => ({
  computeOutlook: (...args: unknown[]) => mockCompute(...args),
}));
jest.mock("./OutlookWorkerClient", () => ({
  createOutlookWorker: () => mockCreateWorker(),
}));

const location = { id: "london" } as LocationType;
const game = (month: number, city = location) =>
  ({
    date: { monthsElapsed: month },
    location: city,
    seed: 7,
    monthlyHistory: [],
  }) as unknown as GameType;
const originalWorker = global.Worker;
let worker: {
  postMessage: jest.Mock;
  terminate: jest.Mock;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: jest.Mock }) => void;
};
const flush = () => act(() => jest.runAllTimers());
const reply = (index: number, result: unknown) =>
  act(() =>
    worker.onmessage?.({
      data: {
        requestId: worker.postMessage.mock.calls[index][0].requestId,
        result,
      },
    }),
  );

beforeEach(() => {
  jest.useFakeTimers();
  global.Worker = jest.fn() as unknown as typeof Worker;
  mockCompute.mockReset().mockReturnValue([{ fraction: 0.5 }]);
  worker = { postMessage: jest.fn(), terminate: jest.fn() };
  mockCreateWorker.mockReset().mockReturnValue(worker);
});
afterEach(() => {
  global.Worker = originalWorker;
  jest.useRealTimers();
});

it.each(["hydro", "build"] as const)(
  "never runs a %s forecast in render and retains the last result during monthly refresh",
  (kind) => {
    const view = renderHook(
      ({ state }) =>
        useOutlookWorker(kind, String(state.date.monthsElapsed), state),
      {
        initialProps: { state: game(1) },
      },
    );
    expect(view.result.current).toBeUndefined();
    expect(mockCompute).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
    flush();
    const result = [{ fraction: 0.4 }];
    reply(0, result);
    expect(view.result.current).toBe(result);
    view.rerender({ state: game(2) });
    expect(view.result.current).toBe(result);
    flush();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    expect(mockCompute).not.toHaveBeenCalled();
  },
);

it("coalesces edits in flight and ignores superseded replies", () => {
  const view = renderHook(
    ({ state }) =>
      useOutlookWorker("hydro", String(state.date.monthsElapsed), state),
    {
      initialProps: { state: game(1) },
    },
  );
  flush();
  view.rerender({ state: game(2) });
  flush();
  view.rerender({ state: game(3) });
  flush();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  reply(0, [{ fraction: 0.1 }]);
  expect(view.result.current).toBeUndefined();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.postMessage.mock.calls[1][0].game.date.monthsElapsed).toBe(3);
  reply(1, [{ fraction: 0.3 }]);
  expect(view.result.current).toEqual([{ fraction: 0.3 }]);
});

it("clears another imported run's outlook even when the seed and calendar match", () => {
  const view = renderHook(
    ({ state }) => useOutlookWorker("hydro", "same", state),
    {
      initialProps: { state: game(1) },
    },
  );
  flush();
  reply(0, [{ fraction: 0.9 }]);
  view.rerender({ state: game(1, { ...location }) });
  expect(view.result.current).toBeUndefined();
  flush();
  reply(1, [{ fraction: 0.2 }]);
  expect(view.result.current).toEqual([{ fraction: 0.2 }]);
});

it("cancels and terminates on unmount", () => {
  const { unmount: unmountFirst } = renderHook(() =>
    useOutlookWorker("hydro", "first", game(1)),
  );
  unmountFirst();
  flush();
  expect(worker.postMessage).not.toHaveBeenCalled();
  const { unmount: unmountSecond } = renderHook(() =>
    useOutlookWorker("hydro", "second", game(1)),
  );
  flush();
  unmountSecond();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  reply(0, [{ fraction: 0.2 }]);
  expect(mockCompute).not.toHaveBeenCalled();
});

it.each(["startup", "runtime", "reply"])(
  "computes after paint if the worker fails at %s",
  (failure) => {
    if (failure === "startup")
      mockCreateWorker.mockImplementation(() => {
        throw new Error("worker blocked");
      });
    const state = game(1);
    const view = renderHook(() => useOutlookWorker("hydro", "first", state));
    expect(mockCompute).not.toHaveBeenCalled();
    flush();
    if (failure === "runtime")
      act(() => worker.onerror?.({ preventDefault: jest.fn() }));
    if (failure === "reply")
      act(() =>
        worker.onmessage?.({
          data: {
            requestId: worker.postMessage.mock.calls[0][0].requestId,
            error: true,
          },
        }),
      );
    flush();
    expect(mockCompute).toHaveBeenCalledWith("hydro", state);
    expect(view.result.current).toEqual([{ fraction: 0.5 }]);
  },
);
