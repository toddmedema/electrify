import { ForegroundSync } from "../ForegroundSync";
import type { AppStore } from "../Store";
import { firebaseAppAuth } from "../Globals";
import { getDesktop } from "../Desktop";
import { achievementHooks } from "./Achievements";
import { installSimulationHooks } from "./SimulationHooks";
import {
  achievementJournal,
  AchievementJournal,
  ACHIEVEMENT_STORAGE_KEY,
} from "./Journal";
import { FirebaseAchievementTransport } from "./FirebaseTransport";
import type { AchievementTransport } from "./FirebaseTransport";
import { recordIntent } from "./Progress";

export function initializeAchievements(): void {
  installSimulationHooks(achievementHooks);
}
let retrySync = () => {};
export function retryAchievementSync() {
  retrySync();
}

/** Observes committed evidence; cloud downloads and restored history are silent. */
export function startAchievementServices(
  store: Pick<AppStore, "getState" | "subscribe">,
  journal: AchievementJournal = achievementJournal,
  transport: AchievementTransport | undefined = firebaseAppAuth
    ? new FirebaseAchievementTransport()
    : undefined,
): () => void {
  let stopped = false;
  let epoch = 0;
  let inFlight = false;
  let acknowledged = "";
  let refreshPending = true;
  let retryDelay = 30_000;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let previous = store.getState().game;
  let observed = "";
  let priorAccountAwards = new Set<string>();
  let priorAccountCompletion = "";
  let uid = store.getState().user.uid;
  journal.activate(uid);
  const current = (owner: string, generation: number) =>
    !stopped && uid === owner && generation === epoch && coordinator.isOwner();
  const sync = async () => {
    journal.retryStorage();
    if (stopped || !uid || !transport || inFlight || !coordinator.isOwner())
      return;
    journal.refresh();
    const progress = journal.getSnapshot().progress;
    const signature = JSON.stringify(progress);
    const requests = coordinator.pending();
    if (!refreshPending && !requests.size && signature === acknowledged) return;
    if (!navigator.onLine) {
      journal.setSync("offline");
      return;
    }
    const owner = uid;
    const generation = epoch;
    inFlight = true;
    refreshPending = false;
    clearTimeout(retryTimer);
    journal.setSync("syncing");
    let succeeded = false;
    try {
      const remote = await transport.merge(owner, progress, () =>
        current(owner, generation),
      );
      if (!current(owner, generation)) return;
      acknowledged = JSON.stringify(remote);
      journal.merge(remote);
      coordinator.acknowledge(requests.keys());
      retryDelay = 30_000;
      succeeded = true;
      journal.setSync(
        JSON.stringify(journal.getSnapshot().progress) === acknowledged
          ? "synced"
          : "syncing",
      );
    } catch {
      if (current(owner, generation)) {
        refreshPending = true;
        journal.setSync(navigator.onLine ? "failed" : "offline");
        retryTimer = setTimeout(() => void sync(), retryDelay);
        retryDelay = Math.min(300_000, retryDelay * 2);
      }
    } finally {
      inFlight = false;
      if (
        !stopped &&
        (generation !== epoch ||
          (succeeded &&
            (refreshPending ||
              JSON.stringify(journal.getSnapshot().progress) !== acknowledged)))
      )
        void sync();
    }
  };
  const coordinator = new ForegroundSync<Record<string, never>>(
    "achievements",
    (owner) => {
      epoch++;
      clearTimeout(retryTimer);
      if (owner) {
        refreshPending = true;
        void sync();
      }
    },
    () => void sync(),
    (value): value is Record<string, never> =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0,
  );
  const publish = () => {
    const { game, user, saves } = store.getState();
    if (uid !== user.uid) {
      uid = user.uid;
      epoch++;
      observed = "";
      acknowledged = "";
      refreshPending = true;
      clearTimeout(retryTimer);
      priorAccountAwards = new Set(game.desktopAchievements?.earned ?? []);
      priorAccountCompletion = JSON.stringify(
        game.desktopAchievements?.completion,
      );
      journal.activate(uid);
      coordinator.setAccount(uid);
      refreshNative();
      void sync();
    }
    const progress = game.desktopAchievements;
    const preceding = previous;
    previous = game;
    // Evidence only changes during live play. Anything already present outside it came with a
    // loaded save or shared link, which may be another player's or another account's run.
    if (!progress || !game.inGame) {
      priorAccountAwards = new Set(progress?.earned ?? []);
      priorAccountCompletion = JSON.stringify(progress?.completion);
      return;
    }
    if (saves.transitioning || game.customScenario) return;
    const intent = {
      earned: progress.earned.filter((id) => !priorAccountAwards.has(id)),
      completion:
        JSON.stringify(progress.completion) === priorAccountCompletion
          ? undefined
          : progress.completion,
    };
    const key = JSON.stringify(intent);
    if (key === observed || (!intent.earned.length && !intent.completion))
      return;
    observed = key;
    journal.merge(
      recordIntent(intent),
      !!preceding.inGame && !!preceding.desktopAchievements,
    );
    // Credit each piece of run evidence once. Re-sending it would re-announce an award another
    // tab has since moved into an account, and put it back in the guest record to be claimed again.
    intent.earned.forEach((id) => priorAccountAwards.add(id));
    if (intent.completion)
      priorAccountCompletion = JSON.stringify(intent.completion);
    void sync();
  };
  const desktop =
    process.env.REACT_APP_DESKTOP === "true" ? getDesktop() : undefined;
  const refreshNative = () => {
    const owner = uid;
    const generation = epoch;
    void desktop
      ?.readAchievements?.()
      .then((record) => {
        if (!stopped && owner === uid && generation === epoch)
          journal.merge(record);
      })
      .catch(() => undefined);
  };
  const updateSteam = (
    state: Awaited<ReturnType<NonNullable<typeof desktop>["getState"]>>,
  ) => {
    if (!stopped) journal.setSteamAvailable(state.steam.available);
  };
  const stopSteam = desktop?.onStateChanged(updateSteam);
  void desktop
    ?.getState()
    .then(updateSteam)
    .catch(() => undefined);
  refreshNative();
  coordinator.setAccount(uid);
  publish();
  void sync();
  const unsubscribe = store.subscribe(publish);
  const wake = () => {
    if (
      journal.getSnapshot().sync === "offline" ||
      journal.getSnapshot().sync === "failed"
    )
      refreshPending = true;
    void sync();
  };
  const deliberate = () => {
    coordinator.request({});
    void sync();
  };
  const foreground = () => {
    if (!document.hidden) wake();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === ACHIEVEMENT_STORAGE_KEY) {
      journal.refresh();
      void sync();
    }
  };
  retrySync = deliberate;
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("storage", storageChanged);
  // Local storage recovery is cheap and never forces an unchanged cloud transaction.
  const retry = setInterval(() => {
    journal.retryStorage();
  }, 30_000);
  const stopJournal = journal.subscribe(() => {
    if (
      JSON.stringify(journal.getSnapshot().progress) !== acknowledged &&
      journal.getSnapshot().sync !== "failed"
    )
      void Promise.resolve().then(sync);
  });
  document.addEventListener("visibilitychange", foreground);
  return () => {
    stopped = true;
    coordinator.stop();
    clearTimeout(retryTimer);
    stopJournal();
    document.removeEventListener("visibilitychange", foreground);
    if (retrySync === deliberate) retrySync = () => {};
    unsubscribe();
    stopSteam?.();
    clearInterval(retry);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("storage", storageChanged);
  };
}
