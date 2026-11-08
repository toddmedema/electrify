import { useEffect, useState, useSyncExternalStore } from "react";
import { StyledEngineProvider } from "@mui/material/styles";
import { ThemedApp } from "../App";
import { getDesktop } from "../Desktop";
import { store } from "../Store";
import CompositorContainer from "../components/CompositorContainer";
import UnitsProvider from "../components/base/UnitsContext";
import ScenarioChoiceDialog from "../components/base/ScenarioChoiceDialog";
import { startDesktopInput } from "../desktop/Input";
import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { waitForLoad } from "../helpers/WaitForLoad";
import { multiplayerSnapshot } from "../reducers/GameActions";
import { change } from "../reducers/Settings";
import { layoutChanged } from "../reducers/UI";
import { registerMultiplayerRuntime } from "../multiplayer/Registry";
import { CouchClient } from "./Client";
import { seatPresentation } from "./Presentation";
import type { SettingsType } from "../Types";
import type { GameType } from "../Types";
import type { EvidenceTargetType } from "../Types";
import { openEvidence } from "../helpers/Evidence";
import "../TvLayout.scss";
import "./couch.scss";

/** A seat deliberately boots no save leases, account observers, music or solo clock. */
export default function CouchSeat() {
  const bridge = window.electrifyCouch!;
  const [client] = useState(
    () => new CouchClient(bridge.seatId, bridge.getGeneration(), bridge.post),
  );
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.couchSeat = bridge.seatId;
    store.dispatch(change({ tvMode: true, tvInset: 0, audioEnabled: false }));
    registerMultiplayerRuntime(client);
    let previous: GameType | undefined;
    const stopStore = client.subscribe(() => {
      const view = client.getSnapshot().view;
      if (view?.game && view.game !== previous) {
        previous = view.game;
        store.dispatch(multiplayerSnapshot(view.game));
      }
    });
    const stopMessages = bridge.onMessage((message) => {
      const event = message as {
        kind?: string;
        generation?: number;
        settings?: SettingsType;
        target?: EvidenceTargetType;
      };
      if (
        event.kind === "presentation" &&
        event.generation === client.generation &&
        event.settings
      ) {
        store.dispatch(change(seatPresentation(event.settings)));
      } else if (
        event.kind === "evidence" &&
        event.generation === client.generation &&
        event.target
      ) {
        store.dispatch(openEvidence(event.target));
      } else client.receive(message);
    });
    const stopInput = startDesktopInput(store, getDesktop()!);
    const resize = () => store.dispatch(layoutChanged());
    window.addEventListener("resize", resize);
    // The preload buffers the initial baseline until this subscription is installed.
    return () => {
      stopStore();
      stopMessages();
      stopInput();
      client.dispose();
      registerMultiplayerRuntime(undefined);
      window.removeEventListener("resize", resize);
    };
    // Client lifetime matches this isolated document, not individual world publications.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, bridge]);
  const location = state.view?.game?.location;
  useEffect(() => {
    if (!location) return;
    let live = true;
    void Promise.all([
      waitForLoad(initEconomy),
      waitForLoad(initFuelPrices),
      waitForLoad((done) => initWeather(location, done)),
    ])
      .then(() => {
        if (live) setLoaded(true);
      })
      .catch((error: Error) => {
        if (live) setLoadError(error.message);
      });
    return () => {
      live = false;
    };
  }, [location?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <StyledEngineProvider injectFirst>
      <ThemedApp>
        <UnitsProvider>
          <div className="appFrame couchSeat">
            {state.error && <div role="alert">{state.error}</div>}
            <div className="appFrameBody">
              {loadError ? (
                <div role="alert">
                  <p>{loadError}</p>
                  <button onClick={() => window.location.reload()}>
                    Reload this company
                  </button>
                </div>
              ) : state.view?.game?.multiplayer?.ending ? (
                <section
                  className="couchCompanyResult"
                  aria-label="Company result"
                >
                  <h1>{state.view.game.multiplayer.ending.title}</h1>
                  <p>{state.view.game.multiplayer.ending.reason}</p>
                  <p>
                    Your grid stays as it ended. The other companies can play
                    on.
                  </p>
                  <button
                    onClick={() => void client.leave().catch(() => undefined)}
                  >
                    Save & Quit for everyone
                  </button>
                </section>
              ) : loaded ? (
                <CompositorContainer store={store} />
              ) : (
                <p role="status">Preparing your company…</p>
              )}
            </div>
            <ScenarioChoiceDialog />
          </div>
        </UnitsProvider>
      </ThemedApp>
    </StyledEngineProvider>
  );
}
