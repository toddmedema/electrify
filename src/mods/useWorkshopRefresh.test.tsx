import { act, renderHook } from "@testing-library/react";
import { useWorkshopRefresh } from "./useWorkshopRefresh";
import type { ModLibrary } from "./Types";
import type { DesktopBridge } from "../Desktop";

const downloading: ModLibrary = {
  entries: [],
  downloads: [{ id: "123", status: "queued" }],
};
const ready: ModLibrary = { entries: [], downloads: [] };
const canRefresh = () => true;
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  delete window.electrifyDesktop;
});

test("downloads poll at one second, back off to five, and stop on completion", async () => {
  const refresh = jest.fn().mockResolvedValue(downloading);
  const { unmount } = renderHook(() =>
    useWorkshopRefresh(true, refresh, canRefresh),
  );
  await advance(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  for (const [delay, calls] of [
    [1000, 2],
    [2000, 3],
    [4000, 4],
    [5000, 5],
  ]) {
    await advance(delay - 1);
    expect(refresh).toHaveBeenCalledTimes(calls - 1);
    await advance(1);
    expect(refresh).toHaveBeenCalledTimes(calls);
  }
  refresh.mockResolvedValue(ready);
  await advance(5000);
  expect(refresh).toHaveBeenCalledTimes(6);
  await advance(120000);
  expect(refresh).toHaveBeenCalledTimes(6);
  unmount();
});

test("focus returns and repeated checks never compete with an in-flight refresh", async () => {
  let finish: (value: ModLibrary) => void = () => {};
  const refresh = jest.fn(
    () =>
      new Promise<ModLibrary>((resolve) => {
        finish = resolve;
      }),
  );
  let nativeFocus: (focused: boolean) => void = () => {};
  const stop = jest.fn();
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: (callback: (focused: boolean) => void) => {
      nativeFocus = callback;
      return stop;
    },
  } as unknown as DesktopBridge;
  const { result, unmount } = renderHook(() =>
    useWorkshopRefresh(true, refresh, canRefresh),
  );
  act(() => {
    nativeFocus(false);
    nativeFocus(true);
    result.current.check();
    result.current.check();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish(ready));
  act(() => {
    nativeFocus(false);
    nativeFocus(true);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => finish(downloading));
  await advance(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
});

test("polling stops after two minutes and Retry starts one new loop", async () => {
  const refresh = jest.fn().mockResolvedValue(downloading);
  const { result, unmount } = renderHook(() =>
    useWorkshopRefresh(true, refresh, canRefresh),
  );
  await advance(0);
  // Advance with settled IPC results between timers, as in the real event loop.
  for (let elapsed = 0; elapsed < 120000; elapsed += 1000) await advance(1000);
  expect(result.current.timedOut).toBe(true);
  const calls = refresh.mock.calls.length;
  await advance(30000);
  expect(refresh).toHaveBeenCalledTimes(calls);
  act(() => result.current.check());
  await advance(0);
  expect(result.current.timedOut).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(calls + 1);
  unmount();
});

test("offline, disabled, and screen exit cancel the loop", async () => {
  const refresh = jest.fn().mockResolvedValue(downloading);
  const { result, rerender, unmount } = renderHook(
    ({ enabled }) => useWorkshopRefresh(enabled, refresh, canRefresh),
    { initialProps: { enabled: true } },
  );
  await advance(0);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(result.current.available).toBe(false);
  await advance(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await advance(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  rerender({ enabled: false });
  await advance(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  rerender({ enabled: true });
  await advance(0);
  expect(refresh).toHaveBeenCalledTimes(3);
  unmount();
  await advance(10000);
  expect(refresh).toHaveBeenCalledTimes(3);
});

test("a late IPC result after the deadline cannot restart polling", async () => {
  let finish: (value: ModLibrary) => void = () => {};
  const refresh = jest.fn(
    () =>
      new Promise<ModLibrary>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useWorkshopRefresh(true, refresh, canRefresh),
  );
  await advance(120000);
  expect(result.current.timedOut).toBe(true);
  await act(async () => finish(downloading));
  await advance(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
});
