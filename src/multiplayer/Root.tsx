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
import { MultiplayerSession } from "./Session";
import {
  registerCoopControls,
  registerLobbyOpener,
  registerMultiplayerRuntime,
} from "./Registry";
import Lobby from "./Lobby";
import CoopResult from "./Result";
import { runSaveTransition } from "../SaveSession";
import HostConnectionWarning from "./HostConnectionWarning";
import { selectionKey } from "./Browse";
import { coopSelection, hostSelection, isBrowseCard } from "./Choosing";

/** Session lifetime follows the app; entering the normal game can unmount the main menu. */
export default function MultiplayerRoot() {
  const [open, setOpen] = useState(false);
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
  const coop = useAppSelector((app) => app.ui.coop);
  const reconnect = useCallback(() => {
    void session.reconnect();
  }, [session]);

  /** Choosing together ends with the lobby; scenario screens go back to single player. */
  const syncCoop = useCallback(() => {
    const current = session.getSnapshot();
    const app = store.getState();
    const { lobby, browse, view } = current;
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
    );
    if (JSON.stringify(next) !== JSON.stringify(app.ui.coop))
      store.dispatch(uiDelta({ coop: next }));
    if (view) return;
    if (host) {
      const selection = hostSelection(store.getState());
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

  const leaveLobby = useCallback(
    (skipSave = false) => {
      choosing.current = false;
      setOpen(false);
      void session.leave({ skipSave }).catch(() => undefined);
    },
    [session],
  );

  useEffect(() => {
    registerLobbyOpener(() => setOpen(true));
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
    registerCoopControls({
      start: (spec) => {
        const selection = hostSelection(store.getState());
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
        if (lobby.hostId === lobby.selfId) setOpen(true);
        else
          store.dispatch(
            dialogOpen({
              open: true,
              title: "Leave the lobby?",
              message: "You'll stop following the host's game choice.",
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
    });
    const stopNative = getDesktop()?.onMultiplayerEvent?.((event) => {
      if (event.kind === "invite" && !session.getSnapshot().view) {
        setOpen(true);
        void session.join(event.lobbyId).catch(() => undefined);
      }
    });
    void session.initialize().then(() => {
      const invite = session.getSnapshot().lobby.inviteLobbyId;
      if (invite) {
        setOpen(true);
        void session.join(invite).catch(() => undefined);
      }
    });
    return () => {
      live = false;
      stop();
      stopCoop();
      stopStore();
      stopNative?.();
      registerLobbyOpener(undefined);
      registerCoopControls(undefined);
      registerMultiplayerRuntime(undefined);
      session.dispose();
    };
  }, [session, syncCoop, leaveLobby]);
  useEffect(() => {
    if (!hasView || state.lobby.hostId !== state.lobby.selfId) return;
    return registerShutdownCheckpoint(() => session.save(true));
  }, [session, hasView, state.lobby.hostId, state.lobby.selfId]);
  useEffect(() => {
    const error = state.error || state.lobby.error;
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
      }),
    );
    session.dismissError();
  }, [session, state.error, state.lobby.error, hasView, coop, open]);

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
      <HostConnectionWarning
        waiting={hasView && state.waitingForHost}
        onReconnect={reconnect}
      />
      {open && !state.view ? (
        <Lobby
          session={session}
          choosing={choosing.current}
          onChoose={() => {
            setOpen(false);
            const card = store.getState().card.name;
            choosing.current = true;
            if (!isBrowseCard(card)) store.dispatch(navigate("NEW_GAME"));
            syncCoop();
          }}
          onClose={() => {
            setOpen(false);
            if (!state.lobby.lobbyId) choosing.current = false;
          }}
          onLeave={() => leaveLobby()}
        />
      ) : null}
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
            void session.backToLobby().then(() => {
              store.dispatch(navigate("NEW_GAME"));
              syncCoop();
            });
          }}
          onLeave={() => leaveLobby(true)}
        />
      )}
    </>
  );
}
