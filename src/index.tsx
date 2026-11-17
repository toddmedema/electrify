import { captureInstallPrompt } from "./InstallPromptEvent";
import "./app.scss";
import "./InterfaceLayout.scss";
import { canStartLightweightHome } from "./HomeEligibility";

captureInstallPrompt();

function showBootstrapFailure(): void {
  const status = document.querySelector<HTMLElement>("[data-startup-status]");
  if (!status) return;
  status.setAttribute("role", "alert");
  const message = document.createElement("p");
  message.textContent =
    "Electrify couldn't finish loading. Check your connection and reload.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload Electrify";
  reload.style.cssText = "min-height:44px;padding:8px 16px;font:inherit";
  reload.onclick = () => window.location.reload();
  status.replaceChildren(message, reload);
}
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
