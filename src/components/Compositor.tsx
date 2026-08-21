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
import Joyride, { ACTIONS, EVENTS, Step } from "react-joyride";
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

interface TooltipProps {
  continuous: any;
  index: any;
  size: number; // total number of steps in this walkthrough
  step: any;
  backProps: any;
  closeProps: any;
  primaryProps: any;
  tooltipProps: any;
  isLastStep: boolean;
}

function Tooltip(props: TooltipProps): JSX.Element {
  const { index, size, step, backProps, primaryProps, tooltipProps, isLastStep } =
    props;
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

export interface DispatchProps {
  closeDialog: () => void;
  closeSnackbar: () => void;
  onTutorialStep: (
    newStep: number,
    tutorialSteps: TutorialStepType[] | undefined,
    scenarioId: number
  ) => void;
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

  public handleJoyrideCallback = (data: any) => {
    const { action, index, type } = data;
    // Esc: leave the walkthrough without crediting it as done, so it's still offered on the
    // scenario list. Has to come first, since closing also reports STEP_AFTER
    if (action === ACTIONS.CLOSE) {
      this.props.onTutorialEnd(this.props.tutorialSteps);
      return;
    }
    if ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND].includes(type)) {
      this.props.onTutorialStep(
        index + (action === ACTIONS.PREV ? -1 : 1),
        this.props.tutorialSteps,
        this.props.scenarioId
      );
    }
  };

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.ui.snackbar.action) {
      this.props.ui.snackbar.action(e);
    }
  }

  private renderCard(): JSX.Element {
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

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div className="app_container">
        <GlobalHotKeys keyMap={keyMap} handlers={shortcutHandlers} />
        <TransitionGroup
          childFactory={(child) =>
            React.cloneElement(child, { classNames: this.props.transition })
          }
        >
          <CSSTransition
            key={
              isDesktopScreen() && isNavCard(this.props.card.name)
                ? DESKTOP_PANES_KEY
                : this.props.card.name
            }
            classNames={""}
            timeout={{
              enter: CARD_TRANSITION_ANIMATION_MS,
              exit: CARD_TRANSITION_ANIMATION_MS,
            }}
          >
            <div className="base_main">{this.renderCard()}</div>
          </CSSTransition>
        </TransitionGroup>
        {tutorialSteps && (
          <Joyride
            // Swapping in the desktop targets hands Joyride a different steps array, which it
            // reloads mid-tour and ends up showing no tooltip behind a blocking overlay.
            // Remounting instead resumes cleanly, since it starts from the stepIndex prop
            key={isDesktopScreen() ? "desktop" : "compact"}
            callback={this.handleJoyrideCallback}
            continuous={true}
            // Joyride traps Tab inside the tooltip, so Esc is the way back out for keyboard
            // users -- WCAG 2.1.2. Overlay clicks still don't close, since those are far too
            // easy to trigger by accident mid-walkthrough
            disableOverlayClose={true}
            run={tutorialStep >= 0 && tutorialStep < tutorialSteps.length}
            tooltipComponent={Tooltip}
            stepIndex={tutorialStep}
            steps={this.stepsForViewport(tutorialSteps)}
            styles={{
              options: {
                beaconSize: 48,
                overlayColor: "rgba(0, 0, 0, 0.1)",
              },
            }}
          />
        )}
        <Dialog
          open={ui.dialog.open}
          onClose={closeDialog}
          disableEscapeKeyDown={ui.dialog.notCancellable}
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
