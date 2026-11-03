import { APP_VERSION } from "./AppVersion";
import { isDesktopApp } from "./Desktop";
import { logEvent } from "./Globals";
import type { SaveLibraryState } from "./SaveLibrary";
import { SaveRepositoryError } from "./SaveModel";

interface SaveDeleteContext {
  timedOut: boolean;
  elapsedMs: number;
  saveCount: number;
  activeSave: boolean;
  pendingSave: boolean;
  saveState: SaveLibraryState["saveState"];
  cloudState: SaveLibraryState["cloudState"];
}

/** Remote diagnostics are an allowlist: never send names, IDs, payloads or raw errors. */
export function reportSaveDeleteFailure(
  error: unknown,
  context: SaveDeleteContext,
): void {
  const fields = {
    description: context.timedOut
      ? "saved_game_delete_timeout"
      : "saved_game_delete_failed",
    fatal: false,
    operation: "delete_saved_game",
    error_code: error instanceof SaveRepositoryError ? error.code : "unknown",
    elapsed_ms: context.elapsedMs,
    save_count: context.saveCount,
    active_save: context.activeSave,
    pending_save: context.pendingSave,
    save_state: context.saveState,
    cloud_state: context.cloudState || "unknown",
    online: navigator.onLine,
    visibility_state: document.visibilityState,
    platform: isDesktopApp() ? "desktop" : "web",
  };
  // Keep the original stack locally; Analytics is for bounded operational context,
  // not a replacement for an error tracker with source maps and issue grouping.
  console.error(
    "Saved-game deletion failed",
    { ...fields, app_version: APP_VERSION },
    error,
  );
  try {
    logEvent("exception", fields);
  } catch {
    // Reporting must never prevent recovery of the player's controls.
  }
}
