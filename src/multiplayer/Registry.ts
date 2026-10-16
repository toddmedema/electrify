import type { Middleware } from "@reduxjs/toolkit";
import type { AppStateType } from "../Types";
import type { Command } from "./Types";
import { isGameCommand } from "./Commands";

interface Runtime {
  command: (command: Command) => void;
  submit: (command: Command) => Promise<void>;
  activity: (reason: string | null) => void;
  /** Leaves the match; skipSave uses the last shared save instead of a fresh checkpoint. */
  leave: (options?: { skipSave?: boolean }) => Promise<void>;
}
let runtime: Runtime | undefined;
export const multiplayerRuntime = () => runtime;
export function registerMultiplayerRuntime(value: Runtime | undefined) {
  runtime = value;
  hidden = typeof document !== "undefined" && document.hidden;
}
let openLobby: (() => void) | undefined;
export const registerLobbyOpener = (open?: () => void) => {
  openLobby = open;
};
export const showMultiplayerLobby = () => openLobby?.();
let hidden = false;
const BLOCKING = new Set([
  "BUILD_GENERATORS",
  "BUILD_STORAGE",
  "BUILD_INTERTIES",
  "MANUAL",
  "SETTINGS",
  "SAVED_GAMES",
  "ACHIEVEMENTS",
]);
export const multiplayerMiddleware: Middleware<object, AppStateType> =
  (api) => (next) => (action) => {
    if (
      !runtime ||
      !api.getState().game.multiplayer ||
      !action ||
      typeof action !== "object" ||
      !("type" in action) ||
      typeof action.type !== "string"
    )
      return next(action);
    const data = action as { type: string; payload?: unknown };
    const name = data.type.startsWith("game/") ? data.type.slice(5) : "";
    if (isGameCommand(name)) {
      runtime.command({ kind: "action", name, payload: data.payload });
      return action;
    }
    if (
      name === "delta" &&
      data.payload &&
      typeof data.payload === "object" &&
      "dollarsPerkWh" in data.payload
    ) {
      runtime.command({
        kind: "rate",
        value: Number(data.payload.dollarsPerkWh),
      });
      return action;
    }
    if (name === "setSpeed" && !api.getState().ui.facilityDragActive)
      runtime.command({
        kind: "speed",
        speed: data.payload as AppStateType["game"]["speed"],
      });
    if (name === "pageHidden") hidden = true;
    if (name === "pageVisible") hidden = false;
    const result = next(action);
    const state = api.getState();
    const reason = hidden
      ? "Game in background"
      : state.ui.dialog.open || state.ui.victory
        ? "Reading notification"
        : state.ui.facilityDragActive
          ? "Reordering facilities"
          : state.game.policyPause
            ? "Choosing a policy"
            : BLOCKING.has(state.card.name)
              ? state.card.name.startsWith("BUILD_")
                ? "Building capacity"
                : "Reading " + state.card.name.toLowerCase().replace(/_/g, " ")
              : state.ui.manualHelpEntry
                ? "Reading help"
                : null;
    runtime?.activity(reason);
    return result;
  };

/** What the scenario screens ask of a co-op lobby while it chooses a game together. */
interface CoopControls {
  /** Host: start the chosen scenario for everyone. */
  start: (spec: import("./Types").MatchSpec) => void;
  /** Guest: mark Ready for the selection on screen, or clear it. */
  ready: (ready: boolean) => void;
  /** Host: back to the lobby dialog. Guest: leave the lobby. */
  back: () => void;
}
let coop: CoopControls | undefined;
export const coopControls = () => coop;
export const registerCoopControls = (value?: CoopControls) => {
  coop = value;
};
