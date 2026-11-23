import { multiplayerRuntime } from "../../multiplayer/Registry";
import { CouchPlayerText } from "../../couch/PlayerColor";
import { useMoney } from "./CurrencyContext";
import { useGameWorkspaceLayout } from "./GameWorkspaceContext";
import type { AppDispatch } from "../../Store";
import * as React from "react";
import {
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { formatNumber } from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import {
  isBigScreen,
  SIDE_LAYOUT_MEDIA,
  SIDE_LAYOUT_MIN_WIDTH,
} from "../../Globals";
import { getNextTutorial, getScenario } from "../../data/Scenarios";
import { setSpeed, startTutorial } from "../../reducers/Game";
import { quitSavedGame, runSaveTransition } from "../../SaveSession";
import {
  AppStateType,
  GameType,
  SpeedType,
  CardNameType,
  GameToolType,
  TickPresentFutureType,
} from "../../Types";
import { connectToStore } from "./ConnectToStore";
import { useOnline } from "./OnlineStatus";
import { buildSpeedOptions, sharedClockSpeedProps } from "./SpeedControls";
import MissionSummary from "./MissionSummary";
import { EvidenceRequestType, EvidenceTargetType } from "../../Types";
import {
  acknowledgeEvidence,
  feedbackOpen,
  manualHelpOpen,
} from "../../reducers/UI";
import { MANUAL_ENTRY } from "./ManualEntries";
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
import { createSelector } from "@reduxjs/toolkit";
import GameMenu from "./GameMenu";
import { GameDate, YearProgressBar } from "./GameCalendar";
import GridStatus from "./GridStatus";
import { getGridHealth } from "../../helpers/GridStatus";
import { selectTutorialActions } from "../../reducers/Tutorial";
import "./GameAppBar.scss";

export {
  getGridHealth,
  reserveCapacityW,
  stableGridSummary,
} from "../../helpers/GridStatus";

/**
 * The game's global state: cash, monthly profit, the date, speed, year progress,
 * and whether the lights are currently out.
 *
 * This used to live inside whichever pane happened to be showing, which on desktop meant all of
 * it was reported from the top-left corner of column one. None of it belongs to a single pane,
 * so it spans the app instead -- one bar above the panes on desktop, and the card's own header
 * on a phone, where there is only ever one pane anyway.
 *
 * Narrower windows stack it in two rows: cash, profit, date and speed above, then the grid readout and
 * the mission. Once the workspace has room for side columns those rows fold into one bar, in the
 * order a player checks them: cash, profit and date, the grid, the mission (the only part that
 * gives up width), then the speed controls pinned right where they always are.
 */

export interface StateProps {
  activeEvents?: ActiveEventGroupType[];
  upcomingEvents?: UpcomingStoryEventType[];
  game: GameType;
  tutorialActions?: GameToolType[];
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
  onReserveHelp?: () => void;
  onNavigate?: (card: CardNameType) => void;
  onSettings: () => void;
  onAchievements?: () => void;
  onSavedGames?: () => void;
  onSpeedChange: (speed: SpeedType) => void;
  onNextTutorial: (scenarioId: number) => void;
  onFeedback?: (scenarioId: number) => void;
  onQuit: () => void;
}

export interface Props extends StateProps, DispatchProps {
  eventStatus?: React.ReactNode;
  scenarioOpen?: boolean;
  onCloseScenario?: () => void;
}

/** Status controls retain focus when the row moves between header layouts. */
const RESTORABLE_STATUS_FOCUS = [
  ".gridHealthSummary",
  ".missionRiskButton",
  ".missionSummaryMonths",
  ".mapEventStatus",
];
const NO_ACTIVE_EVENTS: ActiveEventGroupType[] = [];
const SINGLE_ROW_MIN_WIDTH = 1120;

/**
 * This month's profit, bit-identical to deriveExpandedSummary(summarizeTimeline(...)).profit
 * but without the rest of the month summary: the same fields, summed in timeline order from
 * zero, then associated the way deriveExpandedSummary does.
 */
export function monthProfit(
  timeline: TickPresentFutureType[],
  monthsElapsed: number,
): number {
  let revenue = 0;
  let fuel = 0;
  let om = 0;
  let carbon = 0;
  let interest = 0;
  let policy = 0;
  let imports = 0;
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    if (Math.floor(t.minute / MINUTES_PER_MONTH) !== monthsElapsed) continue;
    revenue += t.revenue;
    fuel += t.expensesFuel;
    om += t.expensesOM;
    carbon += t.expensesCarbonFee;
    interest += t.expensesInterest;
    policy += t.expensesPolicy || 0;
    imports += t.expensesImports || 0;
  }
  const expenses = fuel + om + carbon + interest + (policy || 0);
  return revenue - (expenses + (imports || 0));
}

/** Present the current company's money, grid status and requested shared-clock speed.
 * Couch seats leave common calendar/menu chrome to the shell; memoized controls avoid tick churn. */

export function GameAppBar(props: Props) {
  const { formatMoneyStable, formatForecastMoney } = useMoney();
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
  // The Scenario tool opens by navigation (see evidenceCard); there is nothing in it to point at
  React.useEffect(() => {
    if (evidenceRequest?.target === "mission-details" && !facilityDragActive) {
      onEvidenceAcknowledged?.(evidenceRequest);
    }
  }, [evidenceRequest, facilityDragActive, onEvidenceAcknowledged]);

  const bigScreen = isBigScreen();
  // Tracks resizes even while paused, when the bar otherwise has no reason to re-render.
  const workspace = useGameWorkspaceLayout();
  const wideRow = useMediaQuery(`(min-width:${SINGLE_ROW_MIN_WIDTH}px)`, {
    noSsr: true,
  });
  const wideSpeedControls = useMediaQuery(SIDE_LAYOUT_MEDIA, { noSsr: true });
  const singleRow = workspace
    ? workspace.layout === "side" &&
      workspace.effectiveWidth >= SINGLE_ROW_MIN_WIDTH
    : wideRow;
  const monthlyProfit = React.useMemo(
    () => monthProfit(game.timeline, date.monthsElapsed),
    [game.timeline, date.monthsElapsed],
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
  const couchSeat = !!window.electrifyCouch;
  const multiplayer = game.multiplayer;
  const inMultiplayer = !!multiplayer;
  const clock = multiplayer?.clock;
  const speed = clock?.selectedSpeed ?? game.speed;
  // Undefined outside a tutorial, and on the last one - so this doubles as "is there a next
  // tutorial to offer?" for the menu item below.
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
  const desktop = workspace
    ? workspace.effectiveWidth >= SIDE_LAYOUT_MIN_WIDTH ||
      !!window.electrifyCouch
    : wideSpeedControls;
  const speedDisabled = !!multiplayer?.ending;
  const speedOptions = React.useMemo(
    () =>
      buildSpeedOptions({
        speed,
        onSpeedChange,
        desktop,
        disabled: speedDisabled,
        multiplayer: sharedClockSpeedProps(multiplayer),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speed, onSpeedChange, desktop, speedDisabled, clock, multiplayer?.seat],
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
      <GameMenu
        anchorEl={menuAnchorEl}
        online={online}
        onOpen={handleMenuClick}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={onManual}>Manual</MenuItem>
        <MenuItem
          onClick={() => {
            if (window.electrifyCouch) {
              handleMenuClose();
              window.electrifyCouch.post({
                kind: "global-settings",
                requestId: crypto.randomUUID(),
              });
            } else onSettings();
          }}
        >
          Settings
        </MenuItem>
        {!steamAvailable && (
          <MenuItem onClick={props.onAchievements}>Achievements</MenuItem>
        )}
        {!inMultiplayer && (
          <MenuItem onClick={props.onSavedGames}>Saved games</MenuItem>
        )}
        {props.onFeedback && (
          <MenuItem
            onClick={() => {
              handleMenuClose();
              props.onFeedback?.(game.scenarioId);
            }}
          >
            Share feedback
          </MenuItem>
        )}
        {/* Mid-tutorial, the thing a player who has seen enough wants is the next tutorial,
              not the scenario list they would have to go back through to reach it */}
        {nextTutorial && (
          <MenuItem onClick={() => onNextTutorial(nextTutorial.id)}>
            Next tutorial
          </MenuItem>
        )}
        {inMultiplayer && <OnlineSaveStatus />}
        {inMultiplayer && multiplayerRuntime()?.reconnect && (
          <MenuItem
            onClick={() => {
              handleMenuClose();
              multiplayerRuntime()?.reconnect?.();
            }}
          >
            Reconnect to campaign
          </MenuItem>
        )}
        <MenuItem onClick={handleQuit}>
          {isTutorial ? "Main menu" : "Save & Quit"}
        </MenuItem>
        {process.env.REACT_APP_DESKTOP === "true" &&
          isDesktopApp() &&
          !window.electrifyCouch && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                void getDesktop()?.quit();
              }}
            >
              Quit
            </MenuItem>
          )}
      </GameMenu>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      menuAnchorEl,
      online,
      onManual,
      onSettings,
      props.onSavedGames,
      inMultiplayer,
      props.onAchievements,
      steamAvailable,
      onNextTutorial,
      props.onFeedback,
      game.scenarioId,
      handleQuit,
      nextTutorial,
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
  const cashNegative = now.cash < 0;
  const inBlackout = gridHealth.state === "blackout";
  const activeEvents = (!isTutorial && props.activeEvents) || NO_ACTIVE_EVENTS;
  const statusRow = (
    <div className="gameStatusBar">
      <GridStatus
        game={game}
        now={now}
        tutorialActions={props.tutorialActions}
        onEvidence={onEvidence}
        onNavigate={props.onNavigate}
        onReserveHelp={props.onReserveHelp}
      />
      {/* Tutorials have no term goal to track; their own HUD carries the objective. */}
      {!isTutorial && !couchSeat && (
        <MissionSummary
          game={game}
          gridSupplyRiskVisible
          upcoming={props.upcomingEvents}
          activeEvents={activeEvents}
          onActiveEvents={openEvents}
          onEvidence={props.onEvidence}
          scenarioOpen={props.scenarioOpen}
          onCloseScenario={props.onCloseScenario}
        />
      )}
      {props.eventStatus}
    </div>
  );

  return (
    <div id="appbar" className={singleRow ? "appbarSingleRow" : undefined}>
      <div id="topbar">
        <Toolbar className={inBlackout ? "blackout-pulsing" : ""}>
          {!couchSeat && menu}
          <Typography variant="h6" component="div" className="gameStatus">
            <span className="gameBalance">
              <CouchPlayerText
                seatId={multiplayer?.seat}
                useSeatColor={!cashNegative}
                className={`gameStatusValue${cashNegative ? " gameCashNegative" : ""}`}
              >
                {formatMoneyStable(now.cash)}
              </CouchPlayerText>
              <Tooltip title="Current month forecast: revenue minus operating expenses, including interest and imports.">
                <Typography
                  // Tutorials lock navigation, so the figure opens nothing there.
                  {...(isTutorial
                    ? { component: "span" }
                    : {
                        component: "button",
                        type: "button",
                        onClick: () => props.onEvidence?.("finances"),
                      })}
                  className={`gameMonthlyProfit${isTutorial ? "" : " gameMonthlyProfitButton"}`}
                  color={
                    monthlyProfit < 0
                      ? "error"
                      : monthlyProfit > 0
                        ? "success"
                        : "textSecondary"
                  }
                  aria-label={`Monthly profit forecast ${formatForecastMoney(monthlyProfit)}`}
                >
                  {monthlyProfit > 0 ? "+" : ""}
                  {formatForecastMoney(monthlyProfit)}/mo
                </Typography>
              </Tooltip>
            </span>
            {!couchSeat && <GameDate date={date} showTime={bigScreen} />}
          </Typography>
          {singleRow && statusRow}
          <div id="speedChangeButtons">{speedOptions}</div>
        </Toolbar>
      </div>
      {!isTutorial && props.saveState === "failed" && (
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
      {!isTutorial && props.saveState !== "failed" && (
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
      {!couchSeat && <YearProgressBar date={date} />}
    </div>
  );
}

// The mapped props are compared shallowly, so the active save keeps one object per id and name
// rather than a fresh one on every store update.
const selectActiveSave = createSelector(
  [
    (state: AppStateType) => state.saves?.activeId,
    (state: AppStateType) => {
      const id = state.saves?.activeId;
      return id
        ? state.saves?.entries.find((entry) => entry.id === id)?.name ||
            state.saves?.pendingName ||
            "Current game"
        : undefined;
    },
  ],
  (id, name): StateProps["activeSave"] =>
    id && name ? { id, name } : undefined,
);

const mapStateToProps = (state: AppStateType): StateProps => ({
  activeEvents: selectActiveEventGroups(state),
  upcomingEvents: selectUpcomingStoryEvents(state),
  game: state.game,
  tutorialActions: selectTutorialActions(state),
  evidenceRequest: state.ui.evidenceRequest,
  facilityDragActive: state.ui.facilityDragActive,
  activeSave: selectActiveSave(state),
  saveState: state.saves?.saveState,
  savedAt: state.saves?.savedAt,
  saveError: state.saves?.saveError,
});

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onNavigate: (card) => {
      dispatch(navigate(card));
    },
    onEvidence: (target) => {
      dispatch(openEvidence(target));
    },
    onEvidenceAcknowledged: (request) => {
      dispatch(acknowledgeEvidence(request));
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onReserveHelp: () => {
      dispatch(manualHelpOpen(MANUAL_ENTRY.RESERVE_CAPACITY));
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
    onFeedback: (scenarioId) => {
      dispatch(feedbackOpen({ source: "game-menu", scenarioId }));
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

const noSaveTime = () => undefined;
const noSaveSubscription = () => () => {};
const saveTime = (timestamp?: number | null) =>
  timestamp ? new Date(timestamp).toLocaleString() : "Unavailable";

function OnlineSaveStatus() {
  const runtime = multiplayerRuntime();
  const device = React.useSyncExternalStore(
    runtime?.subscribeStatus ?? noSaveSubscription,
    runtime?.deviceSaveTime ?? noSaveTime,
  );
  const confirmed = React.useSyncExternalStore(
    runtime?.subscribeStatus ?? noSaveSubscription,
    runtime?.onlineSaveTime ?? noSaveTime,
  );
  if (!runtime?.onlineSaveTime) return null;
  return (
    <li role="presentation" className="onlineSaveStatus">
      <small>Device save {saveTime(device)}</small>
      <small>Confirmed online save {saveTime(confirmed)}</small>
      <small>
        Save &amp; Quit pauses play until the required players return.
      </small>
    </li>
  );
}

export default GameAppBarContainer;
