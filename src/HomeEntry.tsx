import { unlockAudioContext } from "./AudioContext";
import * as React from "react";
import { ThemeProvider, StyledEngineProvider } from "@mui/material/styles";
import { root } from "./Root";
import MainMenu, { DispatchProps } from "./components/views/MainMenu";
import { createAppTheme } from "./Theme";
import { finishStartup } from "./desktop/Startup";
import { installFocusVisibility } from "./FocusVisibility";
import {
  BACKGROUND_CACHE_DELAY_MS,
  registerServiceWorker,
} from "./ServiceWorkerRegistration";
import "./app.scss";
import "./InterfaceLayout.scss";
import { getPendingInstallPrompt } from "./InstallPromptEvent";
import { waitForAppStyles } from "./StartupStyles";
import { captureCrossplayInvite } from "./multiplayer/CrossplayInvite";
import { showBootstrapFailure } from "./StartupFailure";

export function Home() {
  const actionPending = React.useRef(false);
  const feedbackActive = React.useRef(false);
  const [failed, setFailed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [FeedbackDialog, setFeedbackDialog] =
    React.useState<typeof import("./components/base/FeedbackDialog").default>();
  const [mode, setMode] = React.useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  React.useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const choice = localStorage.getItem("theme");
      const next =
        choice === "light" || choice === "dark"
          ? choice
          : query.matches
            ? "dark"
            : "light";
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", next === "dark" ? "#121212" : "#ffffff");
      setMode(next);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  React.useLayoutEffect(() => {
    finishStartup({ home: true });
  }, []);
  React.useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    // Preserve one-visit offline launch without competing with the title's critical requests.
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(
        registerServiceWorker,
        BACKGROUND_CACHE_DELAY_MS,
      );
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", schedule);
    };
  }, []);
  const run = React.useCallback(
    async (action?: keyof DispatchProps, audio?: boolean) => {
      if (actionPending.current) return;
      actionPending.current = true;
      const screen = document
        .querySelector<HTMLElement>("#menuCard")
        ?.closest("main");
      if (screen) screen.inert = true;
      setPending(true);
      setFailed(false);
      try {
        const game = await import(/* webpackChunkName: "game" */ "./GameEntry");
        if (action) await game.runHomeAction(action, audio);
      } catch {
        actionPending.current = false;
        if (screen) screen.inert = false;
        setPending(false);
        setFailed(true);
      }
    },
    [],
  );
  React.useEffect(() => {
    const acceptInvite = () => {
      if (captureCrossplayInvite(true)) void run();
    };
    window.addEventListener("hashchange", acceptInvite);
    acceptInvite();
    return () => window.removeEventListener("hashchange", acceptInvite);
  }, [run]);
  const closeFeedback = () => {
    feedbackActive.current = false;
    setFeedbackDialog(undefined);
    if (getPendingInstallPrompt()) void run();
  };
  const openFeedback = async () => {
    if (actionPending.current || feedbackActive.current) return;
    feedbackActive.current = true;
    setFailed(false);
    try {
      const { default: Dialog } = await import(
        /* webpackChunkName: "feedback" */ "./components/base/FeedbackDialog"
      );
      if (!actionPending.current) setFeedbackDialog(() => Dialog);
      else feedbackActive.current = false;
    } catch {
      setFailed(true);
      closeFeedback();
    }
  };
  React.useEffect(() => {
    const activateInstall = () => {
      if (!feedbackActive.current) void run();
    };
    window.addEventListener("beforeinstallprompt", activateInstall);
    if (getPendingInstallPrompt()) activateInstall();
    return () =>
      window.removeEventListener("beforeinstallprompt", activateInstall);
  }, [run]);
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={createAppTheme(mode)}>
        <div className="appFrame">
          <div className="appFrameBody">
            <div className="app_container single-panel menu-layout">
              <div className="cardTransitions">
                <main className="base_main" aria-busy={pending}>
                  <MainMenu
                    deferServices
                    audioEnabled={
                      localStorage.getItem("audioEnabled") === "false"
                        ? false
                        : undefined
                    }
                    hasSavedGame={false}
                    hasSavedGames={false}
                    hasUnfinishedTutorials
                    onStart={() => void run("onStart")}
                    onContinue={() => void run("onContinue")}
                    onPlayWithFriends={() => void run("onPlayWithFriends")}
                    onTutorials={() => void run("onTutorials")}
                    onSavedGames={() => void run("onSavedGames")}
                    onSettings={() => void run("onSettings")}
                    onMods={() => void run("onMods")}
                    onAchievements={() => void run("onAchievements")}
                    onManual={() => void run("onManual")}
                    onFeedback={() => void openFeedback()}
                    onAudioChange={(value) => {
                      if (value) unlockAudioContext();
                      void run("onAudioChange", value);
                    }}
                  />
                </main>
                {FeedbackDialog && (
                  <FeedbackDialog
                    context={{ source: "game-menu" }}
                    onClose={closeFeedback}
                  />
                )}
                {pending && (
                  <p className="homeLoadStatus" role="status">
                    Loading game…
                  </p>
                )}
                {failed && (
                  <p className="homeLoadStatus" role="alert">
                    This action could not load. Check your connection and try
                    again.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

export function showHome(): void {
  installFocusVisibility();
  void waitForAppStyles().then(
    () => root.render(<Home />),
    showBootstrapFailure,
  );
}
