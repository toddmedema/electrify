import { startDesktopSaves } from "./DesktopSaves";
import type { DesktopBridge, DesktopPowerState } from "./Desktop";
import type { AppStore } from "./Store";
import {
  checkpointForDesktopExit,
  renewDesktopSaveWriter,
  releaseDesktopSaveWriter,
  refreshSavedGames,
} from "./SaveSession";
import { registerShutdownCheckpoint } from "./desktop/Shutdown";

jest.mock("./SaveSession", () => ({
  saveRepository: {
    subscribe: () => () => {},
  },
  checkpointForDesktopExit: jest.fn().mockResolvedValue(undefined),
  renewDesktopSaveWriter: jest.fn().mockResolvedValue(undefined),
  releaseDesktopSaveWriter: jest.fn().mockResolvedValue(undefined),
  refreshSavedGames: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./DesktopSaveTransport", () => ({
  DesktopSaveTransport: class {
    captureDevice = jest.fn().mockResolvedValue(undefined);
    library = jest.fn().mockResolvedValue({});
  },
}));
jest.mock("./CloudSaveSync", () => ({
  AUTO_CLOUD_SAVE_MS: 60000,
  CloudSaveSync: class {},
}));
jest.mock("./SaveEffects", () => ({
  subscribeCloudSaveRequests: () => () => {},
}));

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let changed!: (power: DesktopPowerState) => void;
  const desktop = {
    apiVersion: 1,
    getState: jest.fn().mockResolvedValue({
      steam: { cloudEnabled: false },
      power: { phase: "awake", generation: 0 },
    }),
    onPowerStateChanged: (listener: typeof changed) => {
      changed = listener;
      return jest.fn();
    },
    onStateChanged: () => () => {},
    onBeforeQuit: () => () => {},
    readyAfterResume: jest.fn().mockResolvedValue(undefined),
    writeSaveLibrary: jest.fn().mockResolvedValue({ cloudState: "disabled" }),
  } as unknown as DesktopBridge;
  window.electrifyDesktop = desktop;
  const store = {
    dispatch: jest.fn(),
    getState: () => ({ saves: {} }),
  } as unknown as AppStore;
  const stop = startDesktopSaves(store);
  return {
    desktop,
    changed: (power: DesktopPowerState) => changed(power),
    stop,
    store,
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (refreshSavedGames as jest.Mock).mockResolvedValue(undefined);
  (checkpointForDesktopExit as jest.Mock).mockResolvedValue(undefined);
  (renewDesktopSaveWriter as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => {
  delete window.electrifyDesktop;
  jest.useRealTimers();
});

test("sleep checkpoints solo and co-op progress without releasing the writer; wake waits for disk", async () => {
  const f = fixture();
  const shared = deferred();
  const participant = jest.fn().mockReturnValue(shared.promise);
  const stopParticipant = registerShutdownCheckpoint(participant);
  const disk = deferred();
  (f.desktop.writeSaveLibrary as jest.Mock).mockReturnValueOnce(disk.promise);
  try {
    f.changed({ phase: "suspended", generation: 1 });
    f.changed({ phase: "resuming", generation: 2 });
    await settle();
    expect(participant).toHaveBeenCalledWith("suspend");
    expect(checkpointForDesktopExit).toHaveBeenCalledTimes(1);
    expect(f.desktop.readyAfterResume).not.toHaveBeenCalled();
    expect(releaseDesktopSaveWriter).not.toHaveBeenCalled();
    disk.resolve();
    shared.resolve();
    await settle();
    expect(renewDesktopSaveWriter).toHaveBeenCalledTimes(1);
    expect(checkpointForDesktopExit).toHaveBeenCalledTimes(2);
    expect(f.desktop.readyAfterResume).toHaveBeenCalledWith(2);
    expect(releaseDesktopSaveWriter).not.toHaveBeenCalled();
  } finally {
    stopParticipant();
    f.stop();
  }
});

test("a second sleep prevents an old asynchronous wake from enabling native input", async () => {
  const f = fixture();
  const renewal = deferred();
  (renewDesktopSaveWriter as jest.Mock).mockReturnValueOnce(renewal.promise);
  try {
    f.changed({ phase: "resuming", generation: 2 });
    await settle();
    f.changed({ phase: "suspended", generation: 3 });
    renewal.resolve();
    await settle();
    expect(f.desktop.readyAfterResume).not.toHaveBeenCalled();
    f.changed({ phase: "resuming", generation: 4 });
    await settle();
    expect(f.desktop.readyAfterResume).toHaveBeenCalledTimes(1);
    expect(f.desktop.readyAfterResume).toHaveBeenCalledWith(4);
  } finally {
    f.stop();
  }
});

test("a failed wake lease renewal reports a local save error and still returns UI control", async () => {
  const f = fixture();
  (renewDesktopSaveWriter as jest.Mock).mockRejectedValueOnce(
    new Error("Writer changed"),
  );
  try {
    f.changed({ phase: "resuming", generation: 2 });
    await settle();
    expect(f.store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ saveState: "failed" }),
      }),
    );
    expect(f.desktop.readyAfterResume).toHaveBeenCalledWith(2);
    expect(releaseDesktopSaveWriter).not.toHaveBeenCalled();
  } finally {
    f.stop();
  }
});
