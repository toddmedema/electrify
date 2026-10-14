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
  let lastSync = 0;
  let previous = store.getState().game;
  let observed = "";
  let priorAccountAwards = new Set<string>();
  let priorAccountCompletion = "";
  let uid = store.getState().user.uid;
  journal.activate(uid);
  const current = (owner: string, generation: number) =>
    !stopped && uid === owner && generation === epoch;
  const sync = async () => {
    journal.retryStorage();
    if (stopped || !uid || !transport || inFlight) return;
    const progress = journal.getSnapshot().progress;
    const signature = JSON.stringify(progress);
    if (signature === acknowledged && Date.now() - lastSync < 300_000) return;
    if (!navigator.onLine) {
      journal.setSync("offline");
      return;
    }
    const owner = uid;
    const generation = epoch;
    inFlight = true;
    journal.setSync("syncing");
    try {
      const remote = await transport.merge(owner, progress, () =>
        current(owner, generation),
      );
      if (!current(owner, generation)) return;
      journal.merge(remote);
      acknowledged = JSON.stringify(remote);
      lastSync = Date.now();
      journal.setSync(
        JSON.stringify(journal.getSnapshot().progress) === acknowledged
          ? "synced"
          : "syncing",
      );
    } catch {
      if (current(owner, generation))
        journal.setSync(navigator.onLine ? "failed" : "offline");
    } finally {
      inFlight = false;
      if (
        !stopped &&
        (generation !== epoch ||
          (journal.getSnapshot().sync === "syncing" &&
            JSON.stringify(journal.getSnapshot().progress) !== acknowledged))
      )
        void sync();
    }
  };
  const publish = () => {
    const { game, user, saves } = store.getState();
    if (uid !== user.uid) {
      uid = user.uid;
      epoch++;
      observed = "";
      acknowledged = "";
      priorAccountAwards = new Set(game.desktopAchievements?.earned ?? []);
      priorAccountCompletion = JSON.stringify(
        game.desktopAchievements?.completion,
      );
      journal.activate(uid);
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
    if (saves.transitioning || game.replayPlayback || game.customScenario)
      return;
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
  publish();
  void sync();
  const unsubscribe = store.subscribe(publish);
  const wake = () => {
    void sync();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === ACHIEVEMENT_STORAGE_KEY) {
      journal.refresh();
      void sync();
    }
  };
  retrySync = wake;
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("storage", storageChanged);
  const retry = setInterval(wake, 30_000);
  return () => {
    stopped = true;
    if (retrySync === wake) retrySync = () => {};
    unsubscribe();
    stopSteam?.();
    clearInterval(retry);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("storage", storageChanged);
  };
}
