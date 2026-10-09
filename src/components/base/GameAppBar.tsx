import type { AppDispatch } from "../../Store";
import * as React from "react";
import {
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { formatHour, getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyStable, formatWatts } from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import { isBigScreen, isDesktopScreen, openWindow } from "../../Globals";
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
import ScenarioDetailsDialog from "./ScenarioDetailsDialog";
import ConceptIcon from "./ConceptIcon";
import { useOnline } from "./OnlineStatus";
import { buildSpeedOptions } from "./SpeedControls";
import MissionSummary from "./MissionSummary";
import "./OperatingHud.scss";
import { EvidenceRequestType, EvidenceTargetType } from "../../Types";
import { acknowledgeEvidence } from "../../reducers/UI";
import { openEvidence } from "../../helpers/Evidence";
import {
  ActiveEventGroupType,
  selectActiveEventGroups,
  selectUpcomingStoryEvents,
  UpcomingStoryEventType,
} from "../views/StoryEventSelectors";

/**
 * The game's global state: cash, the date, how fast time is running, how far through the year it
 * is, and whether the lights are currently out.
 *
 * This used to live inside whichever pane happened to be showing, which on desktop meant all of
 * it was reported from the top-left corner of column one. None of it belongs to a single pane,
 * so it spans the app instead -- one bar above the panes on desktop, and the card's own header
 * on a phone, where there is only ever one pane anyway.
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
  onSavedGames?: () => void;
  onSpeedChange: (speed: SpeedType) => void;
  onNextTutorial: (scenarioId: number) => void;
  onQuit: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const LOW_RESERVE_RATIO = 0.1;
const NO_ACTIVE_EVENTS: ActiveEventGroupType[] = [];

type GridHealthState = "stable" | "low-reserve" | "at-limit" | "blackout";

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

/** Turns the live supply margin into the few states a player can act on at a glance. */
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

export function GameAppBar(props: Props) {
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
  const [scenarioDetailsOpen, setScenarioDetailsOpen] = React.useState(false);
  const speedBeforeMenu = React.useRef<SpeedType>("PAUSED");
  const currentSpeed = React.useRef(game.speed);
  currentSpeed.current = game.speed;
  const online = useOnline();
  React.useEffect(() => {
    if (evidenceRequest?.target === "mission-details" && !facilityDragActive) {
      onEvidenceAcknowledged?.(evidenceRequest);
      setScenarioDetailsOpen(true);
    }
  }, [evidenceRequest, facilityDragActive, onEvidenceAcknowledged]);

  const bigScreen = isBigScreen();
  const speed = game.speed;
  // Watching somebody else's run rather than playing your own. The speed controls stay live --
  // being able to pause and fast forward is most of the point of a replay
  const isReplay = !!game.replayPlayback;
  // Undefined outside a tutorial, and on the last one - so this doubles as "is there a next
  // tutorial to offer?" for the menu item below. Also undefined throughout a replay, since a
  // tutorial never sets a score and so never has one to watch
  const nextTutorial = getNextTutorial(game.scenarioId);
  const scenario = getScenario(game.scenarioId, game.customScenario);
  // A tutorial's progress isn't worth resuming, so its menu item just says where it goes - only a
  // real run gets the "Save & Quit" reminder that leaving keeps it around to come back to
  const isTutorial = !!scenario?.tutorialSteps;
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    speedBeforeMenu.current = currentSpeed.current;
    onSpeedChange("PAUSED");
    setMenuAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    onSpeedChange(speedBeforeMenu.current);
  };
  const handleResume = () => {
    setMenuAnchorEl(null);
    onSpeedChange(
      speedBeforeMenu.current === "PAUSED" ? "NORMAL" : speedBeforeMenu.current,
    );
  };
  const visitFromMenu = (visit: (() => void) | undefined) => {
    // Restore before navigating so the existing blocking-card pause remembers the real speed.
    handleMenuClose();
    visit?.();
  };
  const handleQuit = React.useCallback(() => {
    setMenuAnchorEl(null);
    onQuit();
    window.setTimeout(() => {
      document.querySelector<HTMLElement>("[data-main-action]")?.focus();
    }, 350);
  }, [onQuit]);

  /**
   * The bar has to re-render every tick to keep the cash and the clock honest, which at FAST is
   * a hundred times a second. Everything else in it -- the speed toggles, menu button and
   * kept-mounted menu -- only changes when the player clicks something, so those subtrees are
   * built once per actual change and handed back as the same elements. React then skips them
   * entirely on the frames in between, which is where a good quarter of the frame budget went.
   */
  const desktop = isDesktopScreen();
  const speedOptions = React.useMemo(
    () =>
      buildSpeedOptions({
        speed,
        onSpeedChange,
        desktop,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speed, onSpeedChange, desktop],
  );
  // A window narrowed below desktop width loses the ULTRA button, so it can't stay the selected
  // speed. Re-checked whenever the speed changes too: a card that paused the clock can restore
  // ULTRA after the window has already shrunk.
  React.useEffect(() => {
    if (speed === "ULTRA" && !desktop) {
      onSpeedChange("FAST");
    }
  }, [speed, desktop, onSpeedChange]);

  const menu = React.useMemo(
    () => (
      <>
        <IconButton
          data-settings-trigger
          data-game-menu-trigger
          data-saves-trigger
          className="gameMenuButton"
          onClick={handleMenuClick}
          aria-label={online ? "menu" : "menu, offline"}
          title="Pause and options (Esc)"
          aria-expanded={Boolean(menuAnchorEl)}
          aria-controls={menuAnchorEl ? "gameCardMenu" : undefined}
          edge="start"
          color="primary"
          size="large"
        >
          <MoreVertIcon />
          {!online && <span className="offlineDot" aria-hidden="true" />}
        </IconButton>
        <Menu
          id="gameCardMenu"
          anchorEl={menuAnchorEl}
          keepMounted
          open={Boolean(menuAnchorEl)}
          onClose={handleMenuClose}
        >
          <ListSubheader component="li" disableSticky>
            Game paused
          </ListSubheader>
          <MenuItem
            onClick={handleResume}
            sx={{ fontWeight: 600, color: "primary.main" }}
          >
            Resume game
          </MenuItem>
          {/* The app-wide offline banner would cover the game, so it is said here instead */}
          {!online && (
            <MenuItem disabled className="gameMenuOffline">
              <span className="offlineDot" aria-hidden="true" />
              Offline: saving to this device only
            </MenuItem>
          )}
          <MenuItem onClick={() => visitFromMenu(onSettings)}>
            Settings
          </MenuItem>
          <MenuItem onClick={() => visitFromMenu(onManual)}>Manual</MenuItem>
          <MenuItem onClick={() => visitFromMenu(props.onSavedGames)}>
            Saved games
          </MenuItem>
          <MenuItem onClick={() => openWindow("/about.html#feedback")}>
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
        </Menu>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      menuAnchorEl,
      online,
      onManual,
      onSettings,
      onSpeedChange,
      props.onSavedGames,
      onNextTutorial,
      handleQuit,
      nextTutorial,
      isReplay,
      isTutorial,
      setScenarioDetailsOpen,
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

  return (
    <div id="appbar" className="operatingHud">
      <div id="topbar">
        <Toolbar className={inBlackout ? "blackout-pulsing" : ""}>
          {menu}
          {!isTutorial && (
            <div
              className="gameOperatingContext"
              aria-label="Current scenario and location"
            >
              <strong title={scenario?.name}>
                {scenario?.name || "Custom game"}
              </strong>
              <span title={game.location.name}>{game.location.name}</span>
            </div>
          )}
          <Typography variant="h6" className="gameStatus">
            <span className="gameStatusValue">
              {formatMoneyStable(now.cash)}
            </span>
            <span className="weak gameStatusValue">
              {date.month} {date.year}
              {bigScreen ? `, ${formatHour(date)}` : ""}
            </span>
            {isReplay && <span className="replayBadge">REPLAY</span>}
          </Typography>
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
      <div className="gameStatusBar">
        <div
          className={`gridHealth gridHealth-${gridHealth.state}${inWarning ? " statusWarning" : ""}`}
          aria-label={`Current grid status: ${gridHealth.label}, ${gridHealth.metric}`}
        >
          <div className="gridHealthSummary">
            <span className="gridHealthState">
              <span className="gridHealthTime">Now</span>
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
              <strong className="statusLabel">{gridHealth.label}</strong>
            </span>
            <strong className="gridHealthMetric">{gridHealth.metric}</strong>
          </div>
        </div>
        {/* Tutorials have no term goal to track; their own HUD carries the objective. */}
        {!isTutorial && (
          <MissionSummary
            game={game}
            upcoming={props.upcomingEvents}
            activeEvents={activeEvents}
            onActiveEvents={openEvents}
            onEvidence={props.onEvidence}
            onDetails={() => setScenarioDetailsOpen(true)}
          />
        )}
      </div>
      {game.challenge && (
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ px: 2, pb: 0.5 }}
        >
          Friend’s target: {game.challenge.target.toLocaleString("en-US")} ·
          Shared score · unverified
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
      <ScenarioDetailsDialog
        open={scenarioDetailsOpen}
        game={game}
        onClose={() => setScenarioDetailsOpen(false)}
      />
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
