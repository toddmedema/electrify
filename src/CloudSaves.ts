import type { AppStore } from "./Store";
import { firebaseAppAuth } from "./Globals";
import { sessionChanged } from "./SaveLibrary";
import { saveRepository } from "./SaveSession";
import { AUTO_CLOUD_SAVE_MS, CloudSaveSync } from "./CloudSaveSync";
import { FirebaseSaveTransport } from "./CloudSaveTransport";
import { subscribeCloudSaveRequests } from "./SaveEffects";
import { downloadSaveRecovery } from "./SaveFile";
import type { IncompatibleCloudSave } from "./Types";

const SIGN_IN_TO_RECOVER = "Sign in to the account that owns this backup.";
let retry = () => {};
let recover = (_issue: IncompatibleCloudSave): Promise<void> =>
  Promise.reject(new Error(SIGN_IN_TO_RECOVER));
export function retryCloudSync(): void {
  retry();
}
/** Download a retained backup exactly as stored, for the account that is still signed in. */
export function downloadCloudRecovery(
  issue: IncompatibleCloudSave,
): Promise<void> {
  return recover(issue);
}

export function startCloudSaves(store: AppStore): () => void {
  const transport = new FirebaseSaveTransport();
  const sync = new CloudSaveSync(saveRepository, transport);
  let uid: string | undefined;
  let generation = 0;
  let stopped = false;
  let running = false;
  let again = false;
  let lastRun = -Infinity;
  let forceAll = false;
  const forceIds = new Set<string>();
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
    if (
      !forceAll &&
      !forceIds.size &&
      Date.now() - lastRun < AUTO_CLOUD_SAVE_MS
    )
      return;
    running = true;
    lastRun = Date.now();
    const options = { automatic: !forceAll, forceIds: new Set(forceIds) };
    forceAll = false;
    forceIds.clear();
    const account = uid;
    const request = generation;
    const current = () => !stopped && request === generation;
    const requestedRevisions = new Map<string, number>();
    const retries = new Set<string>();
    store.dispatch(
      sessionChanged({ cloudState: "syncing", cloudError: undefined }),
    );
    try {
      if (!options.automatic || options.forceIds.size) {
        for (const entry of await saveRepository.list()) {
          if (
            (!entry.cloud || entry.cloud.uid === account) &&
            (!options.automatic || options.forceIds.has(entry.id))
          )
            requestedRevisions.set(entry.id, entry.revision);
        }
      }
      const result = await sync.sync(account, current, options);
      if (
        current() &&
        (result.failed || result.deferred) &&
        requestedRevisions.size
      ) {
        for (const entry of await saveRepository.list()) {
          if (
            (entry.cloud?.syncedRevision || 0) <
            (requestedRevisions.get(entry.id) || 0)
          )
            retries.add(entry.id);
        }
      }
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
            incompatibleCloudSaves: result.incompatibleCloudSaves || [],
            cloudConflicts:
              result.conflicts || store.getState().saves.cloudConflicts,
          }),
        );
    } catch (_error) {
      if (current()) {
        requestedRevisions.forEach((_revision, id) => retries.add(id));
        options.forceIds.forEach((id) => retries.add(id));
      }
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
      const newRequest = forceAll || forceIds.size > 0;
      if (current()) retries.forEach((id) => forceIds.add(id));
      if ((again || retries.size) && !stopped) {
        again = false;
        if (newRequest) void run();
        else schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => void run(),
      Math.max(1500, AUTO_CLOUD_SAVE_MS - (Date.now() - lastRun)),
    );
  };
  const auth = firebaseAppAuth.onAuthStateChanged((user) => {
    generation++;
    const previousUid = uid;
    uid = user?.uid;
    lastRun = -Infinity;
    if (previousUid) {
      forceAll = false;
      forceIds.clear();
    }
    store.dispatch(
      sessionChanged({
        cloudUid: uid,
        cloudState: uid ? "syncing" : "signedOut",
        cloudError: undefined,
        cloudConflicts: false,
        incompatibleCloudSaves: [],
      }),
    );
    if (uid) void run();
  });
  const unsubscribe = saveRepository.subscribe(schedule);
  const unsubscribeRequests = subscribeCloudSaveRequests((id) => {
    if (id) forceIds.add(id);
    else forceAll = true;
    void run();
  });
  const checkpoint = setInterval(() => void run(), AUTO_CLOUD_SAVE_MS);
  const offline = () => {
    if (uid) store.dispatch(sessionChanged({ cloudState: "offline" }));
  };
  const wake = () => void run();
  retry = () => {
    forceAll = true;
    void run();
  };
  recover = async (issue) => {
    const account = uid;
    const request = generation;
    if (!account) throw new Error(SIGN_IN_TO_RECOVER);
    const raw = await transport.readOriginal(account, issue.id, issue.version);
    // The account changed or cloud saves stopped while the payload was in flight.
    if (stopped || request !== generation) throw new Error(SIGN_IN_TO_RECOVER);
    downloadSaveRecovery(issue.id, raw);
  };
  window.addEventListener("online", wake);
  window.addEventListener("offline", offline);
  window.addEventListener("focus", wake);
  return () => {
    stopped = true;
    generation++;
    retry = () => {};
    recover = () => Promise.reject(new Error(SIGN_IN_TO_RECOVER));
    auth();
    unsubscribe();
    unsubscribeRequests();
    clearTimeout(timer);
    clearInterval(checkpoint);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", offline);
    window.removeEventListener("focus", wake);
  };
}
