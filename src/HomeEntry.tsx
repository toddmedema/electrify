import { unlockAudioContext } from "./AudioContext";
import * as React from "react";
import { ThemeProvider, StyledEngineProvider } from "@mui/material/styles";
import { root } from "./Root";
import MainMenu, { DispatchProps } from "./components/views/MainMenu";
import { createAppTheme } from "./Theme";
import { finishStartup } from "./desktop/Startup";
import { installFocusVisibility } from "./FocusVisibility";
import "./app.scss";
import "./InterfaceLayout.scss";

let actionPending = false;
export function Home() {
  const [failed, setFailed] = React.useState(false);
  const [pending, setPending] = React.useState(false);
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
    finishStartup();
  }, []);
  const run = async (action?: keyof DispatchProps, audio?: boolean) => {
    if (actionPending) return;
    actionPending = true;
    const screen = document
      .querySelector<HTMLElement>("#menuCard")
      ?.closest("main");
    if (screen) screen.inert = true;
    setPending(true);
    try {
      const game = await import(/* webpackChunkName: "game" */ "./GameEntry");
      if (action) await game.runHomeAction(action, audio);
    } catch {
      actionPending = false;
      if (screen) screen.inert = false;
      setPending(false);
      setFailed(true);
    }
  };
  React.useEffect(() => {
    const activateInstall = () => {
      void run();
    };
    window.addEventListener("beforeinstallprompt", activateInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", activateInstall);
  });
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
                    onStart={() => void run("onStart")}
                    onContinue={() => void run("onContinue")}
                    onSavedGames={() => void run("onSavedGames")}
                    onSettings={() => void run("onSettings")}
                    onMods={() => void run("onMods")}
                    onAchievements={() => void run("onAchievements")}
                    onManual={() => void run("onManual")}
                    onAudioChange={(value) => {
                      if (value) unlockAudioContext();
                      void run("onAudioChange", value);
                    }}
                  />
                </main>
                {pending && (
                  <p className="homeLoadStatus" role="status">
                    Loading game…
                  </p>
                )}
                {failed && (
                  <p className="homeLoadStatus" role="alert">
                    The game could not load. Check your connection and try the
                    action again.
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
  const styles = Array.from(
    document.querySelectorAll<HTMLLinkElement>("link[data-app-style]"),
  );
  void Promise.all(
    styles
      .filter((link) => !link.sheet)
      .map(
        (link) =>
          new Promise<void>((resolve) => {
            link.addEventListener("load", () => resolve(), { once: true });
            link.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
  ).then(() => root.render(<Home />));
}
