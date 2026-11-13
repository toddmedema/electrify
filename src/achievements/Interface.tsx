import * as React from "react";
import { Button, Paper, Portal, Snackbar, Typography } from "@mui/material";
import LinearProgress from "@mui/material/LinearProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ScreenPage from "../components/base/ScreenPage";
import { useAppDispatch, useAppSelector } from "../Store";
import { navigateBack } from "../reducers/Card";
import { firebaseAppAuth } from "../Globals";
import SignInButtons from "../components/base/SignInButtons";
import { catalog } from "./Progress";
import { achievementJournal } from "./Journal";
import { useAchievements } from "./useAchievements";
import { retryAchievementSync } from "./Runtime";
import { useOnline } from "../components/base/OnlineStatus";
import { restoreMenuFocus, useMenuKeys } from "../components/base/useMenuKeys";
import { useSwipeToDismiss } from "../components/base/SwipeDismiss";

/** Each visible card gets ten seconds, including while hovered or focused. */
export const ACHIEVEMENT_TOAST_MS = 10_000;

type Filter = "all" | "unlocked" | "locked";
export function AchievementGallery(): React.JSX.Element {
  const state = useAchievements();
  const dispatch = useAppDispatch();
  const online = useOnline();
  const [filter, setFilter] = React.useState<Filter>("all");
  const onBack = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    dispatch(navigateBack());
    restoreMenuFocus("[data-achievements-trigger]");
  };
  const menuKeys = useMenuKeys(true, onBack);
  React.useEffect(() => {
    achievementJournal.clearNotifications();
    const timer = window.setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            '.achievementCard button[aria-label="Back"]',
          )
          ?.focus(),
      350,
    );
    return () => window.clearTimeout(timer);
  }, []);
  const count = state.progress.earned.length;
  const entries = catalog.filter(
    ({ id }) =>
      filter === "all" ||
      state.progress.earned.includes(id) === (filter === "unlocked"),
  );
  if (filter === "all") {
    entries.sort(
      (a, b) =>
        Number(state.progress.earned.includes(b.id)) -
        Number(state.progress.earned.includes(a.id)),
    );
  }
  const account = !!state.uid && !!firebaseAppAuth;
  const status =
    !state.storageAvailable && account && state.sync === "synced"
      ? "Device storage is unavailable."
      : !state.storageAvailable && account && state.sync === "syncing"
        ? "Device storage is unavailable. Syncing to your account…"
        : !state.storageAvailable
          ? "Device storage is unavailable. Achievements remain available in this session."
          : !account
            ? "Saved on this device."
            : state.sync === "synced"
              ? null
              : !online || state.sync === "offline"
                ? "Saved on this device. We'll sync when you're online."
                : state.sync === "failed"
                  ? "Saved on this device. Account sync couldn't finish."
                  : "Saved on this device. Syncing to your account…";
  return (
    <ScreenPage
      title="Achievements"
      onBack={onBack}
      className="achievementCard keyboardMenu"
      {...menuKeys}
    >
      <main className="achievementGallery scrollable">
        <div className="achievementSummary">
          <Typography variant="h5" component="h2">
            {count} of {catalog.length} unlocked
          </Typography>
          <LinearProgress
            color="success"
            variant="determinate"
            value={(count / catalog.length) * 100}
            aria-label="Achievement progress"
          />
        </div>
        {status && (
          <Paper variant="outlined" className="achievementAccount">
            <div>
              <Typography>{status}</Typography>
              {!account && firebaseAppAuth && (
                <Typography color="text.secondary">
                  {online
                    ? "Sign in to keep achievements across devices."
                    : "Sign in when you're online to keep achievements across devices."}
                </Typography>
              )}
            </div>
            {!state.uid && firebaseAppAuth && (
              <SignInButtons disabled={!online} />
            )}
            {account && state.sync === "failed" && online && (
              <Button variant="outlined" onClick={retryAchievementSync}>
                Retry sync
              </Button>
            )}
          </Paper>
        )}
        <Tabs
          value={filter}
          onChange={(_event, value: Filter) => setFilter(value)}
          variant="fullWidth"
          aria-label="Filter achievements"
          className="achievementFilters"
        >
          <Tab
            id="achievements-all"
            aria-controls="achievement-results"
            value="all"
            label={`All (${catalog.length})`}
          />
          <Tab
            id="achievements-unlocked"
            aria-controls="achievement-results"
            value="unlocked"
            label={`Unlocked (${count})`}
          />
          <Tab
            id="achievements-locked"
            aria-controls="achievement-results"
            value="locked"
            label={`Locked (${catalog.length - count})`}
          />
        </Tabs>
        <div
          id="achievement-results"
          role="tabpanel"
          aria-labelledby={`achievements-${filter}`}
          tabIndex={0}
        >
          {entries.length ? (
            <ul className="achievementList">
              {entries.map((entry) => {
                const unlocked = state.progress.earned.includes(entry.id);
                return (
                  <li
                    key={entry.id}
                    className={`achievementRow ${unlocked ? "isUnlocked" : "isLocked"}`}
                  >
                    <div className="achievementArt">
                      <img src={`images/${entry.icon}.svg`} alt="" />
                      <span
                        className="achievementState"
                        role="img"
                        aria-label={unlocked ? "Unlocked" : "Locked"}
                        title={unlocked ? "Unlocked" : "Locked"}
                      >
                        {unlocked ? (
                          <CheckCircleOutlineIcon />
                        ) : (
                          <LockOutlinedIcon />
                        )}
                      </span>
                    </div>
                    <div className="achievementDescription">
                      <Typography
                        className="achievementRowHeading"
                        variant="subtitle1"
                        component="h3"
                      >
                        {entry.name}
                      </Typography>
                      <Typography color="text.secondary">
                        {entry.description}
                      </Typography>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="achievementEmpty">
              <Typography variant="h6" component="h3">
                {filter === "unlocked"
                  ? "No achievements unlocked yet"
                  : "Every achievement is unlocked"}
              </Typography>
              <Typography color="text.secondary">
                {filter === "unlocked"
                  ? "Complete Mission 1: Electricity to earn First Spark."
                  : `You've earned all ${catalog.length} achievements.`}
              </Typography>
              <Button onClick={() => setFilter("all")}>
                Show all achievements
              </Button>
            </div>
          )}
        </div>
      </main>
    </ScreenPage>
  );
}

function AchievementToast({
  entry,
  active,
}: {
  entry: (typeof catalog)[number];
  active: boolean;
}): React.JSX.Element {
  const panel = React.useRef<HTMLDivElement>(null);
  const dismiss = () => {
    // Keep keyboard focus in the stack when its focused card is dismissed.
    if (panel.current?.contains(document.activeElement)) {
      const neighbor =
        panel.current.nextElementSibling ||
        panel.current.previousElementSibling;
      if (neighbor instanceof HTMLElement) neighbor.focus();
    }
    achievementJournal.dismiss(entry.id);
  };
  const swipe = useSwipeToDismiss(panel, dismiss);
  React.useEffect(() => {
    if (!active) return;
    const timer = setTimeout(
      () => achievementJournal.dismiss(entry.id),
      ACHIEVEMENT_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [active, entry.id]);
  return (
    <Paper
      ref={panel}
      variant="outlined"
      className="achievementToastPanel"
      role="button"
      tabIndex={0}
      aria-label={`Dismiss ${entry.name} achievement notification`}
      onClick={dismiss}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
      {...swipe.handlers}
    >
      <div className="achievementArt">
        <img src={`images/${entry.icon}.svg`} alt="" />
      </div>
      <div className="achievementToastText">
        <Typography variant="overline" component="p">
          Achievement unlocked
        </Typography>
        <Typography variant="subtitle1" component="p">
          {entry.name}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          className="achievementToastRequirement"
        >
          {entry.description}
        </Typography>
      </div>
    </Paper>
  );
}

/** Announce awards over the game and its result dialogs without stealing focus. */
export default function AchievementNotifications(): React.JSX.Element {
  const state = useAchievements();
  const snackbarOpen = useAppSelector((root) => root.ui.snackbar.open);
  const [pageHidden, setPageHidden] = React.useState(() => document.hidden);
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const stack = React.useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = React.useState(false);
  const entries = state.notifications.flatMap((id) => {
    const entry = catalog.find((item) => item.id === id);
    return entry ? [entry] : [];
  });
  const hasNotifications = entries.length > 0;
  // Height of the phone tab bar when one is actually on screen; tutorials and build cards hide it.
  const [navClearance, setNavClearance] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!hasNotifications) return;
    const inspect = () => {
      setPageHidden(document.hidden);
      // Stay inside the active modal's accessibility and focus boundary, above its backdrop.
      // Portaling only to body would leave the announcement aria-hidden when a dialog opens.
      const modal = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"])',
        ),
      ).at(-1);
      setContainer(
        modal?.querySelector<HTMLElement>(".MuiDialog-container") ||
          modal ||
          document.body,
      );
      const nav = document.getElementById("navfooter");
      setNavClearance(
        nav?.getClientRects().length
          ? Math.max(
              0,
              Math.round(window.innerHeight - nav.getBoundingClientRect().top),
            )
          : 0,
      );
      setScrollable(
        !!stack.current &&
          stack.current.scrollHeight > stack.current.clientHeight,
      );
    };
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true });
    const timer = setInterval(inspect, 250);
    document.addEventListener("visibilitychange", inspect);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", inspect);
    };
  }, [hasNotifications]);
  const open =
    hasNotifications && !state.steamAvailable && !pageHidden && !snackbarOpen;
  return (
    <Portal container={container}>
      <>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="srOnly"
        >
          {open
            ? entries
                .map(
                  (entry) =>
                    `Achievement unlocked: ${entry.name}. ${entry.description}`,
                )
                .join(" ")
            : ""}
        </div>
        {hasNotifications && (
          <Snackbar
            open={open}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            className="achievementToast"
            style={
              {
                "--achievement-nav-clearance": `${navClearance}px`,
              } as React.CSSProperties
            }
          >
            <div
              ref={stack}
              className={`achievementToastStack${scrollable ? " isScrollable" : ""}`}
            >
              {entries.map((entry) => (
                <AchievementToast key={entry.id} entry={entry} active={open} />
              ))}
            </div>
          </Snackbar>
        )}
      </>
    </Portal>
  );
}
