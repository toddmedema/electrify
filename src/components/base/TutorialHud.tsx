import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FlagIcon from "@mui/icons-material/Flag";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import {
  Button,
  CircularProgress,
  IconButton,
  Typography,
} from "@mui/material";
import * as React from "react";
import { TutorialStepType, isGatedStep } from "../../Types";
import ConceptIcon from "./ConceptIcon";
import TutorialPrompt, { TutorialPromptProps } from "./TutorialPrompt";

export interface TutorialHudProps {
  desktop: boolean;
  onBack: () => void;
  onExit: () => void;
  onNext: () => void;
  step: TutorialStepType;
  stepIndex: number;
  totalSteps: number;
  canGoBack: boolean;
}

/** The viewport-specific content and target, without turning presentation into game state. */
function resolveStep(step: TutorialStepType, desktop: boolean) {
  const override = desktop ? step.desktop : undefined;
  return {
    content: override?.content || step.content,
    target: override?.target || step.target,
  };
}

function promptProps(
  content: React.ReactNode,
): TutorialPromptProps | undefined {
  return React.isValidElement<TutorialPromptProps>(content) &&
    content.type === TutorialPrompt
    ? content.props
    : undefined;
}

/**
 * A non-modal tutorial objective that leaves the game visible and interactive.
 *
 * Expansion is local UI state, so it survives card navigation without leaking into saves. The
 * target treatment is likewise presentation-only and cleaned up whenever the step changes.
 */
export default function TutorialHud({
  desktop,
  onBack,
  onExit,
  onNext,
  step,
  stepIndex,
  totalSteps,
  canGoBack,
}: TutorialHudProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(true);
  const [hintVisible, setHintVisible] = React.useState(false);
  const pointerOpened = React.useRef(false);
  const { content, target } = resolveStep(step, desktop);
  const prompt = promptProps(content);
  const primaryConcept = prompt?.concepts[0];
  const progress = ((stepIndex + 1) / totalSteps) * 100;
  const progressText = `Objective ${stepIndex + 1} of ${totalSteps}`;

  React.useEffect(() => setHintVisible(false), [stepIndex]);

  React.useEffect(() => {
    if (!target || step.capstone) {
      return;
    }
    let targets: Element[] = [];
    try {
      targets = Array.from(document.querySelectorAll(target));
      targets.forEach((element) => element.classList.add("tutorialTarget"));
    } catch {
      // An invalid or temporarily absent selector must not take down the game or objective HUD.
    }
    return () =>
      targets.forEach((element) => element.classList.remove("tutorialTarget"));
  }, [step, target]);

  const toggleExpanded = () => {
    // Pointer focus happens before click. Remember that it was the focus which opened the HUD so
    // the same tap does not immediately collapse it again after React commits the focus update.
    if (pointerOpened.current) {
      pointerOpened.current = false;
      setExpanded(true);
      return;
    }
    setExpanded((value) => !value);
  };

  return (
    <section
      className={`tutorialHud ${expanded ? "tutorialHud-expanded" : "tutorialHud-collapsed"}${step.capstone ? " tutorialHud-capstone" : ""}`}
      aria-labelledby="tutorial-objective-title"
    >
      <div className="tutorialHudHeader">
        {!expanded && (
          <div className="tutorialHudProgressRing" aria-hidden>
            <CircularProgress
              variant="determinate"
              value={progress}
              size={42}
              thickness={4}
            />
            <span className="tutorialHudProgressIcon">
              {primaryConcept ? (
                <ConceptIcon concept={primaryConcept} fontSize="small" />
              ) : (
                <FlagIcon fontSize="small" />
              )}
            </span>
          </div>
        )}
        <div className="tutorialHudHeading">
          <Typography
            id="tutorial-objective-title"
            component="h2"
            variant="subtitle2"
          >
            {step.capstone ? "Your turn" : "Mission objective"}
          </Typography>
          <Typography
            variant="caption"
            component="span"
            aria-label={progressText}
          >
            {stepIndex + 1} / {totalSteps}
          </Typography>
        </div>
        <IconButton
          className="tutorialHudToggle"
          size="small"
          aria-expanded={expanded}
          aria-controls="tutorial-objective-content"
          aria-label={expanded ? "Collapse objective" : "Expand objective"}
          onPointerDown={() => {
            pointerOpened.current = !expanded;
          }}
          onFocus={() => {
            if (!expanded) {
              setExpanded(true);
            }
          }}
          onClick={toggleExpanded}
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </div>

      <div
        id="tutorial-objective-content"
        className={expanded ? "tutorialHudContent" : "tutorialHudScreenReader"}
        aria-live="polite"
      >
        {content}
      </div>

      {expanded && hintVisible && step.hint && (
        <div className="tutorialHudHint" role="note">
          <strong>Hint:</strong> {step.hint}
        </div>
      )}

      {expanded && (
        <div className="tutorialHudFooter">
          <Button color="primary" size="small" onClick={onExit}>
            Exit
          </Button>
          {step.hint && (
            <Button
              color="primary"
              size="small"
              aria-expanded={hintVisible}
              onClick={() => setHintVisible((value) => !value)}
            >
              {hintVisible ? "Hide hint" : "Hint"}
            </Button>
          )}
          <span className="tutorialHudFooterSpacer" />
          {canGoBack && (
            <Button color="primary" size="small" onClick={onBack}>
              Back
            </Button>
          )}
          {isGatedStep(step) ? (
            <span className="tutorialHudGate" role="status">
              <TouchAppIcon fontSize="small" aria-hidden />
              Complete objective
            </span>
          ) : (
            <Button
              color="primary"
              size="small"
              variant="contained"
              onClick={onNext}
            >
              Next
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
