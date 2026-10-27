import ChallengeLanding from "./views/ChallengeLanding";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  SnackbarContent,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import * as React from "react";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import { CARD_TRANSITION_ANIMATION_MS, NAV_CARDS } from "../Constants";
import {
  CardNameType,
  CardType,
  SettingsType,
  TransitionClassType,
  TutorialStepChangeType,
  TutorialStepType,
  TutorialUiIdType,
  UIType,
  isGatedStep,
} from "../Types";
import AudioContainer from "./base/AudioContainer";
import GameWorkspace from "./base/GameWorkspace";
import { GAME_TOOLS, GameTool } from "./base/Navigation";
import { restoreMenuFocus } from "./base/useMenuKeys";
import { TOOL_SHORTCUTS } from "./base/KeyboardShortcuts";
import { listenForShortcuts } from "./base/GlobalShortcuts";
import DisplayNameDialogContainer from "./base/DisplayNameDialogContainer";
import InstallAppButton from "./base/InstallAppButton";
import TutorialHud from "./base/TutorialHud";
import DataCenterGuide from "./base/DataCenterGuide";
import LowCashWarning from "./base/LowCashWarning";
import VictoryDialogContainer from "./base/VictoryDialogContainer";
import SaveTransitionDialog from "./base/SaveTransitionDialog";
import CustomGameContainer from "./views/CustomGameContainer";
import DataCenterSetupContainer from "./views/DataCenterSetupContainer";
import LoadingContainer from "./views/LoadingContainer";
import MainMenuContainer from "./views/MainMenuContainer";
import ManualHelpPopover from "./base/ManualHelpPopover";
import ManualContainer from "./views/ManualContainer";
import NewGameContainer from "./views/NewGameContainer";
import NewGameDetailsContainer from "./views/NewGameDetailsContainer";
import SettingsContainer from "./views/SettingsContainer";
import SavedGames from "./views/SavedGames";
import { navigate, navigateBack } from "../reducers/Card";
import {
  reprioritizeFacility,
  setSpeed,
  togglePauseFacility,
} from "../reducers/Game";
import {
  selectTutorialActions,
  selectTutorialHiddenUi,
} from "../reducers/Tutorial";
import { snackbarOpen, manualHelpClose, manualHelpOpen } from "../reducers/UI";
import {
  flingSwipe,
  followSwipe,
  resetSwipe,
  shouldDismissSwipe,
  SWIPE_DISMISS_EXIT_MS,
} from "./base/SwipeDismiss";
import { isDesktopScreen } from "../Globals";
import { store } from "../Store";

const AchievementGallery = React.lazy(() =>
  import(
    /* webpackChunkName: "achievements-ui" */ "../achievements/Interface"
  ).then(({ AchievementGallery }) => ({ default: AchievementGallery })),
);

// Desktop-only: web builds drop the screen and its mod parser entirely.
const Mods =
  process.env.REACT_APP_DESKTOP === "true"
    ? React.lazy(() => import("./views/Mods"))
    : () => null;

const GAME_WORKSPACE_KEY = "GAME_WORKSPACE";

// How many facilities the number row can reach. Nine because that is how many number keys
// there are; a longer fleet is still reachable by mouse, and by the row actions
const FACILITY_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Shifted, because the bare number row is the speed control and has been for far longer than
// the fleet has had shortcuts of its own
const facilitySlotKey = (slot: number) => `shift+${slot}`;

// Keep in sync with SHORTCUTS in base/KeyboardShortcuts, which is what the Manual and Settings
// both list -- exported so a test can hold the two against each other rather than a comment
// asking politely. Text fields keep their character input, including `?`.
export const keyMap = {
  PAUSED: ["`", "space", "0"],
  SLOW: "1",
  NORMAL: "2",
  FAST: "3",
  ULTRA: "4",
  ...Object.fromEntries(
    GAME_TOOLS.map((tool) => [
      `TOOL_${tool.id}`,
      TOOL_SHORTCUTS[tool.id].toLowerCase(),
    ]),
  ),
  BUILD_GENERATOR: "g",
  BUILD_STORAGE: "s",
  PRIORITIZE_EARLIER: "[",
  PRIORITIZE_LATER: "]",
  MANUAL: ["?", "shift+/"],
  ESCAPE: "esc",
  ...Object.fromEntries(
    FACILITY_SLOTS.map((slot: number) => [
      `TOGGLE_FACILITY_${slot}`,
      facilitySlotKey(slot),
    ]),
  ),
};

/**
 * Whether the keys that act on the game should do anything right now.
 *
 * The hotkeys are global, so they fire over the main menu and the manual too -- and a replay is
 * somebody else's run, which the viewer does not get to reorder.
 */
function canPlay(): boolean {
  const state = store.getState();
  return (
    state.game.inGame &&
    !state.game.replayPlayback &&
    isNavCard(state.card.name)
  );
}

// Pausing from the keyboard offers the same undo the row's pause button does: the fleet is a
// list of similar-looking rows, and a mistyped number is the likeliest way to reach one
function togglePauseSlot(slot: number) {
  if (!canPlay()) {
    return;
  }
  const facility = store.getState().game.facilities[slot - 1];
  if (!facility || facility.yearsToBuildLeft > 0) {
    return;
  }
  const wasPaused = facility.paused;
  store.dispatch(togglePauseFacility(facility.id));
  store.dispatch(
    snackbarOpen({
      message: `${wasPaused ? "Resumed" : "Paused"} ${facility.name}`,
      actionLabel: "Undo",
      action: () => store.dispatch(togglePauseFacility(facility.id)),
      open: true,
      timeout: 6000,
    }),
  );
}

// Dispatch order is a core mechanic, and until now the only ways to change it were a drag and a
// pair of buttons that appear on hover. These move the open row, which is the one the other two
// panes are already reporting on
function reprioritizeSelected(delta: number) {
  if (!canPlay()) {
    return;
  }
  const { game, ui } = store.getState();
  const spotInList = game.facilities.findIndex(
    (f) => f.id === ui.selectedFacilityId,
  );
  const destination = spotInList + delta;
  if (
    spotInList < 0 ||
    destination < 0 ||
    destination >= game.facilities.length
  ) {
    return;
  }
  store.dispatch(reprioritizeFacility({ spotInList, delta }));
}

// A tool key does exactly what its action bar button does -- open the tool, or close it when it
// is already showing -- so it presses that button. One missing or hidden (Build in a replay, or
// a tutorial that hasn't introduced the bar yet) has no key either.
function toggleTool(tool: GameTool) {
  const { card, game } = store.getState();
  if (!game.inGame || !isGameCard(card.name)) {
    return;
  }
  const trigger = GAME_TOOLS.find((item) => item.id === tool)!.triggerId;
  const button = document.getElementById(trigger);
  if (button && button.getClientRects().length > 0) {
    button.click();
  }
}

// A shortcut must not reach a control the tutorial is still keeping hidden: a new player who
// presses space on Mission 1's first step would otherwise start a clock they haven't met yet
function uiHidden(id: TutorialUiIdType): boolean {
  return selectTutorialHiddenUi(store.getState()).includes(id);
}

function canBuild(): boolean {
  const actions = selectTutorialActions(store.getState());
  return (
    canPlay() &&
    !uiHidden("build") &&
    (!actions || actions.includes("BUILD_GENERATORS"))
  );
}

const shortcutHandlers = {
  // Space is one of this handler's own keys, and the browser's default action for it is to
  // scroll the page. Only this binding needs preventDefault: the other two (`` ` `` and `0`) have no
  // native behaviour of their own
  PAUSED: (e?: KeyboardEvent) => {
    e?.preventDefault();
    if (!uiHidden("speed")) {
      store.dispatch(setSpeed("PAUSED"));
    }
  },
  SLOW: () => {
    if (!uiHidden("speed")) {
      store.dispatch(setSpeed("SLOW"));
    }
  },
  NORMAL: () => {
    if (!uiHidden("speed")) {
      store.dispatch(setSpeed("NORMAL"));
    }
  },
  FAST: () => {
    if (!uiHidden("speed")) {
      store.dispatch(setSpeed("FAST"));
    }
  },
  // Desktop only, like its button
  ULTRA: () => {
    if (!uiHidden("speed") && isDesktopScreen()) {
      store.dispatch(setSpeed("ULTRA"));
    }
  },
  ...Object.fromEntries(
    GAME_TOOLS.map((tool) => [
      `TOOL_${tool.id}`,
      () => {
        if (!uiHidden(tool.id === "BUILD_GENERATORS" ? "build" : "nav")) {
          toggleTool(tool.id);
        }
      },
    ]),
  ),
  BUILD_GENERATOR: () => {
    if (canBuild()) {
      store.dispatch(
        navigate({ name: "BUILD_GENERATORS", dontRemember: true }),
      );
    }
  },
  BUILD_STORAGE: () => {
    if (canBuild()) {
      store.dispatch(navigate({ name: "BUILD_STORAGE", dontRemember: true }));
    }
  },
  PRIORITIZE_EARLIER: () =>
    !uiHidden("facilityActions") && reprioritizeSelected(-1),
  PRIORITIZE_LATER: () =>
    !uiHidden("facilityActions") && reprioritizeSelected(1),
  MANUAL: () => {
    store.dispatch(navigate("MANUAL"));
  },
  // The workspace handles tool dismissal, allowing nested controls to consume Escape first.
  // Full-screen destinations follow their Back button through history.
  ESCAPE: () => {
    const { card, game } = store.getState();
    if (game.inGame && !isGameCard(card.name)) {
      store.dispatch(navigateBack());
      // Escape may arrive before the gallery's entry focus settles.
      if (card.name === "ACHIEVEMENTS")
        restoreMenuFocus("[data-achievements-trigger]");
    }
  },
  ...Object.fromEntries(
    FACILITY_SLOTS.map((slot: number) => [
      `TOGGLE_FACILITY_${slot}`,
      () => !uiHidden("facilityActions") && togglePauseSlot(slot),
    ]),
  ),
};

export interface StateProps {
  card: CardType;
  settings: SettingsType;
  ui: UIType;
  transition: TransitionClassType;
  scenarioId: number;
  tutorialStep: number;
  tutorialSteps?: TutorialStepType[];
}

// Moved to Types so the tutorial gate middleware can share it without a component import;
// re-exported here for existing consumers
export type { TutorialStepChangeType } from "../Types";

export interface DispatchProps {
  closeDialog: () => void;
  closeSnackbar: () => void;
  onTutorialStep: (change: TutorialStepChangeType) => void;
  onTutorialEnd: (tutorialSteps: TutorialStepType[] | undefined) => void;
}

export interface Props extends StateProps, DispatchProps {}

export function isNavCard(name: CardNameType) {
  return NAV_CARDS.indexOf(name) !== -1;
}

export function isGameCard(name: CardNameType) {
  return isNavCard(name) || name.startsWith("BUILD_");
}

export default class Compositor extends React.Component<Props, {}> {
  private removeShortcuts?: () => void;
  private resizeTimeout: ReturnType<typeof setTimeout> | undefined;
  private snackbarContentRef = React.createRef<HTMLDivElement>();
  private dialogCancelRef = React.createRef<HTMLButtonElement>();
  private snackbarDrag?: { x: number; y: number; pointerId: number };
  private snackbarDismissTimeout: ReturnType<typeof setTimeout> | undefined;

  // react-transition-group falls back to ReactDOM.findDOMNode when no nodeRef is given, and
  // React 19 removed findDOMNode outright. TransitionGroup holds the exiting and the entering
  // child at the same time, so each needs its own ref rather than one shared one -- they are
  // cached per transition key, of which there is only ever the finite set of card names.
  private nodeRefs = new Map<string, React.RefObject<HTMLDivElement>>();

  private nodeRefFor(key: string): React.RefObject<HTMLDivElement> {
    let ref = this.nodeRefs.get(key);
    if (!ref) {
      ref = React.createRef<HTMLDivElement>();
      this.nodeRefs.set(key, ref);
    }
    return ref;
  }

  // isDesktopScreen() is read straight from the DOM rather than from state, so a resize needs
  // its own trigger -- forceUpdate skips shouldComponentUpdate, which otherwise blocks re-renders
  // when nothing about the current card has changed
  public handleResize = () => {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.forceUpdate(), 100);
  };

  public componentDidMount() {
    this.removeShortcuts = listenForShortcuts(keyMap, shortcutHandlers);
    window.addEventListener("resize", this.handleResize);
  }

  public componentDidUpdate(prevProps: Props) {
    if (
      this.props.ui.dialog.open &&
      (this.props.ui.dialog.destructive || this.props.ui.dialog.focusCancel) &&
      this.props.ui.dialog !== prevProps.ui.dialog
    ) {
      this.dialogCancelRef.current?.focus();
    }
    // A new toast replaces one that is still flying out: keep it on screen and open
    const { snackbar } = this.props.ui;
    if (
      snackbar.open &&
      (!prevProps.ui.snackbar.open ||
        snackbar.message !== prevProps.ui.snackbar.message)
    ) {
      clearTimeout(this.snackbarDismissTimeout);
      this.snackbarDismissTimeout = undefined;
      this.resetSnackbarDrag();
    }
  }

  public componentWillUnmount() {
    this.removeShortcuts?.();
    window.removeEventListener("resize", this.handleResize);
    clearTimeout(this.resizeTimeout);
    clearTimeout(this.snackbarDismissTimeout);
  }

  public moveTutorial = (toStep: number) => {
    this.props.onTutorialStep({
      fromStep: this.props.tutorialStep,
      toStep,
      tutorialSteps: this.props.tutorialSteps,
      scenarioId: this.props.scenarioId,
      currentCard: this.props.card.name,
    });
  };

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.ui.snackbar.action) {
      this.props.ui.snackbar.action(e);
    }
  }

  private resetSnackbarDrag = () => {
    this.snackbarDrag = undefined;
    resetSwipe(this.snackbarContentRef.current);
  };

  private snackbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // A press on Missions or the close button has to stay a click. Capturing the pointer
    // retargets its pointerup to the snackbar itself, so the browser fires the click there
    // instead of on the button and neither one ever did anything
    if (
      event.button !== 0 ||
      this.snackbarDismissTimeout !== undefined ||
      (event.target as HTMLElement).closest("button")
    ) {
      return;
    }
    this.snackbarDrag = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  private snackbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = this.snackbarDrag;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }
    followSwipe(event.currentTarget, start, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  private snackbarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = this.snackbarDrag;
    const content = this.snackbarContentRef.current;
    const end = { x: event.clientX, y: event.clientY };
    if (
      start &&
      content &&
      start.pointerId === event.pointerId &&
      shouldDismissSwipe(start, end)
    ) {
      this.snackbarDrag = undefined;
      // Fly out first, then close
      flingSwipe(content, start, end);
      this.snackbarDismissTimeout = setTimeout(() => {
        this.snackbarDismissTimeout = undefined;
        this.props.closeSnackbar();
      }, SWIPE_DISMISS_EXIT_MS);
      return;
    }
    this.resetSnackbarDrag();
  };

  private renderCard(): React.JSX.Element {
    if (isGameCard(this.props.card.name)) return <GameWorkspace />;
    switch (this.props.card.name) {
      case "SETTINGS":
        return <SettingsContainer />;
      case "ACHIEVEMENTS":
        return (
          <React.Suspense fallback={<p role="status">Loading achievements…</p>}>
            <AchievementGallery />
          </React.Suspense>
        );
      case "SAVED_GAMES":
        return <SavedGames />;
      case "MODS":
        return (
          <React.Suspense fallback={<p role="status">Loading mods…</p>}>
            <Mods />
          </React.Suspense>
        );
      case "MAIN_MENU":
        return <MainMenuContainer />;
      case "MANUAL":
        return <ManualContainer />;
      case "LOADING":
        return <LoadingContainer />;
      case "NEW_GAME":
        return <NewGameContainer />;
      case "NEW_GAME_DETAILS":
        return <NewGameDetailsContainer />;
      case "CHALLENGE":
        return <ChallengeLanding />;
      case "CUSTOM_GAME":
        return <CustomGameContainer />;
      case "DATA_CENTER_SETUP":
        return <DataCenterSetupContainer />;
      default:
        throw new Error("Unknown card " + this.props.card.name);
    }
  }

  public shouldComponentUpdate(nextProps: Props) {
    if (this.props.tutorialStep !== nextProps.tutorialStep) {
      return true;
    }

    if (
      this.props.ui.dialog !== nextProps.ui.dialog ||
      this.props.ui.snackbar !== nextProps.ui.snackbar ||
      this.props.ui.manualHelpEntry !== nextProps.ui.manualHelpEntry
    ) {
      return true;
    }

    // A new loading request must remount even when it replaces another loading request.
    if (this.props.card.name === nextProps.card.name) {
      return (
        nextProps.card.name === "LOADING" &&
        this.props.card.ts !== nextProps.card.ts
      );
    }

    return true;
  }

  public render() {
    const { tutorialStep, ui, closeDialog, tutorialSteps, closeSnackbar } =
      this.props;
    const currentTutorialStep =
      tutorialSteps && tutorialStep >= 0 && tutorialStep < tutorialSteps.length
        ? tutorialSteps[tutorialStep]
        : undefined;
    const canGoBack = !!(
      currentTutorialStep &&
      tutorialStep > 0 &&
      !isGatedStep(currentTutorialStep) &&
      !isGatedStep(tutorialSteps![tutorialStep - 1])
    );

    // Keep shared panes mounted when their navigation changes, so the pinned fleet stays visible.
    // A quick retry may start before the previous loading view finishes exiting.
    // A fresh key guarantees the new mission runs its loading lifecycle.
    const transitionKey =
      this.props.card.name === "LOADING"
        ? `LOADING:${this.props.card.ts}`
        : isGameCard(this.props.card.name)
          ? GAME_WORKSPACE_KEY
          : this.props.card.name;
    const transitionNodeRef = this.nodeRefFor(transitionKey);
    // Chrome the step hides is dropped by app.scss rules on this attribute, so no pane or bar
    // needs to know about tutorials to step aside
    const hiddenUi = currentTutorialStep?.hideUi;
    const menuLayout = !isGameCard(this.props.card.name);
    const singlePanel = menuLayout;

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div
        className={`app_container${singlePanel ? " single-panel" : ""}${menuLayout ? " menu-layout" : ""}`}
        data-tutorial-hide={hiddenUi?.length ? hiddenUi.join(" ") : undefined}
      >
        <TransitionGroup
          className="cardTransitions"
          childFactory={(child) =>
            // @types/react 19 defaults ReactElement's props to unknown rather than any,
            // so the element has to be named before cloneElement will accept classNames
            React.cloneElement(
              child as React.ReactElement<{ classNames: TransitionClassType }>,
              { classNames: this.props.transition },
            )
          }
        >
          <CSSTransition
            key={transitionKey}
            nodeRef={transitionNodeRef}
            onEnter={() => {
              if (transitionNodeRef.current)
                transitionNodeRef.current.inert = false;
            }}
            onExit={() => {
              // The outgoing screen stays visible while fading, but can't receive input.
              if (transitionNodeRef.current)
                transitionNodeRef.current.inert = true;
            }}
            onExited={() => {
              if (transitionKey.startsWith("LOADING:")) {
                this.nodeRefs.delete(transitionKey);
              }
            }}
            classNames={""}
            timeout={{
              enter: CARD_TRANSITION_ANIMATION_MS,
              exit: CARD_TRANSITION_ANIMATION_MS,
            }}
          >
            <main
              className={`base_main${
                // Fade in the setup linked from the separate guide document on its first load
                // (ts 0 is the startup card).
                this.props.card.ts === 0 &&
                this.props.card.name === "DATA_CENTER_SETUP"
                  ? " pageEnter"
                  : ""
              }`}
              ref={transitionNodeRef}
            >
              {this.renderCard()}
            </main>
          </CSSTransition>
        </TransitionGroup>
        {tutorialSteps &&
          currentTutorialStep &&
          this.props.card.name !== "LOADING" &&
          this.props.card.name !== "MANUAL" &&
          !ui.manualHelpEntry && (
            <TutorialHud
              desktop={isDesktopScreen()}
              step={currentTutorialStep}
              stepIndex={tutorialStep}
              totalSteps={tutorialSteps.length}
              canGoBack={canGoBack}
              onBack={() => this.moveTutorial(tutorialStep - 1)}
              onNext={() => this.moveTutorial(tutorialStep + 1)}
              onExit={() => this.props.onTutorialEnd(tutorialSteps)}
            />
          )}
        <DataCenterGuide />
        <LowCashWarning />
        <ManualHelpPopover
          entry={ui.manualHelpEntry}
          onClose={() => store.dispatch(manualHelpClose())}
          onRelated={(title: string) => store.dispatch(manualHelpOpen(title))}
        />
        <Dialog
          open={ui.dialog.open}
          aria-labelledby="app-dialog-title"
          slotProps={{
            transition: {
              onEntered: () => {
                if (
                  this.props.ui.dialog.destructive ||
                  this.props.ui.dialog.focusCancel
                )
                  this.dialogCancelRef.current?.focus();
              },
            },
          }}
          // v9 replaced `disableEscapeKeyDown` with filtering on the close reason. A
          // notCancellable dialog is one whose buttons are the only way forward - the end of a
          // run, the end of a tutorial - so a backdrop click has to be refused alongside Esc,
          // or dismissing it strands the player in a game that's already over
          onClose={() => {
            if (ui.dialog.notCancellable) {
              return;
            }
            closeDialog();
          }}
        >
          <DialogTitle id="app-dialog-title">{ui.dialog.title}</DialogTitle>
          <DialogContent>{ui.dialog.message}</DialogContent>
          <DialogActions>
            {ui.dialog.offerInstall && (
              <InstallAppButton label="Install for later" afterMilestone />
            )}
            {ui.dialog.secondaryAction && (
              <Button color="primary" onClick={ui.dialog.secondaryAction}>
                {ui.dialog.secondaryLabel || "Close"}
              </Button>
            )}
            {ui.dialog.tertiaryAction && (
              <Button color="primary" onClick={ui.dialog.tertiaryAction}>
                {ui.dialog.tertiaryLabel}
              </Button>
            )}
            {!ui.dialog.notCancellable && (
              <Button
                color="primary"
                autoFocus={ui.dialog.destructive || ui.dialog.focusCancel}
                ref={this.dialogCancelRef}
                onClick={closeDialog}
              >
                {ui.dialog.closeText || (ui.dialog.action ? "Cancel" : "OK")}
              </Button>
            )}
            {ui.dialog.action && (
              <Button
                color={ui.dialog.destructive ? "error" : "primary"}
                variant="contained"
                onClick={ui.dialog.action}
              >
                {ui.dialog.actionLabel || "OK"}
              </Button>
            )}
          </DialogActions>
        </Dialog>
        <Snackbar
          className={`snackbar ${isGameCard(this.props.card.name) ? "snackbar-above-nav" : ""}`}
          // Bottom left is the MUI default, which on a wide screen leaves the toast hanging
          // off the side of the centered app frame
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          open={ui.snackbar.open}
          autoHideDuration={ui.snackbar.timeout}
          onClose={(_event, reason) => {
            // A page action can open a new toast during the same click. Its click-away
            // event must not immediately dismiss that result.
            if (reason !== "clickaway") closeSnackbar();
          }}
        >
          <SnackbarContent
            ref={this.snackbarContentRef}
            className="snackbarContent"
            message={<span>{ui.snackbar.message}</span>}
            onPointerDown={this.snackbarPointerDown}
            onPointerMove={this.snackbarPointerMove}
            onPointerUp={this.snackbarPointerUp}
            onPointerCancel={this.resetSnackbarDrag}
            action={
              <>
                {ui.snackbar.actionLabel && (
                  <Button
                    onClick={(e: React.MouseEvent<HTMLElement>) =>
                      this.snackbarActionClicked(e)
                    }
                  >
                    {ui.snackbar.actionLabel}
                  </Button>
                )}
                <IconButton
                  className="snackbarClose"
                  aria-label="Dismiss notification"
                  size="small"
                  onClick={closeSnackbar}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            }
          />
        </Snackbar>
        {/* Connected, so they still update when shouldComponentUpdate blocks this component --
            neither is driven by the current card, and both can open over any of them */}
        <VictoryDialogContainer />
        <SaveTransitionDialog />
        <DisplayNameDialogContainer />
        <AudioContainer />
      </div>
    );
  }
}
