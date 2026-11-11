import { achievementJournal } from "../achievements/Journal";
import { unlockedDifficulty } from "../achievements/DifficultyUnlocks";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getDesktop } from "../Desktop";
import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
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
import { HOST_LEFT, MultiplayerSession, offersDisconnect } from "./Session";
import {
  registerCoopControls,
  registerLobbyOpener,
  registerMultiplayerRuntime,
} from "./Registry";
import Lobby from "./Lobby";
import SavesDialog from "./SavesDialog";
import CoopResult from "./Result";
import { runSaveTransition } from "../SaveSession";
import HostConnectionWarning from "./HostConnectionWarning";
import { selectionKey } from "./Browse";
import { coopSelection, hostSelection, isBrowseCard } from "./Choosing";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import CouchRoot from "../couch/Root";

/** Session lifetime follows the app; entering the normal game can unmount the main menu. */
export default function MultiplayerRoot() {
  const [open, setOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [couchOpen, setCouchOpen] = useState(false);
  const localSession = useRef(false);
  localSession.current = couchOpen;
  const [savesOpen, setSavesOpen] = useState(false);
  // The host has opened the scenario screens for the lobby; guests follow once it publishes.
  const choosing = useRef(false);
  const [watching, setWatching] = useState<string>();
  const [session] = useState(
    () =>
      new MultiplayerSession(getDesktop()!, async () =>
        (await import("./WorkerClient")).createMultiplayerWorker(),
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const hasView = !!state.view;
  const lobbyId = state.lobby.lobbyId;
  const pendingCampaignId = state.pendingCampaign?.id;
  const coop = useAppSelector((app) => app.ui.coop);
  const reconnect = useCallback(() => {
    void session.reconnect();
  }, [session]);

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
    // Friends already following the scenario picker return to the campaign's invitation lobby.
    if (pendingCampaignId && lobbyId && !hasView) setOpen(true);
  }, [pendingCampaignId, lobbyId, hasView]);

  const leaveLobby = useCallback(
    (skipSave = false) => {
      choosing.current = false;
      setOpen(false);
      setSavesOpen(false);
      void session.leave({ skipSave }).catch(() => undefined);
    },
    [session],
  );

  /** A connection notice's way out: leave now, keeping the last multiplayer save, because a lost
   * connection may mean there is nobody to save with. */
  const disconnect = useCallback(() => {
    store.dispatch(dialogClose());
    leaveLobby(true);
  }, [leaveLobby]);

  /** The host shows the scenario screens to the lobby, which friends can join meanwhile. */
  const startChoosing = useCallback(() => {
    setOpen(false);
    const card = store.getState().card.name;
    choosing.current = true;
    if (!isBrowseCard(card)) store.dispatch(navigate("NEW_GAME"));
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

  const invite = useCallback(() => {
    void session
      .invite()
      .catch((error) =>
        store.dispatch(
          snackbarOpen({ message: error.message, open: true, timeout: 6000 }),
        ),
      );
  }, [session]);

  useEffect(() => {
    registerLobbyOpener(() => {
      const couch = getDesktop()?.couchRequest;
      if (!couch) return setOpen(true);
      void couch({ kind: "status" })
        .then((status) => {
          if ((status as { preview?: boolean })?.preview) setMethodOpen(true);
          else setOpen(true);
        })
        .catch(() => setOpen(true));
    });
    let live = true,
      initialized = false,
      loading = false;
    const sync = () => {
      const current = session.getSnapshot();
      if (!current.view?.game) {
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
                message: error.message,
              }),
            );
          });
        return;
      }
      store.dispatch(multiplayerSnapshot(current.view.game));
    };
    const stop = session.subscribe(sync);
    const stopCoop = session.subscribe(syncCoop);
    const stopStore = store.subscribe(syncCoop);
    const stopProgress = achievementJournal.subscribe(syncCoop);
    registerCoopControls({
      start: (spec) => {
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
              message: error.message,
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
      invite,
      copyCode,
      openSaves: () => setSavesOpen(true),
    });
    const stopNative = getDesktop()?.onMultiplayerEvent?.((event) => {
      if (event.kind === "invite" && !session.getSnapshot().view) {
        setOpen(true);
        void session.join(event.lobbyId).catch(() => undefined);
      }
    });
    void session
      .initialize()
      .then(() => {
        const invite = session.getSnapshot().lobby.inviteLobbyId;
        if (invite) {
          setOpen(true);
          void session.join(invite).catch(() => undefined);
        }
      })
      // A desktop build without Steam multiplayer keeps the lobby unavailable.
      .catch(() => undefined);
    return () => {
      live = false;
      stop();
      stopCoop();
      stopStore();
      stopProgress();
      stopNative?.();
      registerLobbyOpener(undefined);
      registerCoopControls(undefined);
      registerMultiplayerRuntime(undefined);
      session.dispose();
    };
  }, [session, syncCoop, leaveLobby, invite, copyCode]);
  useEffect(() => {
    if (!hasView) return;
    return registerShutdownCheckpoint((reason) => {
      if (reason === "quit" && state.lobby.hostId !== state.lobby.selfId)
        return Promise.resolve();
      return session.save(true, reason === "suspend");
    });
  }, [session, hasView, state.lobby.hostId, state.lobby.selfId]);
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
    if (!error || !(hasView || (coop && !open))) return;
    store.dispatch(
      dialogOpen({
        open: true,
        title: "Multiplayer",
        message: error,
        closeText: "OK",
        actionLabel: "Reconnect",
        action: () => {
          store.dispatch(dialogClose());
          void session.reconnect();
        },
        // Only a guest's lost connection leaves nothing to wait for. Other errors, such as a
        // failed save, and the host, which can still save, never get a way out that skips the
        // checkpoint.
        ...(offersDisconnect({
          error: state.error,
          lobbyError: state.lobby.error,
          hostId: state.lobby.hostId,
          selfId: state.lobby.selfId,
        }) && {
          secondaryLabel: "Disconnect",
          secondaryAction: disconnect,
        }),
      }),
    );
    session.dismissError();
  }, [
    session,
    state.error,
    state.lobby.error,
    state.lobby.hostId,
    state.lobby.selfId,
    hasView,
    coop,
    open,
    disconnect,
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
    hasView && (complete || (!!ending && watching !== endingKey));
  const host = state.lobby.hostId === state.lobby.selfId;

  return (
    <>
      <Dialog open={methodOpen} onClose={() => setMethodOpen(false)}>
        <DialogTitle>Play with friends</DialogTitle>
        <DialogContent>Choose where to play together.</DialogContent>
        <DialogActions>
          <Button onClick={() => setMethodOpen(false)}>Back</Button>
          <Button
            onClick={() => {
              setMethodOpen(false);
              setOpen(true);
            }}
          >
            Online
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setMethodOpen(false);
              setCouchOpen(true);
            }}
          >
            On this TV
          </Button>
        </DialogActions>
      </Dialog>
      {couchOpen && (
        <CouchRoot
          onClose={() => {
            setCouchOpen(false);
            syncCoop();
          }}
        />
      )}
      <HostConnectionWarning
        waiting={hasView && state.waitingForHost}
        onReconnect={reconnect}
        onDisconnect={disconnect}
      />
      {open && !state.view ? (
        <Lobby
          session={session}
          onHosted={startChoosing}
          onChooseNew={() => {
            session.cancelCampaign();
            startChoosing();
          }}
          onCopyCode={copyCode}
          onClose={() => {
            setOpen(false);
            if (!state.lobby.lobbyId) choosing.current = false;
          }}
          onLeave={() => leaveLobby()}
        />
      ) : null}
      {savesOpen && !open && !state.view && (
        <SavesDialog session={session} onClose={() => setSavesOpen(false)} />
      )}
      {showResult && (
        <CoopResult
          ending={ending}
          complete={complete}
          host={host}
          hostName={coop?.hostName ?? "The host"}
          selfId={state.lobby.selfId}
          onWatch={() => setWatching(endingKey)}
          onBackToLobby={() => {
            choosing.current = true;
            void session.backToLobby().then(startChoosing);
          }}
          onLeave={() => leaveLobby(true)}
        />
      )}
    </>
  );
}
