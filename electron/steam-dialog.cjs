const { nativeLibraryPath } = require("./steam-native.cjs");

// Optional SteamUtils010 helpers are separate from the core Steam initialization contract.
// https://partner.steamgames.com/doc/api/ISteamUtils#SetGameLauncherMode
const DIALOG_DECLARATIONS = {
  utils: "void * SteamAPI_SteamUtils_v010()",
  launcher: "void SteamAPI_ISteamUtils_SetGameLauncherMode(void *, bool)",
};
function loadDialogFunctions(library) {
  try {
    library ||= require("koffi").load(nativeLibraryPath());
    return Object.fromEntries(
      Object.entries(DIALOG_DECLARATIONS).map(([key, declaration]) => [
        key,
        library.func(declaration),
      ]),
    );
  } catch {
    return null;
  }
}

/** Steam supplies pointer/keyboard navigation only while a native chooser owns input. */
class SteamNativeDialogs {
  constructor(api, onActiveChanged = () => {}, onError = () => {}) {
    this.api = api;
    this.onActiveChanged = onActiveChanged;
    this.onError = onError;
    this.depth = 0;
    try {
      this.utils = api?.utils();
    } catch {
      this.utils = null;
    }
  }
  get active() {
    return this.depth > 0 && !this.stopped;
  }
  setMode(active) {
    if (!this.utils) return;
    try {
      this.api.launcher(this.utils, active);
    } catch (error) {
      this.onError(error);
    }
  }
  async run(open) {
    if (this.stopped) return open();
    this.depth++;
    try {
      if (this.depth === 1) {
        // Focus can remain on the parent window while a portal chooser opens.
        this.onActiveChanged(true);
        this.setMode(true);
      }
      return await open();
    } finally {
      this.depth--;
      if (this.depth === 0 && !this.stopped) {
        this.setMode(false);
        // Main recomputes focus, sleep and quit gates, and requires held input release.
        this.onActiveChanged(false);
      }
    }
  }
  dispose() {
    if (this.stopped) return;
    if (this.active) this.setMode(false);
    this.stopped = true;
    this.onActiveChanged(false);
  }
}
module.exports = {
  SteamNativeDialogs,
  loadDialogFunctions,
  DIALOG_DECLARATIONS,
};
