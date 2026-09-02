import { Button, Typography } from "@mui/material";
import * as React from "react";
import { TutorialStepType, isGatedStep } from "../../Types";

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

/**
 * A non-modal tutorial objective that leaves the game visible and interactive.
 *
 * Target treatment is presentation-only and cleaned up whenever the step changes.
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
  const [hintVisible, setHintVisible] = React.useState(false);
  const { content, target } = resolveStep(step, desktop);
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
    const reminder = window.setTimeout(
      () =>
        targets.forEach((element) =>
          element.classList.add("tutorialTargetReminder"),
        ),
      10_000,
    );
    return () => {
      window.clearTimeout(reminder);
      targets.forEach((element) => {
        element.classList.remove("tutorialTarget");
        element.classList.remove("tutorialTargetReminder");
      });
    };
  }, [step, target]);

  return (
    <section
      className={`tutorialHud${step.capstone ? " tutorialHud-capstone" : ""}`}
      aria-labelledby="tutorial-objective-title"
    >
      <div className="tutorialHudHeader">
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
      </div>

      <div className="tutorialHudContent" aria-live="polite">
        {content}
      </div>

      {hintVisible && step.hint && (
        <div className="tutorialHudHint" role="note">
          <strong>Hint:</strong> {step.hint}
        </div>
      )}

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
        {!isGatedStep(step) && (
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
    </section>
  );
}
