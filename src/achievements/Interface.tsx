import * as React from "react";
import {
  Button,
  IconButton,
  Paper,
  Portal,
  Snackbar,
  Typography,
} from "@mui/material";
import LinearProgress from "@mui/material/LinearProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ScreenPage from "../components/base/ScreenPage";
import { useAppDispatch, useAppSelector } from "../Store";
import { navigate, navigateBack } from "../reducers/Card";
import { firebaseAppAuth, login, SignInOptions } from "../Globals";
import { catalog } from "./Progress";
import { achievementJournal } from "./Journal";
import { useAchievements } from "./useAchievements";
import { retryAchievementSync } from "./Runtime";
import { useOnline } from "../components/base/OnlineStatus";
import { restoreMenuFocus, useMenuKeys } from "../components/base/useMenuKeys";
import { useSwipeToDismiss } from "../components/base/SwipeDismiss";
import GoogleSignIn from "../components/base/GoogleSignIn";

/** Long enough to read the name and requirement; hover or focus holds it on screen. */
export const ACHIEVEMENT_TOAST_MS = 10_000;

type Filter = "all" | "unlocked" | "locked";
export function AchievementGallery(): React.JSX.Element {
  const state = useAchievements();
  const dispatch = useAppDispatch();
  const online = useOnline();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState(false);
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
  const signIn = async (options: SignInOptions) => {
    setSigningIn(true);
    setSignInError(false);
    try {
      if (!(await login(options))) setSignInError(true);
    } catch {
      setSignInError(true);
    } finally {
      setSigningIn(false);
    }
  };
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
              {signInError && (
                <Typography color="error" role="alert">
                  Sign-in couldn't finish. Please try again.
                </Typography>
              )}
            </div>
            {!state.uid && firebaseAppAuth && (
              <GoogleSignIn
                label={signingIn ? "Signing in…" : "Sign in with Google"}
                disabled={signingIn || !online}
                onSignIn={signIn}
              />
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
                  : "You've earned all 35 achievements."}
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

/** Announce awards over the game and its result dialogs without stealing focus. */
export default function AchievementNotifications(): React.JSX.Element {
  const state = useAchievements();
  const dispatch = useAppDispatch();
  const snackbarOpen = useAppSelector((root) => root.ui.snackbar.open);
  const [pageHidden, setPageHidden] = React.useState(() => document.hidden);
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const id = state.notifications[0];
  const panel = React.useRef<HTMLDivElement>(null);
  const swipe = useSwipeToDismiss(panel, () => {
    if (id) achievementJournal.dismiss(id);
  });
  // Height of the phone tab bar when one is actually on screen; tutorials and build cards hide it.
  const [navClearance, setNavClearance] = React.useState(0);
  const entry = catalog.find((item) => item.id === id);
  React.useLayoutEffect(() => {
    if (!id) return;
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
  }, [id]);
  const open = !!entry && !state.steamAvailable && !pageHidden && !snackbarOpen;
  // The next award reuses this panel; it must not arrive mid-fling or still faded out.
  const { reset } = swipe;
  React.useLayoutEffect(() => reset(), [id, reset]);
  React.useEffect(() => {
    setHovered(!!open && !!panel.current?.matches(":hover"));
    setFocused(!!open && !!panel.current?.contains(document.activeElement));
  }, [id, open, container]);
  React.useEffect(() => {
    if (!open || hovered || focused || !id) return;
    const timer = setTimeout(
      () => achievementJournal.dismiss(id),
      ACHIEVEMENT_TOAST_MS,
    );
    return () => clearTimeout(timer);
  }, [open, hovered, focused, id]);
  return (
    <Portal container={container}>
      <>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="srOnly"
        >
          {open && entry
            ? `Achievement unlocked: ${entry.name}. ${entry.description}`
            : ""}
        </div>
        {entry && (
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
            <Paper
              ref={panel}
              variant="outlined"
              className="achievementToastPanel"
              {...swipe.handlers}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setFocused(false);
              }}
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
                {container === document.body && (
                  <Button
                    size="small"
                    onClick={() => {
                      achievementJournal.clearNotifications();
                      dispatch(navigate("ACHIEVEMENTS"));
                    }}
                  >
                    View achievements
                  </Button>
                )}
              </div>
              <IconButton
                aria-label={`Dismiss ${entry.name} achievement notification`}
                onClick={() => achievementJournal.dismiss(id)}
                className="achievementToastClose"
              >
                <CloseIcon />
              </IconButton>
            </Paper>
          </Snackbar>
        )}
      </>
    </Portal>
  );
}
