import { LocationType } from "../Types";
import { prefetchScenarioData } from "./OfflineData";

describe("prefetchScenarioData", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("asks the active worker to cache the location and its watershed", async () => {
    const postMessage = jest.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: { postMessage } }),
      },
    });
    const location = {
      id: "PIT",
      watershedId: "AlleghenyUpper",
    } as LocationType;

    await prefetchScenarioData(location);

    expect(postMessage).toHaveBeenCalledWith({
      type: "CACHE_SCENARIO_DATA",
      locationIds: ["PIT", "AlleghenyUpper"],
    });
  });

  it("does nothing when no worker controls the app", async () => {
    const postMessage = jest.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: null, postMessage }),
      },
    });

    await expect(
      prefetchScenarioData({ id: "SF" } as LocationType),
    ).resolves.toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
