import { achievementJournal } from "../achievements/Journal";
import { unlockedDifficulty } from "../achievements/DifficultyUnlocks";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getDesktop } from "../Desktop";
import { firebaseAppAuth, login } from "../Globals";
import type { GameType } from "../Types";
import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { initWeather } from "../data/Weather";
import { waitForLoad } from "../helpers/WaitForLoad";
import { store, useAppSelector } from "../Store";
import { multiplayerSnapshot, quit } from "../reducers/GameActions";
import { navigate } from "../reducers/Card";
import {
  delta as uiDelta,
  dialogClose,
  dialogOpen,
  snackbarOpen,
} from "../reducers/UI";
import { registerShutdownCheckpoint } from "../desktop/Shutdown";
import { crossplayFailure } from "./CrossplayApi";
import { HOST_LEFT, isConnectionLoss, MultiplayerSession } from "./Session";
import {
  registerCoopControls,
  registerLobbyOpener,
  registerMultiplayerRuntime,
  showMultiplayerLobby,
} from "./Registry";
import Lobby from "./Lobby";
import SavesDialog from "./SavesDialog";
import CoopResult from "./Result";
import { runSaveTransition } from "../SaveSession";
import HostConnectionWarning from "./HostConnectionWarning";
import { selectionKey } from "./Browse";
import { coopSelection, hostSelection, isBrowseCard } from "./Choosing";
import { useDesktopState } from "../DesktopState";
import { createCrossplayApi } from "./CrossplayApi";
import {
  captureCrossplayInvite,
  clearCrossplayInvite,
  crossplayInviteLink,
  steamInviteLink,
} from "./CrossplayInvite";
import { onlineSessionServices } from "./OnlineSessionServices";

const CouchRoot =
  process.env.REACT_APP_DESKTOP === "true"
    ? lazy(() => import("../couch/Root"))
    : undefined;

/** Session lifetime follows the app; entering the normal game can unmount the main menu. */
export default function MultiplayerRoot() {
  const desktop = getDesktop();
  const canPlayLocally =
    desktop?.steamEdition === true && !!desktop.couchRequest;
  const [initialInvite] = useState(() => captureCrossplayInvite());
  const [open, setOpen] = useState(!!initialInvite);
  const [entryInviteCode, setEntryInviteCode] = useState(initialInvite);
  const steam = useDesktopState()?.steam;
  const steamName = steam?.displayName;
  const canAuthenticate = desktop
    ? desktop.steamEdition === true &&
      !!desktop.crossplayRequest &&
      steam?.online === true
    : !!firebaseAppAuth;
  const currentSteamName = useRef(steamName);
  currentSteamName.current = steamName;
  const [couchOpen, setCouchOpen] = useState(false);
  const localSession = useRef(false);
  localSession.current = couchOpen;
  const deferredInvite = useRef<() => void>();
  const [savesOpen, setSavesOpen] = useState(false);
  // The host has opened the scenario screens for the lobby; guests follow once it publishes.
  const choosing = useRef(false);
  const [watching, setWatching] = useState<string>();
  const [session] = useState(
    () =>
      new MultiplayerSession(
        onlineSessionServices(
          createCrossplayApi(),
          () => currentSteamName.current ?? store.getState().user.displayName,
        ),
        async () => (await import("./WorkerClient")).createMultiplayerWorker(),
        async () =>
          (await import("./WorkerClient")).createMultiplayerReplicaWorker(),
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const hasView = !!state.view;
  const lobbyId = state.lobby.lobbyId;
  const pendingCampaignId = state.pendingCampaign?.id;
  const coop = useAppSelector((app) => app.ui.coop);
  const appDialogOpen = useAppSelector((app) => app.ui.dialog.open);
  const discardInvite = () => {
    clearCrossplayInvite();
    setEntryInviteCode(undefined);
  };
  const reconnect = useCallback(() => {
    void session.reconnect();
  }, [session]);

  useEffect(() => {
    // Let the couch shell unmount and release its controls before joining online.
    if (!couchOpen && !lobbyId && !hasView && !state.busy)
      deferredInvite.current?.();
  }, [couchOpen, lobbyId, hasView, state.busy]);

  /** Choosing together ends with the lobby; scenario screens go back to single player. */
  const syncCoop = useCallback(() => {
    if (localSession.current) return;
    const current = session.getSnapshot();
    const app = store.getState();
    const { lobby, browse, view, pendingCampaign } = current;
    // A saved campaign replaces scenario selection; the previous screen must not republish it.
    if (pendingCampaign && !view) choosing.current = false;
    const host = !!lobby.lobbyId && lobby.hostId === lobby.selfId;
    const active =
      !!lobby.lobbyId && (host ? choosing.current : !!browse || !!view);
    if (!active) {
      if (app.ui.coop) {
        store.dispatch(uiDelta({ coop: undefined }));
        if (isBrowseCard(app.card.name)) store.dispatch(navigate("MAIN_MENU"));
      }
      return;
    }
    const next = coopSelection(
      current,
      host ? app.ui.coop?.custom : browse?.custom,
      host ? app.ui.coop?.modScenario : current.scenarioSnapshot,
    );
    if (JSON.stringify(next) !== JSON.stringify(app.ui.coop))
      store.dispatch(uiDelta({ coop: next }));
    if (view) return;
    if (host) {
      if (isBrowseCard(app.card.name) && app.card.name !== "CUSTOM_GAME") {
        store.dispatch(navigate("CUSTOM_GAME"));
        return;
      }
      const selection = hostSelection(
        store.getState(),
        unlockedDifficulty(achievementJournal.getSnapshot().progress),
      );
      if (selection && !next.starting) session.publishBrowse(selection);
    } else if (browse?.phase === "browsing") {
      // A guest follows the host's screen, scenario and difficulty.
      setOpen(false);
      if (app.card.name !== browse.card) store.dispatch(navigate(browse.card));
      if (
        app.ui.previewDifficulty !== browse.difficulty ||
        (browse.scenarioId !== undefined &&
          app.ui.scenarioPreview !== browse.scenarioId)
      )
        store.dispatch(
          uiDelta({
            previewDifficulty: browse.difficulty,
            scenarioPreview: browse.scenarioId ?? app.ui.scenarioPreview,
          }),
        );
    }
  }, [session]);

  useEffect(() => {
    if (pendingCampaignId && lobbyId && !hasView) setOpen(true);
  }, [pendingCampaignId, lobbyId, hasView]);

  const leaveLobby = useCallback(
    (skipSave = false) => {
      choosing.current = false;
      setOpen(false);
      setSavesOpen(false);
      return session.leave({ skipSave }).catch(() => undefined);
    },
    [session],
  );

  const returnFromInterruption = async () => {
    if (!session.canLeaveInterruption()) return;
    await leaveLobby(true);
    requestAnimationFrame(() => {
      const { card, ui } = store.getState();
      if (card.name === "MAIN_MENU" && !ui.dialog.open)
        document
          .querySelector<HTMLElement>("#menuCard [data-multiplayer-entry]")
          ?.focus({ preventScroll: true });
    });
  };

  /** The host shows the scenario screens to the lobby, which friends can join meanwhile. */
  const startChoosing = useCallback(() => {
    setOpen(false);
    const card = store.getState().card.name;
    choosing.current = true;
    if (card !== "CUSTOM_GAME") store.dispatch(navigate("CUSTOM_GAME"));
    syncCoop();
    // The saves bar appears once this computer's multiplayer saves are known, including one
    // just written by the match that ended.
    void session.refreshSaves().catch(() => undefined);
  }, [session, syncCoop]);

  const copyCode = useCallback(() => {
    const code = session.getSnapshot().lobby.inviteCode;
    if (!code) return;
    const shown = () =>
      store.dispatch(
        dialogOpen({
          open: true,
          title: "Invite code",
          message: `Friends can enter ${code} in Play with friends to join.`,
          closeText: "OK",
        }),
      );
    if (!navigator.clipboard) return shown();
    navigator.clipboard.writeText(code).then(
      () =>
        store.dispatch(
          snackbarOpen({
            message: "Invite code copied",
            open: true,
            timeout: 4000,
          }),
        ),
      shown,
    );
  }, [session]);

  const copyLink = useCallback(async () => {
    const token = session.getSnapshot().lobby.inviteToken;
    if (!token) return;
    const link = crossplayInviteLink(token);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      store.dispatch(
        snackbarOpen({
          message: "Invite link copied",
          open: true,
          timeout: 4000,
        }),
      );
    } catch {
      store.dispatch(
        dialogOpen({
          open: true,
          title: "Invite link",
          message: link,
          closeText: "OK",
        }),
      );
    }
  }, [session]);

  const authorize = useCallback(async () => {
    if (desktop?.steamEdition || !firebaseAppAuth) return;
    const token = await firebaseAppAuth.currentUser
      ?.getIdTokenResult()
      .catch(() => undefined);
    if (token?.signInProvider === "google.com") return;
    if (!(await login({ provider: "google" })))
      throw new Error("Sign in with Google to play online.");
  }, [desktop]);

  useEffect(() => {
    registerLobbyOpener(() => setOpen(true));
    let live = true,
      initialized = false,
      loading = false;
    let appliedGame: GameType | undefined;
    const sync = () => {
      const current = session.getSnapshot();
      if (!current.view?.game) {
        appliedGame = undefined;
        if (initialized) {
          initialized = false;
          registerMultiplayerRuntime(undefined);
          store.dispatch(quit());
        }
        return;
      }
      if (loading) return;
      if (!initialized) {
        loading = true;
        const location = current.view.game.location;
        void Promise.all([
          waitForLoad(initEconomy),
          waitForLoad(initFuelPrices),
          waitForLoad((done) => initWeather(location, done)),
        ])
          .then(async () => {
            if (!live) return;
            const entered = await runSaveTransition(() => {
              initialized = true;
              loading = false;
              registerMultiplayerRuntime({
                command: (command) => session.command(command),
                submit: (command) => session.submit(command),
                activity: (reason) => session.setActivity(reason),
                leave: (options) => session.leave(options),
                exportSave: () => session.exportSave(),
                subscribeStatus: session.subscribe,
                deviceSaveTime: () => session.getSnapshot().lobby.savedAt,
                onlineSaveTime: () => session.getSnapshot().lobby.sharedAt,
                reconnect,
              });
              setOpen(false);
              sync();
            });
            if (!entered) loading = false;
          })
          .catch((error) => {
            loading = false;
            store.dispatch(
              dialogOpen({
                open: true,
                title: "Could not prepare multiplayer",
                message: crossplayFailure(
                  error,
                  "Could not prepare multiplayer.",
                ),
              }),
            );
          });
        return;
      }
      // Pending commands, lobby heartbeats and save status also notify this subscription.
      // They must not replay the previous grid and repaint the whole game before input is sent.
      if (appliedGame === current.view.game) return;
      appliedGame = current.view.game;
      store.dispatch(multiplayerSnapshot(appliedGame));
    };
    const stop = session.subscribe(sync);
    const stopCoop = session.subscribe(syncCoop);
    const stopStore = store.subscribe(syncCoop);
    const stopProgress = achievementJournal.subscribe(syncCoop);
    registerCoopControls({
      start: (spec) => {
        if (
          spec.scenarioId !== CUSTOM_SCENARIO_ID ||
          !spec.customScenario ||
          spec.customScenario.mod
        )
          return;
        const selection = hostSelection(
          store.getState(),
          unlockedDifficulty(achievementJournal.getSnapshot().progress),
        );
        if (selection)
          session.publishBrowse({ ...selection, phase: "playing" });
        void session.start({ spec }).catch((error) => {
          store.dispatch(
            dialogOpen({
              open: true,
              title: "Could not start the shared game",
              message: crossplayFailure(
                error,
                "Could not start the shared game.",
              ),
            }),
          );
          syncCoop();
        });
      },
      ready: (ready) => {
        const browse = session.getSnapshot().browse;
        void session
          .setReady(ready && browse ? selectionKey(browse) : "")
          .catch(() => undefined);
      },
      returnToLobby: () => {
        choosing.current = false;
        setOpen(true);
        syncCoop();
      },
      back: () => {
        const { lobby } = session.getSnapshot();
        const host = lobby.hostId === lobby.selfId;
        // A host alone in its lobby has nobody to warn.
        if (host && lobby.members.length < 2) return leaveLobby();
        store.dispatch(
          dialogOpen({
            open: true,
            title: "Leave the lobby?",
            message: host
              ? "Your friends will return to the main menu."
              : "You'll stop following the host's game choice.",
            closeText: "Stay",
            actionLabel: "Leave lobby",
            destructive: true,
            action: () => {
              store.dispatch(dialogClose());
              leaveLobby();
            },
          }),
        );
      },
      copyCode,
      copyLink,
      manageLobby: showMultiplayerLobby,
      openSaves: () => setSavesOpen(true),
    });
    const acceptInvite = (invite: string) => {
      if (!live) return;
      const current = session.getSnapshot();
      if (
        localSession.current ||
        current.lobby.lobbyId ||
        current.view ||
        current.busy
      ) {
        deferredInvite.current = () => acceptInvite(invite);
        return;
      }
      deferredInvite.current = undefined;
      choosing.current = false;
      setOpen(true);
      setEntryInviteCode(invite);
    };
    const acceptWebInvite = () => {
      const invite = captureCrossplayInvite(true);
      if (invite) acceptInvite(invite);
    };
    window.addEventListener("hashchange", acceptWebInvite);
    desktop
      ?.takeCrossplayInvite?.()
      .then((invite) => {
        if (invite) acceptInvite(invite);
      })
      .catch(() => undefined);
    const stopInvites = desktop?.onCrossplayInvite?.(() => {
      void desktop
        .takeCrossplayInvite?.()
        .then((invite) => {
          if (invite) acceptInvite(invite);
        })
        .catch(() => undefined);
    });
    void session.initialize().catch(() => undefined);
    return () => {
      live = false;
      deferredInvite.current = undefined;
      stop();
      stopInvites?.();
      window.removeEventListener("hashchange", acceptWebInvite);
      stopCoop();
      stopStore();
      stopProgress();
      registerLobbyOpener(undefined);
      registerCoopControls(undefined);
      registerMultiplayerRuntime(undefined);
      session.dispose();
    };
  }, [session, syncCoop, leaveLobby, copyCode, copyLink, desktop, reconnect]);
  useEffect(() => {
    if (!hasView) return;
    return registerShutdownCheckpoint((reason) => {
      if (reason === "quit" && state.lobby.hostId !== state.lobby.selfId)
        return Promise.resolve();
      return session.save(true, reason === "suspend");
    });
  }, [session, hasView, state.lobby.hostId, state.lobby.selfId]);
  const host =
    !!state.lobby.selfId && state.lobby.hostId === state.lobby.selfId;
  const canLeaveInterruption = session.canLeaveInterruption();
  const stoppedReplica = session.hasStoppedReplica();
  const connectionError = isConnectionLoss(state.error, state.lobby.error);
  const guestConnectionLost =
    canLeaveInterruption && connectionError && (hasView || (!!coop && !open));
  const endReason = state.checkpointRecovery
    ? "checkpoint"
    : hasView && guestConnectionLost && !lobbyId
      ? "roomUnavailable"
      : undefined;
  const interrupted =
    !!endReason ||
    !!state.synchronizing ||
    (hasView && state.waitingForHost && canLeaveInterruption) ||
    guestConnectionLost;

  useEffect(() => {
    const error = state.error || state.lobby.error;
    if (error === HOST_LEFT && !open) {
      store.dispatch(
        dialogOpen({
          open: true,
          title: "Multiplayer",
          message: error,
          closeText: "OK",
        }),
      );
      session.dismissError();
      return;
    }
    if (
      !error ||
      !(hasView || (coop && !open)) ||
      (interrupted && (connectionError || state.synchronizing))
    )
      return;
    store.dispatch(
      dialogOpen({
        open: true,
        title: "Multiplayer",
        message: error,
        closeText: "OK",
        ...((connectionError || stoppedReplica) && {
          closeText: "Close",
          actionLabel: "Reconnect",
          action: () => {
            store.dispatch(dialogClose());
            reconnect();
          },
        }),
      }),
    );
    session.dismissError();
  }, [
    session,
    state.error,
    state.lobby.error,
    state.synchronizing,
    hasView,
    coop,
    open,
    interrupted,
    connectionError,
    stoppedReplica,
    reconnect,
  ]);

  // Another company retiring is news while the rest of the lobby plays on.
  const results = useAppSelector((app) => app.game.multiplayer?.results);
  const ending = useAppSelector((app) => app.game.multiplayer?.ending);
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (!hasView) {
      announced.current = new Set();
      return;
    }
    for (const result of results ?? []) {
      if (announced.current.has(result.id)) continue;
      announced.current.add(result.id);
      if (result.id !== state.lobby.selfId && result.outcome !== "completed")
        store.dispatch(
          snackbarOpen({
            message: `${result.name}'s company retired: ${result.title}`,
            open: true,
            timeout: 8000,
          }),
        );
    }
  }, [results, hasView, state.lobby.selfId]);
  const complete =
    hasView &&
    !!state.view?.grids.length &&
    state.view.grids.every((g) => g.retired);
  const endingKey = ending ? `${state.view?.matchId}:${ending.month}` : "";
  const showResult =
    hasView &&
    !interrupted &&
    (complete || (!!ending && watching !== endingKey));

  return (
    <>
      {couchOpen && CouchRoot && (
        <Suspense fallback={null}>
          <CouchRoot
            onClose={() => {
              setCouchOpen(false);
              syncCoop();
            }}
          />
        </Suspense>
      )}
      <HostConnectionWarning
        open={interrupted && !appDialogOpen}
        endReason={endReason}
        rollback={
          !!state.checkpointRecovery &&
          (state.view?.revision ?? 0) >
            state.checkpointRecovery.confirmedRevision
        }
        waiting={state.waitingForHost}
        synchronizing={state.synchronizing}
        error={state.error || state.lobby.error}
        onReconnect={() => session.reconnect()}
        onReturnToMenu={
          canLeaveInterruption ? returnFromInterruption : undefined
        }
      />
      {open && !savesOpen && !state.view && !interrupted ? (
        <Lobby
          session={session}
          initialInviteCode={entryInviteCode}
          steamInvite={
            !desktop && entryInviteCode
              ? steamInviteLink(entryInviteCode)
              : undefined
          }
          canAuthenticate={canAuthenticate}
          onAuthorize={authorize}
          onJoined={discardInvite}
          onDiscardInvite={discardInvite}
          onHosted={startChoosing}
          onOpenSaves={() => setSavesOpen(true)}
          onCopyLink={() => void copyLink()}
          onChooseNew={() => {
            session.cancelCampaign();
            startChoosing();
          }}
          onContinueSetup={startChoosing}
          onCopyCode={copyCode}
          onClose={() => {
            discardInvite();
            setOpen(false);
            if (!state.lobby.lobbyId) choosing.current = false;
          }}
          onLeave={() => leaveLobby()}
          onLocalPlay={
            canPlayLocally
              ? () => {
                  const online = session.getSnapshot();
                  if (online.busy || online.lobby.lobbyId) return;
                  localSession.current = true;
                  setOpen(false);
                  setCouchOpen(true);
                }
              : undefined
          }
        />
      ) : null}
      {savesOpen && !state.view && (
        <SavesDialog
          session={session}
          onClose={() => {
            setSavesOpen(false);
            if (session.getSnapshot().lobby.campaignLocked) setOpen(true);
          }}
        />
      )}
      {showResult && (
        <CoopResult
          ending={ending}
          complete={complete}
          host={host}
          hostName={coop?.hostName ?? "The host"}
          selfId={state.lobby.selfId}
          onWatch={() => setWatching(endingKey)}
          online={session.onlineCampaigns}
          onBackToLobby={() => {
            const transition = session.onlineCampaigns
              ? session.leave({ skipSave: false }).then(() => setOpen(true))
              : session.backToLobby().then(startChoosing);
            void transition.catch((error) => {
              store.dispatch(
                dialogOpen({
                  open: true,
                  title: "Multiplayer save",
                  message: crossplayFailure(
                    error,
                    "The multiplayer save did not finish.",
                  ),
                  closeText: "OK",
                }),
              );
            });
          }}
          onLeave={() => leaveLobby(true)}
        />
      )}
    </>
  );
}
