import { FEEDBACK_URL } from "../../CommunityLinks";
import type { AppDispatch } from "../../Store";
import * as React from "react";
import {
  ClickAwayListener,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
  deriveExpandedSummary,
  formatHour,
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "../../helpers/DateTime";
import { projectedShortfall } from "../../helpers/MissionStatus";
import {
  formatMoneyStable,
  formatWatts,
  formatNumber,
} from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import {
  isBigScreen,
  isPaneLayout,
  openWindow,
  SIDE_LAYOUT_MEDIA,
} from "../../Globals";
import { getNextTutorial, getScenario } from "../../data/Scenarios";
import { setSpeed, startTutorial } from "../../reducers/Game";
import { quitSavedGame, runSaveTransition } from "../../SaveSession";
import {
  AppStateType,
  GameType,
  SpeedType,
  TickPresentFutureType,
} from "../../Types";
import { connectToStore } from "./ConnectToStore";
import ConceptIcon from "./ConceptIcon";
import { useOnline } from "./OnlineStatus";
import { buildSpeedOptions, sharedClockSpeedProps } from "./SpeedControls";
import MissionSummary from "./MissionSummary";
import { EvidenceRequestType, EvidenceTargetType } from "../../Types";
import { acknowledgeEvidence } from "../../reducers/UI";
import { openEvidence } from "../../helpers/Evidence";
import {
  ActiveEventGroupType,
  selectActiveEventGroups,
  selectUpcomingStoryEvents,
  UpcomingStoryEventType,
} from "../views/StoryEventSelectors";
import { getDesktop, isDesktopApp } from "../../Desktop";
import { useDesktopState } from "../../DesktopState";
import { restoreMenuFocus } from "./useMenuKeys";

/**
 * The game's global state: cash, monthly profit on wide screens, the date, speed, year progress,
 * and whether the lights are currently out.
 *
 * This used to live inside whichever pane happened to be showing, which on desktop meant all of
 * it was reported from the top-left corner of column one. None of it belongs to a single pane,
 * so it spans the app instead -- one bar above the panes on desktop, and the card's own header
 * on a phone, where there is only ever one pane anyway.
 *
 * Narrower windows stack it in two rows: cash, date and speed above, then the grid readout and
 * the mission. Once the workspace has room for side columns those rows fold into one bar, in the
 * order a player checks them: cash, profit and date, the grid, the mission (the only part that
 * gives up width), then the speed controls pinned right where they always are.
 */

export interface StateProps {
  activeEvents?: ActiveEventGroupType[];
  upcomingEvents?: UpcomingStoryEventType[];
  game: GameType;
  evidenceRequest?: EvidenceRequestType;
  facilityDragActive?: boolean;
  activeSave?: { id: string; name: string };
  saveState?: "idle" | "saving" | "saved" | "failed";
  savedAt?: string;
  saveError?: string;
}

export interface DispatchProps {
  onEvidence?: (target: EvidenceTargetType) => void;
  onEvidenceAcknowledged?: (request: EvidenceRequestType) => void;
  onManual: () => void;
  onSettings: () => void;
  onAchievements?: () => void;
  onSavedGames?: () => void;
  onSpeedChange: (speed: SpeedType) => void;
  onNextTutorial: (scenarioId: number) => void;
  onQuit: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const LOW_RESERVE_RATIO = 0.1;
const NO_ACTIVE_EVENTS: ActiveEventGroupType[] = [];
/** Status row controls that keep keyboard focus when the row moves into or out of the top bar. */
const RESTORABLE_STATUS_FOCUS = [".missionRiskButton", ".missionSummaryMonths"];

type GridHealthState =
  "stable" | "low-reserve" | "at-limit" | "blackout-ahead" | "blackout";

interface GridHealth {
  state: GridHealthState;
  label: string;
  metric: string;
  announcement: string;
}

/** The reducer includes ramp, water and storage limits in this available cushion. */
export function reserveCapacityW(
  _game: GameType,
  now: TickPresentFutureType,
): number {
  return now.reserveW ?? now.supplyW - now.demandW;
}

/**
 * Turns the live supply margin into the few states a player can act on at a glance. A shortfall
 * later in today's operating sample outranks any reserve reading now: a "Stable" grid that is
 * about to black out would be false reassurance.
 */
export function getGridHealth(
  game: GameType,
  now: TickPresentFutureType,
): GridHealth {
  if (now.supplyW < now.demandW) {
    return {
      state: "blackout",
      label: "Blackout",
      metric: `${formatWatts(now.demandW - now.supplyW)} short`,
      announcement: "Blackout. Demand is higher than supply.",
    };
  }

  const ahead = projectedShortfall(game.timeline, game.date.minute);
  if (ahead) {
    const at = formatHour(getDateFromMinute(ahead.minute, game.startingYear));
    return {
      state: "blackout-ahead",
      label: "Blackout ahead",
      metric: `${formatWatts(ahead.demandW - ahead.supplyW)} short at ${at}`,
      announcement: `Blackout expected at ${at}. Demand will be higher than supply.`,
    };
  }

  const reserveW = Math.max(0, reserveCapacityW(game, now));
  if (reserveW === 0) {
    return {
      state: "at-limit",
      label: "At limit",
      metric: "0W reserve",
      announcement: "Grid at limit. No reserve remains.",
    };
  }

  const reserveRatio = now.demandW > 0 ? reserveW / now.demandW : Infinity;
  if (reserveRatio <= LOW_RESERVE_RATIO) {
    const reservePercent = Math.round(reserveRatio * 100);
    return {
      state: "low-reserve",
      label: "Low reserve",
      metric: `${formatWatts(reserveW)} reserve (${reservePercent}%)`,
      announcement: "Low reserve.",
    };
  }

  return {
    state: "stable",
    label: "Stable",
    metric: `${formatWatts(reserveW)} reserve`,
    announcement: "Grid stable.",
  };
}

/** "72MW" -> "72 MW", the spacing the status row reads with. */
function spacedWatts(watts: number): string {
  return formatWatts(watts).replace(/([kMGT]?W)$/, " $1");
}

/** The full stable readout, which phones keep behind the icon's tooltip. */
export function stableGridSummary(
  game: GameType,
  now: TickPresentFutureType,
): string {
  return `Stable, ${spacedWatts(now.demandW)} demand met with ${spacedWatts(
    Math.max(0, reserveCapacityW(game, now)),
  )} reserve`;
}

const STATUS_TOOLTIP_MS = 2500;

/**
 * Grid health on a phone: a fixed-size icon whose tooltip carries the full readout. Hover and
 * keyboard focus open it as usual; a tap toggles it, until a tap elsewhere or a few seconds.
 * Reset when the status changes so a previously pinned tooltip does not reopen on its own.
 */
function CompactGridStatus({
  health,
  summary,
}: {
  health: GridHealth;
  summary: string;
}) {
  const [open, setOpen] = React.useState(false);
  // A tap pins the tooltip: the browser follows a touch with a synthetic mouseleave, which
  // would otherwise close it the moment the finger lifts.
  const [pinned, setPinned] = React.useState(false);
  React.useEffect(() => {
    if (!pinned) return;
    const timer = setTimeout(() => {
      setPinned(false);
      setOpen(false);
    }, STATUS_TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [pinned]);
  return (
    <div className={`gridHealth gridHealth-${health.state} gridHealth-compact`}>
      <ClickAwayListener
        onClickAway={() => {
          setPinned(false);
          setOpen(false);
        }}
      >
        <Tooltip
          title={summary}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => {
            if (!pinned) setOpen(false);
          }}
          disableTouchListener
          arrow
          // Keep it off the screen edge rather than flush against it.
          slotProps={{
            popper: {
              modifiers: [{ name: "preventOverflow", options: { padding: 8 } }],
            },
          }}
        >
          <button
            type="button"
            className="gridHealthStatusButton"
            aria-label={`Current grid status: ${summary}`}
            onClick={() => {
              setOpen(!pinned);
              setPinned(!pinned);
            }}
          >
            <span className="gridHealthStatusIcon" aria-hidden="true">
              {health.state === "stable" ? (
                <>
                  <FlashOnIcon className="gridHealthStableBolt" />
                  <CheckCircleIcon className="gridHealthStableCheck" />
                </>
              ) : (
                <ConceptIcon
                  concept={health.state === "blackout" ? "blackout" : "danger"}
                />
              )}
            </span>
          </button>
        </Tooltip>
      </ClickAwayListener>
    </div>
  );
}

export function GameAppBar(props: Props) {
  const steamAvailable = useDesktopState()?.steam.available;
  const {
    evidenceRequest,
    facilityDragActive,
    onEvidence,
    onEvidenceAcknowledged,
  } = props;
  const { game, onManual, onNextTutorial, onQuit, onSettings, onSpeedChange } =
    props;
  const date = game.date;
  const now = getTimeFromTimeline(date.minute, game.timeline);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(
    null,
  );
  const online = useOnline();
  const connectionDescriptionId = React.useId();
  // The Scenario tool opens by navigation (see evidenceCard); there is nothing in it to point at
  React.useEffect(() => {
    if (evidenceRequest?.target === "mission-details" && !facilityDragActive) {
      onEvidenceAcknowledged?.(evidenceRequest);
    }
  }, [evidenceRequest, facilityDragActive, onEvidenceAcknowledged]);

  const bigScreen = isBigScreen();
  // Tracks resizes even while paused, when the bar otherwise has no reason to re-render.
  const singleRow = useMediaQuery(SIDE_LAYOUT_MEDIA, { noSsr: true });
  const showProfit = useMediaQuery("(min-width:1024px)", { noSsr: true });
  const monthlyProfit = React.useMemo(
    () =>
      showProfit
        ? deriveExpandedSummary(
            summarizeTimeline(
              game.timeline,
              game.startingYear,
              (tick) =>
                Math.floor(tick.minute / MINUTES_PER_MONTH) ===
                date.monthsElapsed,
            ),
          ).profit
        : 0,
    [showProfit, game.timeline, game.startingYear, date.monthsElapsed],
  );
  // Crossing the breakpoint moves the status row to another parent, which remounts its
  // controls; a player tabbed onto one keeps their place rather than dropping to the page.
  const layoutSeen = React.useRef(singleRow);
  const refocus = React.useRef<string>();
  if (layoutSeen.current !== singleRow) {
    layoutSeen.current = singleRow;
    const focused = document.activeElement;
    refocus.current = RESTORABLE_STATUS_FOCUS.find((selector) =>
      focused?.matches(`#appbar ${selector}`),
    );
  }
  React.useLayoutEffect(() => {
    const selector = refocus.current;
    refocus.current = undefined;
    if (selector) {
      document
        .querySelector<HTMLElement>(`#appbar ${selector}`)
        ?.focus({ preventScroll: true });
    }
  }, [singleRow]);
  const multiplayer = game.multiplayer;
  const inMultiplayer = !!multiplayer;
  const clock = multiplayer?.clock;
  const speed = clock?.selectedSpeed ?? game.speed;
  // Watching somebody else's run rather than playing your own. The speed controls stay live --
  // being able to pause and fast forward is most of the point of a replay
  const isReplay = !!game.replayPlayback;
  // Undefined outside a tutorial, and on the last one - so this doubles as "is there a next
  // tutorial to offer?" for the menu item below. Also undefined throughout a replay, since a
  // tutorial never sets a score and so never has one to watch
  const nextTutorial = getNextTutorial(game.scenarioId);
  // A tutorial's progress isn't worth resuming, so its menu item just says where it goes - only a
  // real run gets the "Save & Quit" reminder that leaving keeps it around to come back to
  const isTutorial = !!getScenario(game.scenarioId, game.customScenario)
    ?.tutorialSteps;
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) =>
    setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleQuit = React.useCallback(() => {
    setMenuAnchorEl(null);
    onQuit();
    restoreMenuFocus("[data-main-action]");
  }, [onQuit]);

  /**
   * The bar has to re-render every tick to keep the cash and the clock honest, which at FAST is
   * a hundred times a second. Everything else in it -- the speed toggles, menu button and
   * kept-mounted menu -- only changes when the player clicks something, so those subtrees are
   * built once per actual change and handed back as the same elements. React then skips them
   * entirely on the frames in between, which is where a good quarter of the frame budget went.
   */
  // Layout and speed availability must use the same media-query snapshot during resize.
  const desktop = singleRow;
  const speedOptions = React.useMemo(
    () =>
      buildSpeedOptions({
        speed,
        onSpeedChange,
        desktop,
        multiplayer: sharedClockSpeedProps(multiplayer),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speed, onSpeedChange, desktop, clock, multiplayer?.seat],
  );
  // A window narrowed below desktop width loses the ULTRA button, so it can't stay the selected
  // speed. Re-checked whenever the speed changes too: a card that paused the clock can restore
  // ULTRA after the window has already shrunk.
  React.useEffect(() => {
    if (!multiplayer && speed === "ULTRA" && !desktop) {
      onSpeedChange("FAST");
    }
  }, [speed, desktop, onSpeedChange, multiplayer]);

  const menu = React.useMemo(
    () => (
      <>
        <IconButton
          data-settings-trigger
          data-saves-trigger
          data-achievements-trigger
          className="gameMenuButton"
          onClick={handleMenuClick}
          aria-label="menu"
          aria-describedby={online ? undefined : connectionDescriptionId}
          edge="start"
          color="primary"
          size="large"
        >
          <MoreVertIcon />
          {!online && (
            <>
              <span className="offlineDot" aria-hidden="true" />
              <span id={connectionDescriptionId} className="srOnly">
                Offline: saving to this device only
              </span>
            </>
          )}
        </IconButton>
        <Menu
          id="gameCardMenu"
          anchorEl={menuAnchorEl}
          keepMounted
          open={Boolean(menuAnchorEl)}
          onClose={handleMenuClose}
        >
          {/* The app-wide offline banner would cover the game, so it is said here instead */}
          {!online && (
            <MenuItem disabled className="gameMenuOffline">
              <span className="offlineDot" aria-hidden="true" />
              Offline: saving to this device only
            </MenuItem>
          )}
          <MenuItem onClick={onManual}>Manual</MenuItem>
          <MenuItem onClick={onSettings}>Settings</MenuItem>
          {!steamAvailable && (
            <MenuItem onClick={props.onAchievements}>Achievements</MenuItem>
          )}
          {!inMultiplayer && (
            <MenuItem onClick={props.onSavedGames}>Saved games</MenuItem>
          )}
          <MenuItem onClick={() => openWindow(FEEDBACK_URL)}>
            Send feedback
          </MenuItem>
          {/* Mid-tutorial, the thing a player who has seen enough wants is the next tutorial,
              not the scenario list they would have to go back through to reach it */}
          {nextTutorial && (
            <MenuItem onClick={() => onNextTutorial(nextTutorial.id)}>
              Next tutorial
            </MenuItem>
          )}
          <MenuItem onClick={handleQuit}>
            {isReplay
              ? "Exit replay"
              : isTutorial
                ? "Main menu"
                : "Save & Quit"}
          </MenuItem>
          {process.env.REACT_APP_DESKTOP === "true" && isDesktopApp() && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                void getDesktop()?.quit();
              }}
            >
              Quit
            </MenuItem>
          )}
        </Menu>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      menuAnchorEl,
      online,
      connectionDescriptionId,
      onManual,
      onSettings,
      props.onSavedGames,
      inMultiplayer,
      props.onAchievements,
      steamAvailable,
      onNextTutorial,
      handleQuit,
      nextTutorial,
      isReplay,
      isTutorial,
    ],
  );

  const openEvents = React.useCallback(
    () => onEvidence?.({ card: "EVENTS" }),
    [onEvidence],
  );

  if (!game.inGame || !now) {
    return <span />;
  }

  const gridHealth = getGridHealth(game, now);
  const inBlackout = gridHealth.state === "blackout";
  // Low reserve and at-limit share the mission tracker's goal-risk warning treatment.
  const inWarning = !inBlackout && gridHealth.state !== "stable";
  // Tutorials have no mission row, so the readout would be too short to hold a full-size control;
  // their HUD tells the story instead.
  const activeEvents = (!isTutorial && props.activeEvents) || NO_ACTIVE_EVENTS;
  // Every phone status uses the same space; changing reserve must not resize the header.
  const compactStatus = !isPaneLayout();
  const summary =
    gridHealth.state === "stable"
      ? stableGridSummary(game, now)
      : `${gridHealth.label}, ${gridHealth.metric}`;

  const statusRow = (
    <div className="gameStatusBar">
      {compactStatus ? (
        <CompactGridStatus
          key={gridHealth.state}
          health={gridHealth}
          summary={summary}
        />
      ) : (
        <div
          className={`gridHealth gridHealth-${gridHealth.state}${inWarning ? " statusWarning" : ""}`}
          role="group"
          aria-label={`Current grid status: ${gridHealth.label}, ${gridHealth.metric}`}
        >
          <div className="gridHealthSummary">
            <span className="statusIcon" aria-hidden="true">
              <ConceptIcon
                concept={
                  inBlackout
                    ? "blackout"
                    : gridHealth.state === "stable"
                      ? "supply"
                      : "danger"
                }
                fontSize="small"
              />
            </span>
            <strong className="gridHealthMetric">
              {gridHealth.label},{" "}
              {gridHealth.state === "stable"
                ? spacedWatts(reserveCapacityW(game, now))
                : gridHealth.metric}
            </strong>
          </div>
        </div>
      )}
      {/* Tutorials have no term goal to track; their own HUD carries the objective. */}
      {!isTutorial && (
        <MissionSummary
          game={game}
          upcoming={props.upcomingEvents}
          activeEvents={activeEvents}
          onActiveEvents={openEvents}
          onEvidence={props.onEvidence}
        />
      )}
    </div>
  );

  return (
    <div id="appbar" className={singleRow ? "appbarSingleRow" : undefined}>
      <div id="topbar">
        <Toolbar className={inBlackout ? "blackout-pulsing" : ""}>
          {menu}
          <Typography variant="h6" className="gameStatus">
            <span className="gameStatusValue">
              {formatMoneyStable(now.cash)}
            </span>
            {showProfit && (
              <Tooltip title="Current month forecast: revenue minus operating expenses, including interest and imports.">
                <Typography
                  component="span"
                  className="gameMonthlyProfit"
                  color={
                    monthlyProfit < 0
                      ? "error"
                      : monthlyProfit > 0
                        ? "success"
                        : "textSecondary"
                  }
                  aria-label={`Monthly profit forecast ${formatMoneyStable(monthlyProfit)}`}
                >
                  {monthlyProfit > 0 ? "+" : ""}
                  {formatMoneyStable(monthlyProfit)}/mo
                </Typography>
              </Tooltip>
            )}
            <span className="weak gameStatusValue">
              {/* One inline run, so the flex gap doesn't open before the comma. */}
              <span>
                {date.month} {date.year}
                {bigScreen && (
                  <span className="gameStatusHour">, {formatHour(date)}</span>
                )}
              </span>
            </span>
            {isReplay && <span className="replayBadge">REPLAY</span>}
          </Typography>
          {singleRow && statusRow}
          <div id="speedChangeButtons">{speedOptions}</div>
        </Toolbar>
      </div>
      {!isTutorial && !isReplay && props.saveState === "failed" && (
        <Typography
          className="saveStatus"
          data-save-state={props.saveState}
          data-active-save-id={props.activeSave?.id}
          role="alert"
          variant="caption"
          color="warning.main"
          sx={{ px: 2, pb: 0.5 }}
          title={props.saveError}
        >
          <button className="saveStatusAction" onClick={props.onSavedGames}>
            Save failed · Manage saves
          </button>
        </Typography>
      )}
      {!isTutorial && !isReplay && props.saveState !== "failed" && (
        <span
          hidden
          data-save-state={props.saveState}
          data-active-save-id={props.activeSave?.id}
        />
      )}
      {!singleRow && statusRow}
      {game.customScenario?.mod && (
        <Typography
          className="modRunStatus"
          variant="caption"
          color="textSecondary"
          sx={{ px: 2, pb: 0.5 }}
        >
          Modded · Unranked
        </Typography>
      )}
      {game.challenge && (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ px: 2, pb: 0.5 }}
        >
          Friend’s target: {formatNumber(game.challenge.target)} · Shared score
          · unverified
        </Typography>
      )}
      <span className="srOnly" aria-live="polite">
        {gridHealth.announcement}
      </span>
      <div
        id="yearProgressBar"
        role="progressbar"
        aria-label="Year progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(date.percentOfYear * 100)}
      >
        <div
          className="yearProgressFill"
          style={{ width: `${date.percentOfYear * 100}%` }}
        />
      </div>
    </div>
  );
}

const mapStateToProps = (state: AppStateType): StateProps => ({
  activeEvents: selectActiveEventGroups(state),
  upcomingEvents: selectUpcomingStoryEvents(state),
  game: state.game,
  evidenceRequest: state.ui.evidenceRequest,
  facilityDragActive: state.ui.facilityDragActive,
  activeSave: state.saves?.activeId
    ? {
        id: state.saves.activeId,
        name:
          state.saves.entries.find(
            (entry) => entry.id === state.saves?.activeId,
          )?.name ||
          state.saves.pendingName ||
          "Current game",
      }
    : undefined,
  saveState: state.saves?.saveState,
  savedAt: state.saves?.savedAt,
  saveError: state.saves?.saveError,
});

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onEvidence: (target) => {
      dispatch(openEvidence(target));
    },
    onEvidenceAcknowledged: (request) => {
      dispatch(acknowledgeEvidence(request));
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onAchievements: () => {
      dispatch(navigate("ACHIEVEMENTS"));
    },
    onSavedGames: () => {
      dispatch(navigate("SAVED_GAMES"));
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
    onNextTutorial: (scenarioId: number) => {
      void runSaveTransition(() => startTutorial(dispatch, scenarioId));
    },
    onQuit: () => {
      void quitSavedGame();
    },
  };
};

const GameAppBarContainer = connectToStore(
  mapStateToProps,
  mapDispatchToProps,
)(GameAppBar);

export default GameAppBarContainer;
