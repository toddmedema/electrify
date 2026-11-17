import { captureInstallPrompt } from "./InstallPromptEvent";
import "./app.scss";
import "./InterfaceLayout.scss";
import { canStartLightweightHome } from "./HomeEligibility";

captureInstallPrompt();

// Desktop and direct game links keep their normal bootstrap. New web visitors pay for
// the engine, authored simulation data and online services only after choosing an action.
if (
  process.env.NODE_ENV === "production" &&
  process.env.REACT_APP_DESKTOP !== "true"
) {
  void canStartLightweightHome()
    .then(async (lightweight) => {
      if (lightweight) {
        const { showHome } = await import(
          /* webpackChunkName: "home" */ "./HomeEntry"
        );
        showHome();
      } else await import(/* webpackChunkName: "game" */ "./GameEntry");
    })
    .catch(() => {
      void import(/* webpackChunkName: "game" */ "./GameEntry");
    });
} else {
  void import(/* webpackChunkName: "game" */ "./GameEntry");
}
