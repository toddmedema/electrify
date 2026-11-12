import type { Middleware } from "@reduxjs/toolkit";
import type { AppStateType } from "../Types";
import type { Command } from "./Types";
import { isGameCommand } from "./Commands";

interface Runtime {
  command: (command: Command) => void;
  submit: (command: Command) => Promise<void>;
  activity: (reason: string | null) => void;
  /** Leaves the match; skipSave uses the last multiplayer save instead of a fresh checkpoint. */
  leave: (options?: { skipSave?: boolean }) => Promise<void>;
}
let runtime: Runtime | undefined;
export const multiplayerRuntime = () => runtime;
/** Replace the command owner for this document. */
export function registerMultiplayerRuntime(value: Runtime | undefined) {
  runtime = value;
}
let openLobby: (() => void) | undefined;
export const registerLobbyOpener = (open?: () => void) => {
  openLobby = open;
};
export const showMultiplayerLobby = () => openLobby?.();
// Cards that hold the shared clock while a player reads them. The construction catalogs are not
// here: a shared clock is every company's, so one player shopping does not freeze it, and
// backgrounding the window does not either. A player who wants a pause chooses one.
const BLOCKING = new Set([
  "MANUAL",
  "SETTINGS",
  "SAVED_GAMES",
  "MODS",
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
    if (name === "systemSuspend")
      runtime.command({ kind: "speed", speed: "PAUSED" });
    const result = next(action);
    const state = api.getState();
    const reason =
      state.ui.dialog.open || state.ui.victory
        ? "Reading notification"
        : state.ui.facilityDragActive
          ? "Reordering facilities"
          : state.game.policyPause
            ? state.game.policyPause.token.startsWith("acquisition:")
              ? "Reviewing an acquisition"
              : "Choosing a policy"
            : BLOCKING.has(state.card.name)
              ? "Reading " + state.card.name.toLowerCase().replace(/_/g, " ")
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
  /** Leave the lobby, after confirming. */
  back: () => void;
  /** Host: open Steam's invitation overlay. */
  invite: () => void;
  /** Host: copy the lobby code for friends to enter. */
  copyCode: () => void;
  /** Host: choose a multiplayer save to resume instead. */
  openSaves: () => void;
}
let coop: CoopControls | undefined;
export const coopControls = () => coop;
export const registerCoopControls = (value?: CoopControls) => {
  coop = value;
};
