import type { App, BrowserWindow } from "electron";

/** Return the key window before destroying the focus probe. macOS delivers key-window
 * notifications during destruction, so closing the active probe races the handoff. */
export async function restoreFocusBeforeClosingProbe(
  electron: {
    app: Pick<App, "focus">;
    BrowserWindow: Pick<typeof BrowserWindow, "fromId">;
  },
  ids: { game: number; probe: number },
  timeoutMs = 5000,
) {
  const game = electron.BrowserWindow.fromId(ids.game);
  const probe = electron.BrowserWindow.fromId(ids.probe);
  if (!game || game.isDestroyed()) throw new Error("The game window closed");
  if (!game.isFocused()) {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        game.removeListener("focus", focused);
        game.removeListener("closed", closed);
        if (error) reject(error);
        else resolve();
      };
      const focused = () => finish();
      const closed = () => finish(new Error("The game window closed"));
      const timer = setTimeout(
        () => finish(new Error("The game window did not regain native focus")),
        timeoutMs,
      );
      game.once("focus", focused);
      game.once("closed", closed);
      try {
        electron.app.focus();
        game.focus();
        if (game.isFocused()) finish();
      } catch (cause) {
        finish(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }
  // Leave the native focus callback's stack before tearing down another window.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (
    game.isDestroyed() ||
    !game.isFocused() ||
    (probe && !probe.isDestroyed() && probe.isFocused())
  )
    throw new Error("Native focus did not settle on the game window");
  if (probe && !probe.isDestroyed()) probe.destroy();
}
