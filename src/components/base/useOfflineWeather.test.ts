import { act, renderHook, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "crypto";
import * as simulationDataIntegrity from "../../helpers/SimulationDataIntegrity";
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

it("enables offline locations only when their cached weather matches its digest", async () => {
  const matchingLocation = {
    id: "matching",
    name: "Matching",
    lat: 0,
    long: 0,
  };
  const mismatchedLocation = {
    id: "mismatched",
    name: "Mismatched",
    lat: 0,
    long: 0,
  };
  const locations = [matchingLocation, mismatchedLocation];
  const matchingBytes = new Uint8Array([1, 2, 3]);
  const mismatchedBytes = new Uint8Array([1, 2, 4]);
  const integrity = `sha256-${createHash("sha256").update(matchingBytes).digest("base64")}`;
  const cachedWeather = new Map([
    ["/data/weather/matching.bin", matchingBytes.buffer],
    ["/data/weather/mismatched.bin", mismatchedBytes.buffer],
  ]);
  const request = jest
    .spyOn(simulationDataIntegrity, "simulationDataRequest")
    .mockReturnValue({ integrity });
  const network = jest.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const originalCrypto = Object.getOwnPropertyDescriptor(window, "crypto");
  const originalCaches = Object.getOwnPropertyDescriptor(window, "caches");
  Object.defineProperty(window, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: {
      async match(url: string) {
        const body = cachedWeather.get(url);
        return body && { ok: true, arrayBuffer: async () => body };
      },
    },
  });

  try {
    const { result } = renderHook(() => useOfflineWeather(locations));
    // The hook publishes availability after it finishes checking both entries.
    await waitFor(() => expect(result.current?.(matchingLocation)).toBe(false));
    expect(result.current?.(mismatchedLocation)).toBe(true);
  } finally {
    network.mockRestore();
    request.mockRestore();
    if (originalCrypto) Object.defineProperty(window, "crypto", originalCrypto);
    else Reflect.deleteProperty(window, "crypto");
    if (originalCaches) Object.defineProperty(window, "caches", originalCaches);
    else Reflect.deleteProperty(window, "caches");
  }
});
