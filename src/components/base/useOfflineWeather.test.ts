import { act, renderHook, waitFor } from "@testing-library/react";
import { useOfflineWeather } from "./useOfflineWeather";

it("enables a location if its cache write completes after the offline event", async () => {
  const worker = new EventTarget();
  const originalWorker = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );
  const originalCaches = Object.getOwnPropertyDescriptor(window, "caches");
  const network = jest.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const location = { id: "pending-location", name: "Pending", lat: 0, long: 0 };
  const locations = [location];
  let cached = false;
  const match = jest.fn(async () => (cached ? { ok: true } : undefined));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: worker,
  });
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: { match },
  });

  try {
    const { result, unmount } = renderHook(() => useOfflineWeather(locations));
    expect(result.current).toBeUndefined();
    act(() => {
      network.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() =>
      expect(match).toHaveBeenCalledWith("/data/weather/pending-location.bin"),
    );
    expect(result.current?.(location)).toBe(true);

    cached = true;
    act(() => {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "OFFLINE_WEATHER_CACHED" },
        }),
      );
    });
    await waitFor(() => expect(result.current?.(location)).toBe(false));
    unmount();
  } finally {
    network.mockRestore();
    if (originalWorker)
      Object.defineProperty(navigator, "serviceWorker", originalWorker);
    else Reflect.deleteProperty(navigator, "serviceWorker");
    if (originalCaches) Object.defineProperty(window, "caches", originalCaches);
    else Reflect.deleteProperty(window, "caches");
  }
});
