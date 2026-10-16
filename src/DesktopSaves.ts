import type { AppStore } from "./Store";
import { flushShutdownCheckpoints } from "./desktop/Shutdown";
import { getDesktop } from "./Desktop";
import {
  DesktopSaveTransport,
  parseDesktopLibrary,
} from "./DesktopSaveTransport";
import { AUTO_CLOUD_SAVE_MS, CloudSaveSync } from "./CloudSaveSync";
import {
  saveRepository,
  checkpointForDesktopExit,
  releaseDesktopSaveWriter,
  refreshSavedGames,
} from "./SaveSession";
import { sessionChanged } from "./SaveLibrary";
import { subscribeCloudSaveRequests } from "./SaveEffects";
import { pageHidden } from "./reducers/GameActions";

// Saves already live in IndexedDB; this mirror guards against losing that database. Each write
// carries every save, so batch the 15-second play checkpoints rather than mirroring each one.
// Quitting always writes the latest state.
const DESKTOP_BACKUP_INTERVAL_MS = 60 * 1000;
const DESKTOP_BACKUP_DEBOUNCE_MS = 250;

let transport: DesktopSaveTransport | undefined;
let retry = () => {};
export function retryDesktopCloud(): void {
  retry();
}

/** Restore durable device files before the first menu can select or start a game. */
export async function initializeDesktopSaves(): Promise<void> {
  const desktop = getDesktop();
  if (!desktop) return;
  await saveRepository.initialize();
  // Unlike the browser, no other native writer can remain alive across startup. Recover
  // leases from a crashed process before the restored library becomes selectable.
  await saveRepository.recoverDesktopWriterLeases();
  const saved = await desktop.readSaveLibrary();
  transport = new DesktopSaveTransport(desktop, saveRepository);
  if (saved.local) {
    // A record this version can't read must not keep the player out of every other save.
    const library = parseDesktopLibrary(saved.local, {
      skipInvalidRecords: true,
    });
    if (library.repository)
      await saveRepository.restoreBackup(library.repository);
    transport.seed(library);
  }
  await saveRepository.markDesktopInitialized();
}

export function startDesktopSaves(store: AppStore): () => void {
  const desktop = getDesktop();
  if (!desktop) return () => {};
  transport ||= new DesktopSaveTransport(desktop, saveRepository);
  const currentTransport = transport;
  const sync = new CloudSaveSync(saveRepository, currentTransport);
  let stopped = false;
  let running: Promise<void> | undefined;
  let backupTail = Promise.resolve();
  let backupTimer: ReturnType<typeof setTimeout> | undefined;
  let lastBackupAt = -Infinity;
  const cancelBackup = () => {
    clearTimeout(backupTimer);
    backupTimer = undefined;
  };
  const persist = (): Promise<void> => {
    lastBackupAt = Date.now();
    backupTail = backupTail
      .catch(() => undefined)
      .then(async () => {
        const state = await desktop.getState();
        if (state.steam.steamId)
          await currentTransport.captureDevice(`steam:${state.steam.steamId}`);
        await desktop.writeSaveLibrary(await currentTransport.library(), false);
      });
    return backupTail;
  };
  const reportDiskFailure = () =>
    store.dispatch(
      sessionChanged({
        saveState: "failed",
        saveError:
          "The desktop backup couldn't be written. Your game remains in device storage. Retry saving before quitting.",
      }),
    );
  const changed = () => {
    // A scheduled write captures every change made before it runs.
    if (backupTimer !== undefined) return;
    backupTimer = setTimeout(
      () => {
        backupTimer = undefined;
        void persist().catch(reportDiskFailure);
      },
      Math.max(
        DESKTOP_BACKUP_DEBOUNCE_MS,
        lastBackupAt + DESKTOP_BACKUP_INTERVAL_MS - Date.now(),
      ),
    );
  };
  const run = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      const state = await desktop.getState();
      if (stopped) return;
      const uid = state.steam.steamId
        ? `steam:${state.steam.steamId}`
        : undefined;
      if (!uid || !state.steam.online || !state.steam.cloudEnabled) {
        store.dispatch(
          sessionChanged({
            cloudUid: uid,
            cloudState: "offline",
            cloudError: !state.steam.cloudEnabled
              ? "Steam Cloud is disabled. Games save on this device."
              : "Steam is offline. Games save on this device.",
          }),
        );
        return;
      }
      store.dispatch(
        sessionChanged({
          cloudUid: uid,
          cloudState: "syncing",
          cloudError: undefined,
        }),
      );
      try {
        const result = await sync.sync(uid, () => !stopped);
        if (stopped) return;
        // Publish the merged catalog even when this pass only restored remote games.
        const committed = await desktop.writeSaveLibrary(
          await currentTransport.library(),
          true,
        );
        store.dispatch(
          sessionChanged({
            cloudState:
              result.failed || committed.cloudState === "failed"
                ? "failed"
                : committed.cloudState !== "ready"
                  ? "offline"
                  : result.deferred
                    ? "syncing"
                    : "synced",
            cloudConflicts:
              result.conflicts || store.getState().saves.cloudConflicts,
            incompatibleCloudSaves: result.incompatibleCloudSaves || [],
            cloudError: result.failed
              ? "Some Steam Cloud backups couldn't sync. Your device saves are still available."
              : undefined,
          }),
        );
      } catch {
        if (!stopped)
          store.dispatch(
            sessionChanged({
              cloudState: "failed",
              cloudError:
                "Steam Cloud couldn't finish. Your device saves are still available; sync will retry.",
            }),
          );
      } finally {
        await persist().catch(reportDiskFailure);
        await refreshSavedGames();
      }
    })()
      .catch(() => {
        if (!stopped) store.dispatch(sessionChanged({ cloudState: "offline" }));
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };
  const unsubscribeRepository = saveRepository.subscribe(changed);
  const unsubscribeRequests = subscribeCloudSaveRequests(() => void run());
  const unsubscribeState = desktop.onStateChanged(() => void run());
  const beforeQuit = desktop.onBeforeQuit(() => {
    store.dispatch(pageHidden());
    void (async () => {
      // A failed co-op save must still report failure, but it must not skip this game's own
      // exit save, so both run and the co-op result is checked before quitting.
      const sharedCheckpoints = flushShutdownCheckpoints().then(
        () => undefined,
        (error: unknown) => error ?? new Error("Co-op save failed"),
      );
      try {
        await checkpointForDesktopExit();
        cancelBackup();
        await persist().catch((error) => {
          reportDiskFailure();
          throw error;
        });
        // Steam caches FileWrite locally and uploads asynchronously after the game exits.
        // Do not wait for the remote read/reconciliation loop during shutdown.
        const state = await desktop.getState();
        if (state.steam.steamId && state.steam.cloudEnabled) {
          await currentTransport.captureDevice(`steam:${state.steam.steamId}`);
          const library = await currentTransport.library();
          await desktop.writeSaveLibrary(library, false);
          await desktop.writeSaveLibrary(library, true).catch(() => undefined);
        }
        const sharedFailure = await sharedCheckpoints;
        if (sharedFailure) throw sharedFailure;
        await releaseDesktopSaveWriter();
        desktop.readyToQuit(true);
      } catch {
        // The native quit warning offers retry, return, or quit; a second in-game dialog would
        // only repeat it. Returning leaves the failed save state in the app bar.
        desktop.readyToQuit(false);
      }
    })();
  });
  const timer = setInterval(() => void run(), AUTO_CLOUD_SAVE_MS);
  const wake = () => void run();
  window.addEventListener("focus", wake);
  retry = wake;
  void run();
  return () => {
    stopped = true;
    retry = () => {};
    cancelBackup();
    clearInterval(timer);
    unsubscribeRepository();
    unsubscribeRequests();
    unsubscribeState();
    beforeQuit();
    window.removeEventListener("focus", wake);
  };
}
