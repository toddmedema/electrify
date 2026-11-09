/** Configure before Chromium creates a graphics context. */
function enableSteamOverlay(app, steamworks, platform = process.platform) {
  // Steam hooks X11. Wayland + in-process-gpu also deadlocks Electron 44 at quit:
  // https://github.com/electerm/electerm/issues/4654
  if (platform === "linux")
    app.commandLine.appendSwitch("ozone-platform", "x11");
  steamworks.electronEnableSteamOverlay();
}

/** Cover the shell and company views, including Chromium's modal focus traps. */
function reserveSteamOverlayHotkey(app, enabled) {
  if (!enabled) return;
  app.on("web-contents-created", (_event, contents) => {
    contents.on("before-input-event", (event, input) => {
      // Steam sees its hotkey natively; do not also navigate backwards in Chromium.
      if (input.shift && input.key === "Tab") event.preventDefault();
    });
  });
}
module.exports = { enableSteamOverlay, reserveSteamOverlayHotkey };
