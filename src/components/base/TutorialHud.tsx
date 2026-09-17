import TouchAppOutlinedIcon from "@mui/icons-material/TouchAppOutlined";
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
    action: override?.action || step.action,
    content: override?.content || step.content,
    target: override?.target || step.target,
  };
}

// The gap between the control and the ring's line when there is room for it on every side.
const RING_GAP_PX = 3;

type Bounds = { left: number; top: number; right: number; bottom: number };

/**
 * Two rectangles around the control. `visible` is the viewport narrowed by every ancestor whose
 * overflow clips and by any sticky bar lying across the control: whatever the control has
 * outside it is out of sight. `room` is how far a ring may reach past the control before it
 * lands on something it would misrepresent: off the screen, across a sticky bar, or sideways
 * out of a pane into the one beside it. Above and below a pane sits the game's own chrome, so a
 * clipping ancestor narrows `room` only at its sides -- a control flush with the top of its pane,
 * like the Build button filling the pane header, still gets its gap there.
 */
function targetBounds(element: Element): { visible: Bounds; room: Bounds } {
  const viewport = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  const visible = { ...viewport };
  const room = { ...viewport };
  const target = element.getBoundingClientRect();
  for (
    let ancestor = element.parentElement;
    ancestor && visible.left < visible.right && visible.top < visible.bottom;
    ancestor = ancestor.parentElement
  ) {
    const style = window.getComputedStyle(ancestor);
    // Browsers always resolve these; an empty value (jsdom) means "no clipping".
    const overflows = [style.overflowX, style.overflowY];
    if (overflows.every((overflow) => !overflow || overflow === "visible")) {
      continue;
    }
    const box = ancestor.getBoundingClientRect();
    visible.left = Math.max(visible.left, box.left);
    visible.top = Math.max(visible.top, box.top);
    visible.right = Math.min(visible.right, box.right);
    visible.bottom = Math.min(visible.bottom, box.bottom);
    room.left = Math.max(room.left, box.left);
    room.right = Math.min(room.right, box.right);
    // A bar stuck to the edge of this scroller (the nav footer in short phone windows) covers
    // the content scrolling beneath it, so the ring must not draw across it either. Only a bar
    // lying across the control counts, so one resting elsewhere in the flow does not clip.
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
        visible.bottom = Math.max(
          visible.top,
          Math.min(visible.bottom, bar.top),
        );
        room.bottom = Math.min(room.bottom, bar.top);
      } else if (childStyle.top !== "auto" && childStyle.top !== "") {
        visible.top = Math.min(
          visible.bottom,
          Math.max(visible.top, bar.bottom),
        );
        room.top = Math.max(room.top, bar.bottom);
      }
    }
  }
  return { visible, room };
}

type RingBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: string;
};

// Sub-pixel slack for comparing edges that layout rounds differently.
const EDGE_EPSILON = 0.5;

/**
 * Measures where the ring around a group of controls goes, or null when nothing of them is
 * visible. The ring keeps one gap on every side -- as wide as the tightest side allows -- so it
 * never sits outside the control on some sides and on top of it on others. A control flush
 * with the screen or its scroller has no room outside, so its ring frames it from just inside
 * its edge instead. Where the control runs out of sight (scrolled under a pane's edge), that
 * side of the ring follows the visible edge. Only reads layout, so every ring can be measured
 * before any is moved.
 */
function measureTargetRing(elements: Element[], line: number): RingBox | null {
  const rect = elements
    .map((element): Bounds => element.getBoundingClientRect())
    .reduce((union, next) => ({
      left: Math.min(union.left, next.left),
      top: Math.min(union.top, next.top),
      right: Math.max(union.right, next.right),
      bottom: Math.max(union.bottom, next.bottom),
    }));
  if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) {
    return null;
  }
  const { visible, room } = targetBounds(elements[0]);
  const edges = {
    left: Math.max(rect.left, visible.left),
    top: Math.max(rect.top, visible.top),
    right: Math.min(rect.right, visible.right),
    bottom: Math.min(rect.bottom, visible.bottom),
  };
  if (edges.right - edges.left < line || edges.bottom - edges.top < line) {
    return null;
  }
  const cut = {
    left: edges.left > rect.left + EDGE_EPSILON,
    top: edges.top > rect.top + EDGE_EPSILON,
    right: edges.right < rect.right - EDGE_EPSILON,
    bottom: edges.bottom < rect.bottom - EDGE_EPSILON,
  };
  const space = [
    !cut.left && rect.left - room.left,
    !cut.top && rect.top - room.top,
    !cut.right && room.right - rect.right,
    !cut.bottom && room.bottom - rect.bottom,
  ].filter((value): value is number => value !== false);
  // Less room than the line plus a sliver of gap would put the line across the control's edge,
  // which reads as a mistake; frame it from inside instead.
  const available = Math.min(RING_GAP_PX + line, ...space);
  const outset = available >= line + 1 ? available : 0;
  const left = cut.left ? edges.left : rect.left - outset;
  const top = cut.top ? edges.top : rect.top - outset;
  const right = cut.right ? edges.right : rect.right + outset;
  const bottom = cut.bottom ? edges.bottom : rect.bottom + outset;
  // Follow the control's own corners so a rounded button does not get a square frame. A ring
  // outside the control needs the gap added to its radius to stay concentric.
  const radius = window.getComputedStyle(elements[0]).borderTopLeftRadius;
  const radiusPx = parseFloat(radius);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    borderRadius:
      radius.endsWith("px") && radiusPx > 0 ? `${radiusPx + outset}px` : radius,
  };
}

/**
 * Groups targets whose boxes touch edge to edge, like consecutive facility rows, so they share
 * one ring. Separate rings would stack two lines, and their gaps, across the seam between them.
 */
function groupTouchingTargets(elements: Element[]): Element[][] {
  const groups: { elements: Element[]; box: Bounds }[] = [];
  elements.forEach((element) => {
    const rect = element.getBoundingClientRect();
    const touching = groups.find(
      ({ box }) =>
        (Math.abs(box.left - rect.left) <= EDGE_EPSILON &&
          Math.abs(box.right - rect.right) <= EDGE_EPSILON &&
          rect.top <= box.bottom + EDGE_EPSILON &&
          rect.bottom >= box.top - EDGE_EPSILON) ||
        (Math.abs(box.top - rect.top) <= EDGE_EPSILON &&
          Math.abs(box.bottom - rect.bottom) <= EDGE_EPSILON &&
          rect.left <= box.right + EDGE_EPSILON &&
          rect.right >= box.left - EDGE_EPSILON),
    );
    if (touching && rect.width > 0 && rect.height > 0) {
      touching.elements.push(element);
      touching.box = {
        left: Math.min(touching.box.left, rect.left),
        top: Math.min(touching.box.top, rect.top),
        right: Math.max(touching.box.right, rect.right),
        bottom: Math.max(touching.box.bottom, rect.bottom),
      };
    } else {
      groups.push({
        elements: [element],
        box: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    }
  });
  return groups.map((group) => group.elements);
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
  const { action, content, target } = resolveStep(step, desktop);
  // Next is the step's main button only when it's the only way forward. A step that also
  // advances on an in-game deed keeps it as a quiet fallback, so the ringed control is the one
  // thing on screen asking to be tapped
  const nextIsPrimary = !step.continueOn && !step.continueOnClick;
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
        } else {
          // One pulse the moment the step starts draws the eye to where the action is
          ring.classList.add("tutorialTargetRingIntro");
        }
        document.body.appendChild(ring);
        rings.set(element, ring);
      });
      // Measure every ring before moving any, so one ring's write does not force a fresh
      // layout for the next one's read. Touching targets share the first one's ring.
      const first = rings.values().next();
      if (first.done) {
        return;
      }
      const line =
        parseFloat(window.getComputedStyle(first.value).borderTopWidth) || 2;
      const boxes = groupTouchingTargets(Array.from(rings.keys())).flatMap(
        (group) =>
          group.map((element, index) => ({
            ring: rings.get(element)!,
            box: index === 0 ? measureTargetRing(group, line) : null,
          })),
      );
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
        ring.classList.remove("tutorialTargetRingIntro");
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
        {/* Keyed inside the live region so the region itself persists and keeps announcing */}
        <div key={stepIndex} className="tutorialHudStep">
          <p className="tutorialHudAction">
            <TouchAppOutlinedIcon fontSize="small" aria-hidden />
            <span>{action}</span>
          </p>
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
          <Button color="primary" size="small" onClick={onBack}>
            Back
          </Button>
        )}
        {!isGatedStep(step) && (
          <Button
            color="primary"
            size="small"
            variant={nextIsPrimary ? "contained" : "text"}
            onClick={onNext}
          >
            Next
          </Button>
        )}
      </div>
    </section>
  );
}
