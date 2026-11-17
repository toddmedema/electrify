import { captureInstallPrompt } from "./InstallPromptEvent";
import "./app.scss";
import "./InterfaceLayout.scss";
import { canStartLightweightHome } from "./HomeEligibility";
import { showBootstrapFailure } from "./StartupFailure";

captureInstallPrompt();

function loadGame() {
  return import(/* webpackChunkName: "game" */ "./GameEntry").catch(
    showBootstrapFailure,
  );
}
// Desktop and direct links retain the full bootstrap. First-time visitors load it on intent.
if (
  process.env.NODE_ENV === "production" &&
  process.env.REACT_APP_DESKTOP !== "true"
) {
  void canStartLightweightHome()
    .then(async (lightweight) => {
      if (lightweight) {
        try {
          // Allow the startup frame before optional UI work; image loading never gates controls.
          if (document.visibilityState !== "hidden")
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            });
          const { showHome } = await import(
            /* webpackChunkName: "home" */ "./HomeEntry"
          );
          showHome();
        } catch {
          await loadGame();
        }
      } else await loadGame();
    })
    .catch(showBootstrapFailure);
} else void loadGame();
