import * as React from "react";
import { Button, IconButton, Paper, Snackbar, Typography } from "@mui/material";
import LinearProgress from "@mui/material/LinearProgress";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ScreenHeader from "../components/base/ScreenHeader";
import { useAppDispatch, useAppSelector } from "../Store";
import { navigate, navigateBack } from "../reducers/Card";
import { firebaseAppAuth, login } from "../Globals";
import { catalog } from "./Progress";
import { achievementJournal } from "./Journal";
import { useAchievements } from "./useAchievements";
import { retryAchievementSync } from "./Runtime";
import { useOnline } from "../components/base/OnlineStatus";
import { useMenuKeys } from "../components/base/useMenuKeys";

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
    window.setTimeout(
      () =>
        document
          .querySelector<HTMLElement>("[data-achievements-trigger]")
          ?.focus(),
      350,
    );
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
  const account = !!state.uid && !!firebaseAppAuth;
  const status =
    !state.storageAvailable && account && state.sync === "synced"
      ? "Synced to your account. Device storage is unavailable."
      : !state.storageAvailable && account && state.sync === "syncing"
        ? "Device storage is unavailable. Syncing to your account…"
        : !state.storageAvailable
          ? "Device storage is unavailable. Achievements remain available in this session."
          : !account
            ? "Saved on this device."
            : state.sync === "synced"
              ? "Synced to your account."
              : !online || state.sync === "offline"
                ? "Saved on this device. We'll sync when you're online."
                : state.sync === "failed"
                  ? "Saved on this device. Account sync couldn't finish."
                  : "Saved on this device. Syncing to your account…";
  const signIn = async () => {
    setSigningIn(true);
    setSignInError(false);
    try {
      if (!(await login())) setSignInError(true);
    } catch {
      setSignInError(true);
    } finally {
      setSigningIn(false);
    }
  };
  return (
    <div className="achievementCard flexContainer keyboardMenu" {...menuKeys}>
      <ScreenHeader title="Achievements" onBack={onBack} />
      <main className="achievementGallery">
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
          <Typography className="achievementScope" color="text.secondary">
            Earn achievements in official scenarios on any difficulty. Tutorials
            have their own achievements; custom games and replays don't count.
          </Typography>
        </div>
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
            <Button
              variant="outlined"
              disabled={signingIn || !online}
              onClick={() => void signIn()}
            >
              {signingIn ? "Signing in…" : "Sign in with Google"}
            </Button>
          )}
          {account && state.sync === "failed" && online && (
            <Button variant="outlined" onClick={retryAchievementSync}>
              Retry sync
            </Button>
          )}
        </Paper>
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
                    </div>
                    <div className="achievementDescription">
                      <div className="achievementRowHeading">
                        <Typography variant="subtitle1" component="h3">
                          {entry.name}
                        </Typography>
                        <span className="achievementState">
                          {unlocked ? (
                            <CheckCircleOutlineIcon fontSize="small" />
                          ) : (
                            <LockOutlinedIcon fontSize="small" />
                          )}
                          {unlocked ? "Unlocked" : "Locked"}
                        </span>
                      </div>
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
    </div>
  );
}

/** One announcement at a time; never steal focus, cover a modal, or pause a run. */
export default function AchievementNotifications(): React.JSX.Element {
  const state = useAchievements();
  const dispatch = useAppDispatch();
  const inGame = useAppSelector((root) => root.game.inGame);
  const snackbarOpen = useAppSelector((root) => root.ui.snackbar.open);
  const dialogOpen = useAppSelector((root) => root.ui.dialog.open);
  const [obstructed, setObstructed] = React.useState(true);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = state.notifications[0];
  const entry = catalog.find((item) => item.id === id);
  React.useEffect(() => {
    if (!id) return;
    const inspect = () =>
      setObstructed(
        document.hidden ||
          !!document.querySelector(
            '[role="dialog"][aria-modal="true"], .MuiModal-root:not(.MuiModal-hidden):not([aria-hidden="true"])',
          ),
      );
    inspect();
    const timer = setInterval(inspect, 250);
    document.addEventListener("visibilitychange", inspect);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", inspect);
    };
  }, [id]);
  const open =
    !!entry &&
    !state.steamAvailable &&
    !obstructed &&
    !snackbarOpen &&
    !dialogOpen;
  React.useEffect(() => {
    setHovered(!!open && !!panel.current?.matches(":hover"));
    setFocused(!!open && !!panel.current?.contains(document.activeElement));
  }, [id, open]);
  React.useEffect(() => {
    if (!open || hovered || focused || !id) return;
    const timer = setTimeout(() => achievementJournal.dismiss(id), 8000);
    return () => clearTimeout(timer);
  }, [open, hovered, focused, id]);
  return (
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
          className={`achievementToast ${inGame ? "achievementToastInGame" : ""}`}
        >
          <Paper
            ref={panel}
            variant="outlined"
            className="achievementToastPanel"
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
              <Button
                size="small"
                onClick={() => {
                  achievementJournal.clearNotifications();
                  dispatch(navigate("ACHIEVEMENTS"));
                }}
              >
                View achievements
              </Button>
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
  );
}
