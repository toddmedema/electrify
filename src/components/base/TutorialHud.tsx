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

// The ring's line sits this far outside the control when there is room; where a clipping edge
// leaves less, positionTargetRing slides it onto the control instead of losing the side.
const RING_GAP_PX = 3;

/**
 * The smallest rectangle the control can be drawn in: the viewport, narrowed by every ancestor
 * whose overflow clips. A highlight that draws outside this rectangle is cut away, which is how
 * an outline on a full-bleed chart lost its left and right sides.
 */
function targetClipBounds(element: Element): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (
    let ancestor = element.parentElement;
    ancestor && left < right && top < bottom;
    ancestor = ancestor.parentElement
  ) {
    const style = window.getComputedStyle(ancestor);
    // Browsers always resolve these; an empty value (jsdom) means "no clipping".
    if (
      (!style.overflowX || style.overflowX === "visible") &&
      (!style.overflowY || style.overflowY === "visible")
    ) {
      continue;
    }
    const box = ancestor.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  return { left, top, right, bottom };
}

/**
 * Places the ring around `element` so all four sides stay visible. Each side prefers a small
 * gap outside the control; where the clipping bounds leave less room than that, the side hugs
 * the control's edge (or the clipping boundary) instead of being cut away.
 */
function positionTargetRing(ring: HTMLElement, element: Element) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    ring.style.display = "none";
    return;
  }
  const line = parseFloat(window.getComputedStyle(ring).borderTopWidth) || 2;
  const clip = targetClipBounds(element);
  const left = Math.max(clip.left, rect.left - RING_GAP_PX - line);
  const top = Math.max(clip.top, rect.top - RING_GAP_PX - line);
  const right = Math.min(clip.right, rect.right + RING_GAP_PX + line);
  const bottom = Math.min(clip.bottom, rect.bottom + RING_GAP_PX + line);
  if (right - left < line || bottom - top < line) {
    ring.style.display = "none";
    return;
  }
  ring.style.display = "";
  ring.style.left = `${Math.round(left)}px`;
  ring.style.top = `${Math.round(top)}px`;
  ring.style.width = `${Math.round(right - left)}px`;
  ring.style.height = `${Math.round(bottom - top)}px`;
  // Follow the control's own corners so a rounded button does not get a square frame.
  ring.style.borderRadius =
    window.getComputedStyle(element).borderTopLeftRadius;
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
    if (!step.continueOnClick || isGatedStep(step)) {
      return;
    }
    let active = true;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const control = target.closest(step.continueOnClick!);
      if (!control || control.matches(":disabled, [aria-disabled='true']")) {
        return;
      }
      // Capture the current step before React handles the control. Cancel if its normal
      // action already advanced the tutorial or unmounted this objective.
      queueMicrotask(() => {
        if (active && !event.defaultPrevented) {
          active = false;
          onNext();
        }
      });
    };
    document.addEventListener("click", onClick, true);
    return () => {
      active = false;
      document.removeEventListener("click", onClick, true);
    };
  }, [step, onNext]);

  React.useEffect(() => {
    if (!target || step.capstone) {
      return;
    }
    let targets: Element[] = [];
    try {
      targets = Array.from(document.querySelectorAll(target));
    } catch {
      // An invalid or temporarily absent selector must not take down the game or objective HUD.
      return;
    }
    targets.forEach((element) => element.classList.add("tutorialTarget"));

    // The visible cue is a ring overlay, one per target. It lives on <body> rather than
    // outlining the control itself: an outline draws outside the element's box, so any
    // clipping ancestor -- a pane, a card, the viewport -- cut its sides wherever a control
    // ran edge to edge. The ring hugs the control instead, so every side stays visible.
    const rings = targets.map((element) => {
      const ring = document.createElement("div");
      ring.className = "tutorialTargetRing";
      ring.setAttribute("aria-hidden", "true");
      ring.setAttribute("data-testid", "tutorial-target-ring");
      document.body.appendChild(ring);
      return { element, ring };
    });

    // Position before the first paint so the ring is there on the step's opening frame, then
    // follow the control through scrolling, pane drags and resizes. A highlight does not need
    // 60fps; ~15 keeps the per-frame layout reads cheap while the game is running.
    const positionAll = () => {
      for (const { element, ring } of rings) {
        positionTargetRing(ring, element);
      }
    };
    let frame = 0;
    positionAll();
    if (typeof window.requestAnimationFrame === "function") {
      let last = 0;
      const tick = (now: number) => {
        if (now - last >= 66) {
          last = now;
          positionAll();
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }

    const reminder = window.setTimeout(() => {
      targets.forEach((element) =>
        element.classList.add("tutorialTargetReminder"),
      );
      rings.forEach(({ ring }) =>
        ring.classList.add("tutorialTargetRingPulse"),
      );
    }, 10_000);

    return () => {
      window.clearTimeout(reminder);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      targets.forEach((element) => {
        element.classList.remove("tutorialTarget");
        element.classList.remove("tutorialTargetReminder");
      });
      rings.forEach(({ ring }) => {
        ring.classList.remove("tutorialTargetRingPulse");
        ring.remove();
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
