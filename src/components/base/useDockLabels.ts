import * as React from "react";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/**
 * Hover/focus labels, plus a touch-only hold-and-slide preview that never activates a tool.
 * `fromTouch` says the label came from that preview: a mouse or keyboard focus suggests a
 * physical keyboard is at hand, so only those labels are worth a keyboard shortcut.
 */
export default function useDockLabels() {
  const [labelId, setLabelId] = React.useState<string>();
  const [fromTouch, setFromTouch] = React.useState(false);
  const dockRef = React.useRef<HTMLElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>();
  const gesture = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
    preview: boolean;
  }>();
  const suppressClick = React.useRef(false);

  const clearTimer = () => clearTimeout(timer.current);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const labelAt = (x: number, y: number) => {
    const button = document
      .elementFromPoint(x, y)
      ?.closest<HTMLButtonElement>(".gameDockAction");
    setLabelId(
      button && dockRef.current?.contains(button) ? button.id : undefined,
    );
  };

  const endGesture = () => {
    clearTimer();
    gesture.current = undefined;
    setLabelId(undefined);
  };

  return {
    labelId,
    fromTouch,
    buttonLabels: {
      onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse") {
          setFromTouch(false);
          setLabelId(event.currentTarget.id);
        }
      },
      onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse") setLabelId(undefined);
      },
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
        if (event.currentTarget.matches(":focus-visible")) {
          setFromTouch(false);
          setLabelId(event.currentTarget.id);
        }
      },
      onBlur: () => setLabelId(undefined),
    },
    dockLabels: {
      ref: dockRef,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (!event.isPrimary) return;
        suppressClick.current = false;
        if (event.pointerType !== "touch") return;
        clearTimer();
        const { pointerId, clientX: x, clientY: y } = event;
        gesture.current = { pointerId, x, y, preview: false };
        setLabelId(undefined);
        timer.current = setTimeout(() => {
          const current = gesture.current;
          if (!current) return;
          current.preview = true;
          suppressClick.current = true;
          setFromTouch(true);
          dockRef.current?.setPointerCapture?.(pointerId);
          labelAt(x, y);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (current.preview) {
          event.preventDefault();
          labelAt(event.clientX, event.clientY);
        } else if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) >
          MOVE_TOLERANCE_PX
        ) {
          endGesture();
        }
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        if (gesture.current.preview) event.preventDefault();
        endGesture();
      },
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
        if (gesture.current?.pointerId === event.pointerId) endGesture();
      },
      onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => {
        // Taking capture from the touched button also bubbles its lost-capture event here.
        if (event.target === event.currentTarget) endGesture();
      },
      onPointerLeave: () => {
        if (!gesture.current?.preview) endGesture();
      },
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
        // Keyboard and assistive-technology activation remain available after a preview.
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
      onContextMenu: (event: React.MouseEvent<HTMLElement>) =>
        event.preventDefault(),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape" && labelId) {
          setLabelId(undefined);
        }
      },
    },
  };
}
