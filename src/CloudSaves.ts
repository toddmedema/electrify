import type { AppStore } from "./Store";
import { firebaseAppAuth } from "./Globals";
import { sessionChanged } from "./SaveLibrary";
import { saveRepository } from "./SaveSession";
import { AUTO_CLOUD_SAVE_MS, CloudSaveSync } from "./CloudSaveSync";
import { FirebaseSaveTransport } from "./CloudSaveTransport";
import { subscribeCloudSaveRequests } from "./SaveEffects";
import { ForegroundSync } from "./ForegroundSync";
import { isDesktopApp } from "./Desktop";

let retry = () => {};
export function retryCloudSync(): void {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
    void import("./DesktopSaves").then(({ retryDesktopCloud }) =>
      retryDesktopCloud(),
    );
    return;
  }
  retry();
}

export function startCloudSaves(store: AppStore): () => void {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
    let live = true;
    let stop = () => {};
    void import("./DesktopSaves").then(({ startDesktopSaves }) => {
      if (live) stop = startDesktopSaves(store);
    });
    return () => {
      live = false;
      stop();
    };
  }
  if (!firebaseAppAuth) return () => {};
  const transport = new FirebaseSaveTransport();
  const sync = new CloudSaveSync(saveRepository, transport);
  let uid: string | undefined;
  let generation = 0;
  let stopped = false;
  let running = false;
  let again = false;
  let lastRun = -Infinity;
  let forceAll = false;
  let remotePending = false;
  let localPending = false;
  let stopRemote: (() => void) | undefined;
  let listenerFailed = false;
  const forceIds = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publishState = (patch: Parameters<typeof sessionChanged>[0]) => {
    store.dispatch(sessionChanged(patch));
    if (patch.cloudState)
      coordinator.report({
        cloudState: patch.cloudState,
        cloudError: patch.cloudError,
      });
  };
  const run = async () => {
    if (!uid || stopped || !coordinator.isOwner()) return;
    if (running) {
      again = true;
      return;
    }
    const requests = coordinator.pending();
    for (const message of requests.values()) {
      if (message.id) forceIds.add(message.id);
      else forceAll = true;
    }
    if (!navigator.onLine) {
      publishState({ cloudState: "offline" });
      return;
    }
    if (
      !remotePending &&
      !forceAll &&
      !forceIds.size &&
      Date.now() - lastRun < AUTO_CLOUD_SAVE_MS
    )
      return;
    if (!remotePending && !localPending && !forceAll && !forceIds.size) return;
    running = true;
    remotePending = false;
    localPending = false;
    lastRun = Date.now();
    const options = { automatic: !forceAll, forceIds: new Set(forceIds) };
    forceAll = false;
    forceIds.clear();
    const account = uid;
    const request = generation;
    const current = () =>
      !stopped && request === generation && coordinator.isOwner();
    const requestedRevisions = new Map<string, number>();
    const retries = new Set<string>();
    publishState({ cloudState: "syncing", cloudError: undefined });
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
      if (current() && !result.failed && !result.deferred)
        coordinator.acknowledge(requests.keys());
      if (current() && (result.deferred || result.failed)) localPending = true;
      if (current())
        publishState({
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
        });
    } catch (_error) {
      if (current()) {
        localPending = true;
        requestedRevisions.forEach((_revision, id) => retries.add(id));
        options.forceIds.forEach((id) => retries.add(id));
      }
      if (current())
        publishState({
          cloudState: navigator.onLine ? "failed" : "offline",
          cloudError:
            "Cloud backup couldn't finish. Your device saves are still available. We'll retry automatically.",
        });
    } finally {
      running = false;
      const newRequest = forceAll || forceIds.size > 0;
      if (current()) retries.forEach((id) => forceIds.add(id));
      const rerun = again;
      again = false;
      if (
        !stopped &&
        coordinator.isOwner() &&
        (remotePending || (rerun && newRequest))
      )
        void run();
      else if (
        !stopped &&
        coordinator.isOwner() &&
        (rerun || retries.size || localPending)
      )
        schedule();
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        if (listenerFailed && coordinator.isOwner()) startRemote();
        void run();
      },
      Math.max(1500, AUTO_CLOUD_SAVE_MS - (Date.now() - lastRun)),
    );
  };
  const startRemote = () => {
    stopRemote?.();
    listenerFailed = false;
    if (!uid || !coordinator.isOwner()) return;
    const request = generation;
    remotePending = true;
    stopRemote = transport.subscribe?.(
      uid,
      () => {
        if (request !== generation || !coordinator.isOwner()) return;
        remotePending = true;
        void run();
      },
      () => {
        if (request !== generation || !coordinator.isOwner()) return;
        listenerFailed = true;
        localPending = true;
        publishState({ cloudState: "failed" });
        schedule();
      },
    );
    void run();
  };
  const coordinator = new ForegroundSync<{ id?: string }>(
    "cloud-saves",
    (owner) => {
      generation++;
      stopRemote?.();
      stopRemote = undefined;
      sync.reset?.();
      clearTimeout(timer);
      if (owner) startRemote();
    },
    () => void run(),
    (value): value is { id?: string } =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (!("id" in value) ||
        (typeof value.id === "string" &&
          value.id.length > 0 &&
          value.id.length <= 200)),
    (value) => {
      if (!value || typeof value !== "object" || !("cloudState" in value))
        return;
      const cloudState = value.cloudState;
      if (
        cloudState === "syncing" ||
        cloudState === "synced" ||
        cloudState === "failed" ||
        cloudState === "offline"
      )
        store.dispatch(
          sessionChanged({
            cloudState,
            cloudError:
              "cloudError" in value && typeof value.cloudError === "string"
                ? value.cloudError
                : undefined,
          }),
        );
    },
  );
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
        cloudState: uid
          ? navigator.onLine
            ? "syncing"
            : "offline"
          : "signedOut",
        cloudError: undefined,
        cloudConflicts: false,
        incompatibleCloudSaves: [],
      }),
    );
    localPending = true;
    coordinator.setAccount(uid);
    if (uid && coordinator.isOwner()) startRemote();
  });
  const unsubscribe = saveRepository.subscribe(() => {
    localPending = true;
    if (coordinator.isOwner()) schedule();
  });
  const unsubscribeRequests = subscribeCloudSaveRequests((id) => {
    if (uid) coordinator.request(id ? { id } : {});
    else if (id) forceIds.add(id);
    else forceAll = true;
    void run();
  });
  const offline = () => {
    if (uid) publishState({ cloudState: "offline" });
  };
  const wake = () => {
    if (localPending || listenerFailed || forceAll || forceIds.size) void run();
  };
  retry = () => {
    if (uid) coordinator.request({});
    else forceAll = true;
    void run();
  };
  window.addEventListener("online", wake);
  window.addEventListener("offline", offline);
  window.addEventListener("focus", wake);
  return () => {
    stopped = true;
    generation++;
    retry = () => {};
    auth();
    unsubscribe();
    unsubscribeRequests();
    clearTimeout(timer);
    coordinator.stop();
    stopRemote?.();
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", offline);
    window.removeEventListener("focus", wake);
  };
}
