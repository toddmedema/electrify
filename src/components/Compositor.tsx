import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Typography,
} from "@mui/material";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import * as React from "react";
import { GlobalHotKeys, configure } from "react-hotkeys";
import {
  ACTIONS,
  EVENTS,
  Joyride,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import { CARD_TRANSITION_ANIMATION_MS, NAV_CARDS } from "../Constants";
import {
  CardNameType,
  CardType,
  SettingsType,
  TransitionClassType,
  TutorialStepChangeType,
  TutorialStepType,
  UIType,
  isGatedStep,
} from "../Types";
import AudioContainer from "./base/AudioContainer";
import DesktopPanes from "./base/DesktopPanes";
import DisplayNameDialogContainer from "./base/DisplayNameDialogContainer";
import InstallAppButton from "./base/InstallAppButton";
import EventLogContainer from "./views/EventLogContainer";
import NavigationContainer from "./base/NavigationContainer";
import GameAppBarContainer from "./base/GameAppBar";
import VictoryDialogContainer from "./base/VictoryDialogContainer";
import BuildGeneratorsContainer from "./views/BuildGeneratorsContainer";
import BuildStorageContainer from "./views/BuildStorageContainer";
import CustomGameContainer from "./views/CustomGameContainer";
import FacilitiesContainer from "./views/FacilitiesContainer";
import FinancesContainer from "./views/FinancesContainer";
import ForecastsContainer from "./views/ForecastsContainer";
import LoadingContainer from "./views/LoadingContainer";
import MainMenuContainer from "./views/MainMenuContainer";
import ManualContainer from "./views/ManualContainer";
import NewGameContainer from "./views/NewGameContainer";
import NewGameDetailsContainer from "./views/NewGameDetailsContainer";
import SettingsContainer from "./views/SettingsContainer";
import { navigate, navigateBack } from "../reducers/Card";
import {
  reprioritizeFacility,
  setSpeed,
  togglePauseFacility,
} from "../reducers/Game";
import { snackbarOpen } from "../reducers/UI";
import { isDesktopScreen, isPaneLayout, isUltrawideScreen } from "../Globals";
import { store } from "../Store";

// All three of these cards are shown at once side by side above the desktop breakpoint (see
// isDesktopScreen / $desktop_breakpoint), so they share one stable transition key there --
// switching among them shouldn't slide/remount the pane group, since nothing visibly changes
const DESKTOP_PANES_KEY = "DESKTOP_PANES";

// And the same again for the two-column layout below it, where Facilities is pinned and the nav
// swaps what is beside it -- the pinned column would otherwise slide off with the card transition
const TABLET_PANES_KEY = "TABLET_PANES";

// How many facilities the number row can reach. Nine because that is how many number keys
// there are; a longer fleet is still reachable by mouse, and by the row actions
const FACILITY_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Shifted, because the bare number row is the speed control and has been for far longer than
// the fleet has had shortcuts of its own
const facilitySlotKey = (slot: number) => `shift+${slot}`;

// react-hotkeys' default ignoreEventsCondition treats every <input> as a text field and drops
// the keydown entirely -- but the capacity sliders on the build screens and the marketing
// spend slider in Finances are MUI Sliders, which render as a bare <input type="range">. Just
// clicking one leaves it focused, and from then on every shortcut silently did nothing until
// the player happened to click something else -- the "some element is pulling focus" bug.
// These types don't take character input, so there's nothing for a shortcut key to clobber.
// Escape is exempted outright too, so it can always back out of a screen even if focus never
// left an actual text field.
const NON_TEXT_INPUT_TYPES = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "color",
  "submit",
  "reset",
  "image",
  "file",
]);
configure({
  ignoreEventsCondition: (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      return false;
    }
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (!tagName) {
      return false;
    }
    if (
      tagName === "input" &&
      NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)
    ) {
      return false;
    }
    return (
      tagName === "input" ||
      tagName === "select" ||
      tagName === "textarea" ||
      !!target?.isContentEditable
    );
  },
});

// Keep in sync with SHORTCUTS in base/KeyboardShortcuts, which is what the Manual and Settings
// both list -- exported so a test can hold the two against each other rather than a comment
// asking politely. react-hotkeys ignores key events from inputs, so `?` still types into a
// text field
export const keyMap = {
  PAUSED: ["`", "space", "0"],
  SLOW: "1",
  NORMAL: "2",
  FAST: "3",
  FACILITIES: "q",
  FINANCES: "w",
  FORECASTS: "e",
  EVENTS: "r",
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

const shortcutHandlers = {
  // Space is one of this handler's own keys, and the browser's default action for it is to
  // scroll the page -- which fires alongside the pause because react-hotkeys doesn't call
  // preventDefault for you. Only this binding needs it: the other two (`` ` `` and `0`) have no
  // native behaviour of their own
  PAUSED: (e?: KeyboardEvent) => {
    e?.preventDefault();
    store.dispatch(setSpeed("PAUSED"));
  },
  SLOW: () => {
    store.dispatch(setSpeed("SLOW"));
  },
  NORMAL: () => {
    store.dispatch(setSpeed("NORMAL"));
  },
  FAST: () => {
    store.dispatch(setSpeed("FAST"));
  },
  FACILITIES: () => {
    store.dispatch(navigate("FACILITIES"));
  },
  FINANCES: () => {
    store.dispatch(navigate("FINANCES"));
  },
  FORECASTS: () => {
    store.dispatch(navigate("FORECASTS"));
  },
  EVENTS: () => {
    store.dispatch(navigate("EVENTS"));
  },
  BUILD_GENERATOR: () => {
    if (canPlay()) {
      store.dispatch(
        navigate({ name: "BUILD_GENERATORS", dontRemember: true }),
      );
    }
  },
  BUILD_STORAGE: () => {
    if (canPlay()) {
      store.dispatch(navigate({ name: "BUILD_STORAGE", dontRemember: true }));
    }
  },
  PRIORITIZE_EARLIER: () => reprioritizeSelected(-1),
  PRIORITIZE_LATER: () => reprioritizeSelected(1),
  MANUAL: () => {
    store.dispatch(navigate("MANUAL"));
  },
  // Every screen that isn't one of the three panes (Build Generator/Storage, Manual, Settings)
  // is reached by a "back"/"close" control rather than tab navigation, and none of them
  // responded to Escape -- this gives all of them one, without hardcoding which cards count
  ESCAPE: () => {
    const { card, game } = store.getState();
    if (game.inGame && !isNavCard(card.name)) {
      store.dispatch(navigateBack());
    }
  },
  ...Object.fromEntries(
    FACILITY_SLOTS.map((slot: number) => [
      `TOGGLE_FACILITY_${slot}`,
      () => togglePauseSlot(slot),
    ]),
  ),
};

function Tooltip(props: TooltipRenderProps): React.JSX.Element {
  const {
    index,
    size,
    step,
    backProps,
    closeProps,
    primaryProps,
    tooltipProps,
    isLastStep,
  } = props;
  const isString = typeof step.content === "string";
  // Presentation flags baked in by stepsForViewport: a gated step has no Next button -
  // doing the highlighted deed is what advances it - and Back is hidden next to a gate,
  // since backing into a satisfied one would instantly re-advance
  const flags = (step.data || {}) as { gated?: boolean; hideBack?: boolean };
  // tooltipProps carries role="alertdialog" + aria-modal, which require an accessible name;
  // without one screen readers announce an anonymous dialog
  return (
    <div id="tutorial-tooltip" aria-label="Tutorial" {...tooltipProps}>
      {step.title && (
        <Typography variant="h6" gutterBottom>
          {step.title}
        </Typography>
      )}
      {isString ? (
        <Typography variant="body1">{step.content}</Typography>
      ) : (
        step.content
      )}
      <div className="tutorialFooter">
        {/* Joyride's own showProgress only applies to its built-in tooltip */}
        <span className="tutorialProgress">
          Step {index + 1} of {size}
        </span>
        <Button {...closeProps} color="primary" size="small">
          Exit tutorial
        </Button>
        {index > 0 && !flags.hideBack && (
          <Button {...backProps} color="primary">
            Back
          </Button>
        )}
        {flags.gated ? (
          <span
            className="tutorialDoIt"
            aria-label="Do the highlighted action to continue"
          >
            <TouchAppIcon color="primary" />
          </span>
        ) : (
          <Button {...primaryProps} variant="contained" color="primary">
            {isLastStep ? "Play" : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

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

export default class Compositor extends React.Component<Props, {}> {
  private resizeTimeout: ReturnType<typeof setTimeout> | undefined;
  private stepsCache:
    | { source: TutorialStepType[]; desktop: boolean; resolved: Step[] }
    | undefined;

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

  // Applies each step's desktop override when the panes are side by side, and drops the key
  // either way so Joyride only ever sees a plain step. The result is cached because Joyride
  // reloads its steps whenever the array isn't identical, which loses the current step -- but
  // it still recomputes when handleResize carries the layout across the breakpoint
  private stepsForViewport(steps: TutorialStepType[]): Step[] {
    const desktop = isDesktopScreen();
    const cache = this.stepsCache;
    if (cache && cache.source === steps && cache.desktop === desktop) {
      return cache.resolved;
    }
    const resolved = steps.map((step, i) => {
      // The gate fields and onNext are engine concerns; Joyride only needs the
      // presentation, plus flags telling the tooltip which buttons make sense here
      const {
        desktop: override,
        advanceOn: _advanceOn,
        advanceOnAction: _advanceOnAction,
        onNext: _onNext,
        ...rest
      } = step;
      const merged = desktop && override ? { ...rest, ...override } : rest;
      return {
        ...merged,
        data: {
          gated: isGatedStep(step),
          hideBack: isGatedStep(step) || (i > 0 && isGatedStep(steps[i - 1])),
        },
      } as Step;
    });
    this.stepsCache = { source: steps, desktop, resolved };
    return resolved;
  }

  // isDesktopScreen() is read straight from the DOM rather than from state, so a resize needs
  // its own trigger -- forceUpdate skips shouldComponentUpdate, which otherwise blocks re-renders
  // when nothing about the current card has changed
  public handleResize = () => {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.forceUpdate(), 100);
  };

  public componentDidMount() {
    window.addEventListener("resize", this.handleResize);
  }

  public componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize);
    clearTimeout(this.resizeTimeout);
  }

  public handleJoyrideCallback = (data: EventData) => {
    const { action, index, type } = data;
    // Esc: leave the walkthrough without crediting it as done, so it's still offered on the
    // scenario list. Has to come first, since closing also reports STEP_AFTER
    if (action === ACTIONS.CLOSE) {
      this.props.onTutorialEnd(this.props.tutorialSteps);
      return;
    }
    // A gated step advances only by its deed. Skipping it on a missing target would wave
    // the player past the very thing the step exists to make them do - and the deed itself
    // often removes the target for a frame (buying closes the build screen), which Joyride
    // reports as TARGET_NOT_FOUND while the gate middleware is already landing the next step
    const current =
      this.props.tutorialStep >= 0 && this.props.tutorialSteps
        ? this.props.tutorialSteps[this.props.tutorialStep]
        : undefined;
    if (type === EVENTS.TARGET_NOT_FOUND && current && isGatedStep(current)) {
      return;
    }
    const advancingEvents: string[] = [
      EVENTS.STEP_AFTER,
      EVENTS.TARGET_NOT_FOUND,
    ];
    // Quitting tears the walkthrough's targets out of the DOM, and Joyride reports that as
    // TARGET_NOT_FOUND on the way out. Advancing on it navigated the just-reset game back onto
    // the step's card, which then rendered nothing because the game was over - a blank screen
    // where the main menu should be. tutorialStep is only >= 0 while a walkthrough is live
    if (advancingEvents.includes(type) && this.props.tutorialStep >= 0) {
      this.props.onTutorialStep({
        fromStep: index,
        toStep: index + (action === ACTIONS.PREV ? -1 : 1),
        tutorialSteps: this.props.tutorialSteps,
        scenarioId: this.props.scenarioId,
        currentCard: this.props.card.name,
      });
    }
  };

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.ui.snackbar.action) {
      this.props.ui.snackbar.action(e);
    }
  }

  private renderCard(): React.JSX.Element {
    const isPanes = isNavCard(this.props.card.name) && isPaneLayout();
    // Wide enough to show the fleet, P&L and forecast at once instead of tabbing between them.
    // Cash, the date, the speed controls and the year's progress are the game's state rather
    // than any one pane's, so they span all three columns instead of living in the first
    if (isPanes && isDesktopScreen()) {
      return (
        <div className="desktop-layout flexContainer">
          <GameAppBarContainer />
          <DesktopPanes>
            <FacilitiesContainer />
            <FinancesContainer />
            {this.props.card.name === "EVENTS" && !isUltrawideScreen() ? (
              <EventLogContainer />
            ) : (
              <ForecastsContainer />
            )}
            {/* An ultrawide window is otherwise three panes and a lot of nothing. Only here,
                because below this a fourth column comes out of the three that carry the game */}
            {isUltrawideScreen() ? <EventLogContainer /> : null}
          </DesktopPanes>
        </div>
      );
    }
    // Laptops and landscape tablets, which used to get a phone-width card floating in a sea of
    // margin. There isn't room for three columns here, but there is for two: the fleet, which
    // is the pane a player wants on screen while they read either of the others, pinned beside
    // whichever of them the nav is on
    if (isPanes) {
      return (
        <div className="pane-layout flexContainer">
          <GameAppBarContainer />
          <DesktopPanes>
            <FacilitiesContainer />
            {this.props.card.name === "FORECASTS" ? (
              <ForecastsContainer />
            ) : this.props.card.name === "EVENTS" ? (
              <EventLogContainer />
            ) : (
              <FinancesContainer />
            )}
          </DesktopPanes>
          {/* The panes supply no nav of their own in this layout, and it is still what
              switches the second column */}
          <NavigationContainer />
        </div>
      );
    }
    switch (this.props.card.name) {
      case "BUILD_GENERATORS":
        return <BuildGeneratorsContainer />;
      case "BUILD_STORAGE":
        return <BuildStorageContainer />;
      case "FINANCES":
        return <FinancesContainer />;
      case "FORECASTS":
        return <ForecastsContainer />;
      case "EVENTS":
        return <EventLogContainer />;
      case "FACILITIES":
        return <FacilitiesContainer />;
      case "SETTINGS":
        return <SettingsContainer />;
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
      case "CUSTOM_GAME":
        return <CustomGameContainer />;
      default:
        throw new Error("Unknown card " + this.props.card.name);
    }
  }

  public shouldComponentUpdate(nextProps: Props) {
    // Update if changing tutorial step
    if (this.props.tutorialStep !== nextProps.tutorialStep) {
      return true;
    }

    // Update if dialog / snackbar changes
    if (
      this.props.ui.dialog.open !== nextProps.ui.dialog.open ||
      this.props.ui.snackbar.open !== nextProps.ui.snackbar.open
    ) {
      return true;
    }

    // Don't update the main UI if we're on the same card
    if (this.props.card.name === nextProps.card.name) {
      return false;
    }

    return true;
  }

  public render() {
    const { tutorialStep, ui, closeDialog, tutorialSteps, closeSnackbar } =
      this.props;

    // The pane layouts don't slide between their own cards: on desktop nothing about the screen
    // changes, and on two columns only the second one does -- sliding the pinned fleet off the
    // side with it would be a lie about what just happened
    const transitionKey = !isNavCard(this.props.card.name)
      ? this.props.card.name
      : isDesktopScreen()
        ? DESKTOP_PANES_KEY
        : isPaneLayout()
          ? TABLET_PANES_KEY
          : this.props.card.name;
    const transitionNodeRef = this.nodeRefFor(transitionKey);

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div className="app_container">
        <GlobalHotKeys keyMap={keyMap} handlers={shortcutHandlers} />
        <TransitionGroup
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
            classNames={""}
            timeout={{
              enter: CARD_TRANSITION_ANIMATION_MS,
              exit: CARD_TRANSITION_ANIMATION_MS,
            }}
          >
            <main className="base_main" ref={transitionNodeRef}>
              {this.renderCard()}
            </main>
          </CSSTransition>
        </TransitionGroup>
        {tutorialSteps && (
          <Joyride
            // Swapping in the desktop targets hands Joyride a different steps array, which it
            // reloads mid-tour and ends up showing no tooltip behind a blocking overlay.
            // Remounting instead resumes cleanly, since it starts from the stepIndex prop
            key={isDesktopScreen() ? "desktop" : "compact"}
            onEvent={this.handleJoyrideCallback}
            continuous={true}
            run={tutorialStep >= 0 && tutorialStep < tutorialSteps.length}
            tooltipComponent={Tooltip}
            stepIndex={tutorialStep}
            steps={this.stepsForViewport(tutorialSteps)}
            // v3 folded the old top-level styles.options, and the standalone
            // disableOverlayClose prop, into this single options prop
            options={{
              beaconSize: 48,
              // Enough separation to make the highlighted control unmistakable while keeping
              // the surrounding dashboard legible as context for what the prompt is teaching.
              overlayColor: "rgba(0, 0, 0, 0.38)",
              // Joyride traps Tab inside the tooltip, so Esc is the way back out for
              // keyboard users -- WCAG 2.1.2. Overlay clicks still don't close, since
              // those are far too easy to trigger by accident mid-walkthrough
              overlayClickAction: false,
              // v3 scrolls each target into view and waits for a scroll:end that never
              // arrives for targets inside the non-scrolling card panes, which hangs the
              // tour on step 4 of the generators walkthrough. Every target is already in
              // view, so there is nothing to scroll to
              skipScroll: true,
            }}
          />
        )}
        <Dialog
          open={ui.dialog.open}
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
          <DialogTitle>{ui.dialog.title}</DialogTitle>
          <DialogContent>{ui.dialog.message}</DialogContent>
          <DialogActions>
            {ui.dialog.title.startsWith("🎉") && (
              <InstallAppButton label="Install for later" afterMilestone />
            )}
            {ui.dialog.secondaryAction && (
              <Button color="primary" onClick={ui.dialog.secondaryAction}>
                {ui.dialog.secondaryLabel || "Close"}
              </Button>
            )}
            {!ui.dialog.notCancellable && (
              <Button color="primary" onClick={closeDialog}>
                {ui.dialog.closeText || (ui.dialog.action ? "Cancel" : "OK")}
              </Button>
            )}
            {ui.dialog.action && (
              <Button
                color="primary"
                variant="contained"
                onClick={ui.dialog.action}
              >
                {ui.dialog.actionLabel || "OK"}
              </Button>
            )}
          </DialogActions>
        </Dialog>
        <Snackbar
          className="snackbar"
          // Bottom left is the MUI default, which on a wide screen leaves the toast hanging
          // off the side of the centered app frame
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          open={ui.snackbar.open}
          message={<span>{ui.snackbar.message}</span>}
          autoHideDuration={ui.snackbar.timeout}
          onClose={closeSnackbar}
          action={
            ui.snackbar.actionLabel
              ? [
                  <Button
                    key={1}
                    onClick={(e: React.MouseEvent<HTMLElement>) =>
                      this.snackbarActionClicked(e)
                    }
                  >
                    {ui.snackbar.actionLabel}
                  </Button>,
                ]
              : []
          }
        />
        {/* Connected, so they still update when shouldComponentUpdate blocks this component --
            neither is driven by the current card, and both can open over any of them */}
        <VictoryDialogContainer />
        <DisplayNameDialogContainer />
        <AudioContainer />
      </div>
    );
  }
}
