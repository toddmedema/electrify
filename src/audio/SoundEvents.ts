import { GameEventType } from "../Types";
import { SoundEffectType } from "./SoundEffects";

export interface SoundEventSnapshot {
  inGame: boolean;
  events: GameEventType[];
  victoryOpen: boolean;
  dialogOpen: boolean;
  dialogTitle: string;
}

function eventEffect(event: GameEventType): SoundEffectType | null {
  switch (event.kind) {
    case "BLACKOUT":
      return "BLACKOUT";
    case "BLACKOUT_OVER":
      return "POWER_RESTORED";
    case "CONSTRUCTION":
      return "CONSTRUCTION_COMPLETE";
    case "BUILD":
      // The event log deliberately groups cancelling an unfinished facility under BUILD too.
      // Cancellation is not a new commitment and should not play the confirmation thunk.
      return event.message.startsWith("Building ") ? "BUILD_COMMITTED" : null;
    default:
      return null;
  }
}

function dialogEffect(snapshot: SoundEventSnapshot): SoundEffectType | null {
  if (!snapshot.dialogOpen) {
    return null;
  }
  const title = snapshot.dialogTitle.trim().toLowerCase();
  if (title === "bankrupt!" || title === "fired!") {
    return "FAILURE";
  }
  // Tutorials end in the shared dialog rather than VictoryDialog, but finishing one is the same
  // success transition from the player's point of view.
  if (title.includes("tutorial") && title.includes("complete")) {
    return "VICTORY";
  }
  return null;
}

/**
 * Presentation-only effects caused by one Redux update.
 *
 * Comparing event ids makes tick-driven transitions sound exactly once. Starting or restoring a
 * run deliberately emits nothing: its saved history is context, not six things that just happened.
 */
export function soundEffectsForUpdate(
  previous: SoundEventSnapshot,
  current: SoundEventSnapshot,
): SoundEffectType[] {
  const effects: SoundEffectType[] = [];

  if (previous.inGame && current.inGame) {
    const previousIds = new Set(previous.events.map((event) => event.id));
    // The log is newest first. Reverse the new prefix so simultaneous transitions play in the
    // order the simulation recorded them, then dedupe identical completions in the same tick.
    current.events
      .filter((event) => !previousIds.has(event.id))
      .reverse()
      .forEach((event) => {
        const effect = eventEffect(event);
        if (effect && !effects.includes(effect)) {
          effects.push(effect);
        }
      });
  }

  if (!previous.victoryOpen && current.victoryOpen) {
    effects.push("VICTORY");
  }

  const previousDialogEffect = dialogEffect(previous);
  const currentDialogEffect = dialogEffect(current);
  if (
    currentDialogEffect &&
    (currentDialogEffect !== previousDialogEffect ||
      previous.dialogTitle !== current.dialogTitle)
  ) {
    effects.push(currentDialogEffect);
  }

  return [...new Set(effects)];
}
