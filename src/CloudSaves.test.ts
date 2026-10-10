import { configureStore } from "@reduxjs/toolkit";
import savesReducer from "./SaveLibrary";
import { startCloudSaves, retryCloudSync } from "./CloudSaves";
import type { AppStore } from "./Store";
import { requestCloudSave } from "./SaveEffects";

let mockAuth: (user: { uid: string } | null) => void;
let mockChanged: () => void;
const mockSync = jest.fn();
const mockList = jest.fn();
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
    list: () => mockList(),
    subscribe: (callback: () => void) => {
      mockChanged = callback;
      return mockUnsubscribeRepository;
    },
  },
}));
jest.mock("./CloudSaveSync", () => ({
  AUTO_CLOUD_SAVE_MS: 300_000,
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
  mockList.mockResolvedValue([]);
  store = configureTestStore();
  stop = startCloudSaves(store as unknown as AppStore);
});
afterEach(() => {
  stop();
  jest.useRealTimers();
});

it("keeps signed-out play independent of cloud and rate limits automatic syncs", async () => {
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
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  jest.advanceTimersByTime(299_999);
  expect(mockSync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await settle();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockSync.mock.calls[1][2]).toMatchObject({ automatic: true });
});

it("immediately syncs an explicitly saved game, including an interaction during another sync", async () => {
  let resolve!: (value: { conflicts: boolean; deferred: boolean }) => void;
  mockSync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mockAuth({ uid: "alice" });
  requestCloudSave("A");
  resolve({ conflicts: false, deferred: false });
  await settle();
  expect(mockSync).toHaveBeenCalledTimes(2);
  expect(mockSync.mock.calls[1][2].forceIds).toEqual(new Set(["A"]));
  requestCloudSave("B");
  await settle();
  expect(mockSync).toHaveBeenCalledTimes(3);
  expect(mockSync.mock.calls[2][2].forceIds).toEqual(new Set(["B"]));
});

it("retains an explicit save requested offline for reconnection", async () => {
  mockAuth({ uid: "alice" });
  await settle();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  requestCloudSave("A");
  expect(mockSync).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  window.dispatchEvent(new Event("online"));
  await settle();
  expect(mockSync.mock.calls[1][2].forceIds).toEqual(new Set(["A"]));
});

it("preserves the explicit sharing request when a signed-out player signs in", async () => {
  mockAuth(null);
  requestCloudSave("A");
  mockAuth({ uid: "alice" });
  await settle();
  expect(mockSync.mock.calls[0][2].forceIds).toEqual(new Set(["A"]));
});

it("retries a failed explicit save even when automatic progress limits have not been met", async () => {
  mockAuth({ uid: "alice" });
  await settle();
  mockList.mockResolvedValue([
    { id: "A", revision: 2, cloud: { uid: "alice", syncedRevision: 1 } },
  ]);
  mockSync.mockResolvedValueOnce({
    conflicts: false,
    deferred: false,
    failed: true,
  });
  requestCloudSave("A");
  await settle();
  expect(mockSync).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(300_000);
  await settle();
  expect(mockSync.mock.calls[2][2].forceIds).toEqual(new Set(["A"]));
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

it("shows incompatible backups separately and clears them on account changes", async () => {
  const issues = [{ id: "old", name: "Old grid", version: "1" }];
  mockSync.mockResolvedValueOnce({
    conflicts: false,
    deferred: false,
    incompatibleCloudSaves: issues,
  });
  mockAuth({ uid: "alice" });
  await settle();
  expect(store.getState().saves).toMatchObject({
    cloudState: "synced",
    incompatibleCloudSaves: issues,
  });
  expect(store.getState().saves.cloudError).toBeUndefined();
  mockSync.mockRejectedValueOnce(new Error("offline"));
  retryCloudSync();
  await settle();
  expect(store.getState().saves.incompatibleCloudSaves).toEqual(issues);
  mockAuth({ uid: "bob" });
  await settle();
  expect(store.getState().saves.incompatibleCloudSaves).toEqual([]);
  mockAuth(null);
  expect(store.getState().saves.incompatibleCloudSaves).toEqual([]);
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
