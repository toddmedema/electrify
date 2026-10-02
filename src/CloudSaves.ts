import type { AppStore } from "./Store";
import { firebaseAppAuth } from "./Globals";
import { sessionChanged } from "./SaveLibrary";
import { saveRepository } from "./SaveSession";
import { CloudSaveSync } from "./CloudSaveSync";
import { FirebaseSaveTransport } from "./CloudSaveTransport";

let retry = () => {};
export function retryCloudSync(): void {
  retry();
}

export function startCloudSaves(store: AppStore): () => void {
  const sync = new CloudSaveSync(saveRepository, new FirebaseSaveTransport());
  let uid: string | undefined;
  let generation = 0;
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (!uid || stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (!navigator.onLine) {
      store.dispatch(sessionChanged({ cloudState: "offline" }));
      return;
    }
    running = true;
    const account = uid;
    const request = generation;
    const current = () => !stopped && request === generation;
    store.dispatch(
      sessionChanged({ cloudState: "syncing", cloudError: undefined }),
    );
    try {
      const result = await sync.sync(account, current);
      if (current())
        store.dispatch(
          sessionChanged({
            cloudState: result.failed
              ? "failed"
              : result.deferred
                ? "syncing"
                : "synced",
            cloudError: result.failed
              ? "Some saves couldn't sync. Your device copies are still available. We'll retry automatically."
              : undefined,
            cloudConflicts:
              result.conflicts || store.getState().saves.cloudConflicts,
          }),
        );
    } catch (_error) {
      if (current())
        store.dispatch(
          sessionChanged({
            cloudState: navigator.onLine ? "failed" : "offline",
            cloudError:
              "Cloud backup couldn't finish. Your device saves are still available. We'll retry automatically.",
          }),
        );
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 1500);
  };
  const auth = firebaseAppAuth.onAuthStateChanged((user) => {
    generation++;
    uid = user?.uid;
    store.dispatch(
      sessionChanged({
        cloudUid: uid,
        cloudState: uid ? "syncing" : "signedOut",
        cloudError: undefined,
        cloudConflicts: false,
      }),
    );
    if (uid) void run();
  });
  const unsubscribe = saveRepository.subscribe(schedule);
  const checkpoint = setInterval(() => void run(), 60_000);
  const offline = () => {
    if (uid) store.dispatch(sessionChanged({ cloudState: "offline" }));
  };
  const wake = () => void run();
  retry = wake;
  window.addEventListener("online", wake);
  window.addEventListener("offline", offline);
  window.addEventListener("focus", wake);
  return () => {
    stopped = true;
    generation++;
    retry = () => {};
    auth();
    unsubscribe();
    clearTimeout(timer);
    clearInterval(checkpoint);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", offline);
    window.removeEventListener("focus", wake);
  };
}
