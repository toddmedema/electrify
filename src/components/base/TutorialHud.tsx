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
 * whose overflow clips and by any sticky bar covering it. A highlight that draws outside this
 * rectangle is cut away, which is how an outline on a full-bleed chart lost its left and right
 * sides.
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
  const target = element.getBoundingClientRect();
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
    // A bar stuck to the edge of this scroller (the nav footer in short phone windows) covers
    // the content scrolling beneath it. An outline was painted under the bar; the ring sits on
    // <body>, so without this it would draw across the bar and make it look highlighted.
    // Only a bar lying across the control counts, so one resting elsewhere in the flow does not
    // clip anything.
    for (const child of Array.from(ancestor.children)) {
      const childStyle = window.getComputedStyle(child);
      if (childStyle.position !== "sticky" || child.contains(element)) {
        continue;
      }
      const bar = child.getBoundingClientRect();
      if (bar.bottom <= target.top || bar.top >= target.bottom) {
        continue;
      }
      if (childStyle.bottom !== "auto" && childStyle.bottom !== "") {
        bottom = Math.max(top, Math.min(bottom, bar.top));
      } else if (childStyle.top !== "auto" && childStyle.top !== "") {
        top = Math.min(bottom, Math.max(top, bar.bottom));
      }
    }
  }
  return { left, top, right, bottom };
}

type RingBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: string;
};

/**
 * Measures where the ring around `element` goes so all four sides stay visible, or null when
 * the control has no visible box. Each side prefers a small gap outside the control; where the
 * clipping bounds leave less room than that, the side hugs the control's edge (or the clipping
 * boundary) instead of being cut away. Only reads layout, so every ring can be measured before
 * any is moved.
 */
function measureTargetRing(element: Element, line: number): RingBox | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const outset = RING_GAP_PX + line;
  const clip = targetClipBounds(element);
  const left = Math.max(clip.left, rect.left - outset);
  const top = Math.max(clip.top, rect.top - outset);
  const right = Math.min(clip.right, rect.right + outset);
  const bottom = Math.min(clip.bottom, rect.bottom + outset);
  if (right - left < line || bottom - top < line) {
    return null;
  }
  // Follow the control's own corners so a rounded button does not get a square frame. The ring
  // sits outside the control, so its corners need the gap added to stay concentric.
  const radius = window.getComputedStyle(element).borderTopLeftRadius;
  const radiusPx = parseFloat(radius);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
    borderRadius:
      radius.endsWith("px") && radiusPx > 0 ? `${radiusPx + outset}px` : radius,
  };
}

function applyTargetRing(ring: HTMLElement, box: RingBox | null) {
  if (!box) {
    ring.style.display = "none";
    return;
  }
  ring.style.display = "";
  ring.style.left = `${box.left}px`;
  ring.style.top = `${box.top}px`;
  ring.style.width = `${box.width}px`;
  ring.style.height = `${box.height}px`;
  ring.style.borderRadius = box.borderRadius;
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
  const progressText = `${stepIndex + 1} of ${totalSteps}`;

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
    try {
      document.querySelector(target);
    } catch {
      // An invalid selector must not take down the game or objective HUD.
      return;
    }

    // The visible cue is a ring overlay, one per target. It lives on <body> rather than
    // outlining the control itself: an outline draws outside the element's box, so any
    // clipping ancestor -- a pane, a card, the viewport -- cut its sides wherever a control
    // ran edge to edge. The ring hugs the control instead, so every side stays visible.
    const rings = new Map<Element, HTMLElement>();
    let reminding = false;
    const release = (element: Element, ring: HTMLElement) => {
      element.classList.remove("tutorialTarget", "tutorialTargetReminder");
      ring.remove();
      rings.delete(element);
    };

    // Targets are looked up again on every pass, not just when the step starts: a control can
    // mount after the step begins (a list that is still loading) or be replaced by a new node
    // (the layout switching between phone and panes), and the cue must follow it there.
    const sync = () => {
      const current = new Set(document.querySelectorAll(target));
      rings.forEach((ring, element) => {
        if (!current.has(element)) {
          release(element, ring);
        }
      });
      current.forEach((element) => {
        if (rings.has(element)) {
          return;
        }
        element.classList.add("tutorialTarget");
        const ring = document.createElement("div");
        ring.className = "tutorialTargetRing";
        ring.setAttribute("aria-hidden", "true");
        ring.setAttribute("data-testid", "tutorial-target-ring");
        if (reminding) {
          element.classList.add("tutorialTargetReminder");
          ring.classList.add("tutorialTargetRingPulse");
        }
        document.body.appendChild(ring);
        rings.set(element, ring);
      });
      // Measure every ring before moving any, so one ring's write does not force a fresh
      // layout for the next one's read.
      const first = rings.values().next();
      if (first.done) {
        return;
      }
      const line =
        parseFloat(window.getComputedStyle(first.value).borderTopWidth) || 2;
      const boxes = Array.from(rings, ([element, ring]) => ({
        ring,
        box: measureTargetRing(element, line),
      }));
      boxes.forEach(({ ring, box }) => applyTargetRing(ring, box));
    };

    // Position in the same task that applies the step, then follow the control through
    // scrolling, pane drags and resizes. A highlight does not need 60fps; ~15 keeps the
    // per-frame layout reads cheap while the game is running.
    let frame = 0;
    sync();
    if (typeof window.requestAnimationFrame === "function") {
      let last = 0;
      const tick = (now: number) => {
        if (now - last >= 66) {
          last = now;
          sync();
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }

    const reminder = window.setTimeout(() => {
      reminding = true;
      rings.forEach((ring, element) => {
        element.classList.add("tutorialTargetReminder");
        ring.classList.add("tutorialTargetRingPulse");
      });
    }, 10_000);

    return () => {
      window.clearTimeout(reminder);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      rings.forEach((ring, element) => release(element, ring));
    };
  }, [step, target]);

  return (
    <section
      className={`tutorialHud${step.capstone ? " tutorialHud-capstone" : ""}`}
      aria-labelledby="tutorial-step-title"
    >
      <div className="tutorialHudHeader">
        <Typography id="tutorial-step-title" component="h2" variant="subtitle2">
          <span className="tutorialHudStepLabel">
            {step.capstone ? "Your turn" : "Step"}
          </span>{" "}
          {/* aria-label is ignored on a plain span, so the spoken form is real hidden text */}
          <span className="tutorialHudStepCount">
            <span aria-hidden="true">
              {stepIndex + 1}/{totalSteps}
            </span>
            <span className="tutorialHudVisuallyHidden">{progressText}</span>
          </span>
        </Typography>
      </div>

      <div className="tutorialHudContent" aria-live="polite">
        {/* Keyed inside the live region so the region itself persists and keeps announcing */}
        <div key={stepIndex} className="tutorialHudStep">
          {content}
        </div>
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
          <Button
            className="tutorialHudNav"
            color="primary"
            size="small"
            onClick={onBack}
          >
            Back
          </Button>
        )}
        {!isGatedStep(step) && (
          <Button
            className="tutorialHudNav"
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
