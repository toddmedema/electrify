import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Typography,
} from "@mui/material";
import * as React from "react";
import { GlobalHotKeys } from "react-hotkeys";
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
  TutorialStepType,
  UIType,
} from "../Types";
import AudioContainer from "./base/AudioContainer";
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
import { navigate } from "../reducers/Card";
import { setSpeed } from "../reducers/Game";
import { isDesktopScreen } from "../Globals";
import { store } from "../Store";

// All three of these cards are shown at once side by side above the desktop breakpoint (see
// isDesktopScreen / $desktop_breakpoint), so they share one stable transition key there --
// switching among them shouldn't slide/remount the pane group, since nothing visibly changes
const DESKTOP_PANES_KEY = "DESKTOP_PANES";

// Keep in sync with the Keyboard Shortcuts entry in the Manual and Settings
const keyMap = {
  PAUSED: ["`", "space", "0"],
  SLOW: "1",
  NORMAL: "2",
  FAST: "3",
  FACILITIES: "q",
  FINANCES: "w",
  FORECASTS: "e",
};

const shortcutHandlers = {
  PAUSED: () => {
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
};

function Tooltip(props: TooltipRenderProps): React.JSX.Element {
  const {
    index,
    size,
    step,
    backProps,
    primaryProps,
    tooltipProps,
    isLastStep,
  } = props;
  const isString = typeof step.content === "string";
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
        {index > 0 && (
          <Button {...backProps} color="primary">
            Back
          </Button>
        )}
        <Button {...primaryProps} variant="contained" color="primary">
          {isLastStep ? "Play" : "Next"}
        </Button>
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

// A walkthrough moving between two steps. Both ends are named because Back and Next need
// telling apart: a step's onNext only applies to leaving it forwards
export interface TutorialStepChangeType {
  fromStep: number;
  toStep: number;
  tutorialSteps: TutorialStepType[] | undefined;
  scenarioId: number;
  currentCard: CardNameType;
}

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
    const resolved = steps.map((step) => {
      const { desktop: override, ...rest } = step;
      return (desktop && override ? { ...rest, ...override } : rest) as Step;
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
    const advancingEvents: string[] = [
      EVENTS.STEP_AFTER,
      EVENTS.TARGET_NOT_FOUND,
    ];
    if (advancingEvents.includes(type)) {
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
    // Wide enough to show the fleet, P&L and forecast at once instead of tabbing between them
    if (isDesktopScreen() && isNavCard(this.props.card.name)) {
      return (
        <div className="desktop-panes">
          <FacilitiesContainer />
          <FinancesContainer />
          <ForecastsContainer />
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

    const transitionKey =
      isDesktopScreen() && isNavCard(this.props.card.name)
        ? DESKTOP_PANES_KEY
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
            <div className="base_main" ref={transitionNodeRef}>
              {this.renderCard()}
            </div>
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
              overlayColor: "rgba(0, 0, 0, 0.1)",
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
          // v9 replaced `disableEscapeKeyDown` with filtering on the close reason
          onClose={(_event, reason) => {
            if (ui.dialog.notCancellable && reason === "escapeKeyDown") {
              return;
            }
            closeDialog();
          }}
        >
          <DialogTitle>{ui.dialog.title}</DialogTitle>
          <DialogContent>{ui.dialog.message}</DialogContent>
          <DialogActions>
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
        <AudioContainer />
      </div>
    );
  }
}
