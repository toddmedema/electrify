import { configureStore } from "@reduxjs/toolkit";
import savesReducer from "./SaveLibrary";
import { startCloudSaves, retryCloudSync } from "./CloudSaves";
import type { AppStore } from "./Store";

let mockAuth: (user: { uid: string } | null) => void;
let mockChanged: () => void;
const mockSync = jest.fn();
const mockUnsubscribeAuth = jest.fn();
const mockUnsubscribeRepository = jest.fn();
jest.mock("./Globals", () => ({
  firebaseAppAuth: {
    onAuthStateChanged: (callback: typeof mockAuth) => {
      mockAuth = callback;
      return mockUnsubscribeAuth;
    },
  },
}));
jest.mock("./SaveSession", () => ({
  saveRepository: {
    subscribe: (callback: () => void) => {
      mockChanged = callback;
      return mockUnsubscribeRepository;
    },
  },
}));
jest.mock("./CloudSaveSync", () => ({
  CloudSaveSync: class {
    sync = mockSync;
  },
}));
jest.mock("./CloudSaveTransport", () => ({ FirebaseSaveTransport: class {} }));

const settle = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};
let stop: () => void;
let store: ReturnType<typeof configureTestStore>;
function configureTestStore() {
  return configureStore({ reducer: { saves: savesReducer } });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  mockSync.mockResolvedValue({ conflicts: false, deferred: false });
  store = configureTestStore();
  stop = startCloudSaves(store as unknown as AppStore);
});
afterEach(() => {
  stop();
  jest.useRealTimers();
});

it("keeps signed-out play independent of cloud and debounces local changes", async () => {
  mockAuth(null);
  mockChanged();
  jest.advanceTimersByTime(1500);
  expect(mockSync).not.toHaveBeenCalled();
  expect(store.getState().saves.cloudState).toBe("signedOut");
  mockAuth({ uid: "alice" });
  await settle();
  expect(store.getState().saves.cloudState).toBe("synced");
  mockChanged();
  mockChanged();
  jest.advanceTimersByTime(1499);
  expect(mockSync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await settle();
  expect(mockSync).toHaveBeenCalledTimes(2);
});

it("waits while offline and retries on reconnection without blocking local saves", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  mockAuth({ uid: "alice" });
  expect(mockSync).not.toHaveBeenCalled();
  expect(store.getState().saves.cloudState).toBe("offline");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  window.dispatchEvent(new Event("online"));
  await settle();
  expect(store.getState().saves.cloudState).toBe("synced");
});

it("reports failures without exposing Firebase details and retries", async () => {
  mockSync.mockRejectedValueOnce(new Error("private credential"));
  mockAuth({ uid: "alice" });
  await settle();
  expect(store.getState().saves.cloudState).toBe("failed");
  expect(store.getState().saves.cloudError).not.toContain("private credential");
  retryCloudSync();
  await settle();
  expect(store.getState().saves.cloudState).toBe("synced");
});

it("does not apply stale status after an account switch and syncs the new account", async () => {
  let resolve!: (value: { conflicts: boolean; deferred: boolean }) => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mockAuth({ uid: "alice" });
  const current = mockSync.mock.calls[0][1] as () => boolean;
  mockAuth({ uid: "bob" });
  expect(current()).toBe(false);
  resolve({ conflicts: true, deferred: false });
  await settle();
  expect(store.getState().saves.cloudUid).toBe("bob");
  expect(store.getState().saves.cloudConflicts).toBe(false);
  jest.advanceTimersByTime(1500);
  await settle();
  expect(mockSync.mock.calls[1][0]).toBe("bob");
});

it("surfaces partial failures while preserving normal local save state", async () => {
  mockSync.mockResolvedValueOnce({
    failed: true,
    conflicts: false,
    deferred: false,
  });
  mockAuth({ uid: "alice" });
  await settle();
  expect(store.getState().saves.cloudState).toBe("failed");
  expect(store.getState().saves.saveState).toBe("idle");
});

it("unsubscribes listeners and invalidates unfinished work on teardown", async () => {
  let resolve!: (value: { conflicts: boolean; deferred: boolean }) => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mockAuth({ uid: "alice" });
  const current = mockSync.mock.calls[0][1] as () => boolean;
  stop();
  expect(current()).toBe(false);
  expect(mockUnsubscribeAuth).toHaveBeenCalled();
  expect(mockUnsubscribeRepository).toHaveBeenCalled();
  resolve({ conflicts: false, deferred: false });
  await settle();
  window.dispatchEvent(new Event("focus"));
  jest.advanceTimersByTime(60_000);
  expect(mockSync).toHaveBeenCalledTimes(1);
  expect(store.getState().saves.cloudState).toBe("syncing");
});
