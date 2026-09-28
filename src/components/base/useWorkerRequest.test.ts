import { act, renderHook } from "@testing-library/react";
import {
  useWorkerRequest,
  WorkerJob,
  WorkerRequestOptions,
} from "./useWorkerRequest";

interface Reply {
  requestId?: number;
  value?: number;
}

function stubWorker() {
  return {
    onmessage: null as ((event: MessageEvent<Reply>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
  };
}

function options(
  createWorker: () => ReturnType<typeof stubWorker>,
  reuseWorker = false,
): WorkerRequestOptions<Reply, number> {
  return {
    createWorker: createWorker as unknown as () => Worker,
    debounceMs: 100,
    reuseWorker,
    read: (data) =>
      data.value === undefined ? undefined : { result: data.value },
  };
}

const job = (
  key: string,
  extra: Partial<WorkerJob<{ id: number }, number>> = {},
): WorkerJob<{ id: number }, number> => ({
  key,
  message: (id) => ({ id }),
  ...extra,
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("is idle without a job and loads until the debounced reply arrives", () => {
  const worker = stubWorker();
  const { result, rerender } = renderHook(
    ({ j }) =>
      useWorkerRequest(
        j,
        options(() => worker),
      ),
    {
      initialProps: {
        j: undefined as WorkerJob<{ id: number }, number> | undefined,
      },
    },
  );
  expect(result.current).toEqual({ status: "idle" });

  rerender({ j: job("a") });
  expect(result.current).toEqual({ status: "loading" });
  expect(worker.postMessage).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(100));
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  act(() => worker.onmessage!({ data: { value: 7 } } as MessageEvent<Reply>));
  expect(result.current).toEqual({ status: "ready", result: 7 });
});

it("falls back to the page when the worker fails, and handles the error event", () => {
  const worker = stubWorker();
  const { result } = renderHook(() =>
    useWorkerRequest(
      job("a", { fallback: () => 3 }),
      options(() => worker),
    ),
  );
  act(() => jest.advanceTimersByTime(100));
  const event = { preventDefault: jest.fn() } as unknown as ErrorEvent;
  act(() => worker.onerror!(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(result.current).toEqual({ status: "ready", result: 3 });
});

it("reports a startup failure without a fallback", () => {
  const { result } = renderHook(() =>
    useWorkerRequest(
      job("a", { fallback: () => 3 }),
      options(() => {
        throw new Error("blocked");
      }),
    ),
  );
  act(() => jest.advanceTimersByTime(100));
  expect(result.current).toEqual({ status: "error", reason: "startup" });
});

it("terminates a per-request worker when the request changes", () => {
  const workers: ReturnType<typeof stubWorker>[] = [];
  const { result, rerender } = renderHook(
    ({ key }) =>
      useWorkerRequest(
        job(key),
        options(() => {
          const worker = stubWorker();
          workers.push(worker);
          return worker;
        }),
      ),
    { initialProps: { key: "a" } },
  );
  act(() => jest.advanceTimersByTime(100));
  rerender({ key: "b" });
  expect(workers[0].terminate).toHaveBeenCalled();
  act(() =>
    workers[0].onmessage!({ data: { value: 1 } } as MessageEvent<Reply>),
  );
  expect(result.current).toEqual({ status: "loading" });
});

it("reuses one worker and ignores replies to older requests", () => {
  const worker = stubWorker();
  const create = jest.fn(() => worker);
  const { result, rerender, unmount } = renderHook(
    ({ key }) => useWorkerRequest(job(key), options(create, true)),
    { initialProps: { key: "a" } },
  );
  act(() => jest.advanceTimersByTime(100));
  const first = worker.postMessage.mock.calls[0][0].id;
  rerender({ key: "b" });
  act(() => jest.advanceTimersByTime(100));
  const second = worker.postMessage.mock.calls[1][0].id;
  expect(create).toHaveBeenCalledTimes(1);
  expect(worker.terminate).not.toHaveBeenCalled();

  act(() =>
    worker.onmessage!({
      data: { requestId: first, value: 1 },
    } as MessageEvent<Reply>),
  );
  expect(result.current).toEqual({ status: "loading" });
  act(() =>
    worker.onmessage!({
      data: { requestId: second, value: 2 },
    } as MessageEvent<Reply>),
  );
  expect(result.current).toEqual({ status: "ready", result: 2 });
  unmount();
  expect(worker.terminate).toHaveBeenCalled();
});
