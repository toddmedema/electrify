import * as React from "react";
import { useMediaQuery } from "@mui/material";
import { CSSTransition } from "react-transition-group";
import { SIDE_TOOL_MIN_WIDTH } from "../../WorkspaceLayout";
import { useGameWorkspaceLayout } from "./GameWorkspaceContext";

const SLIDE_MS = 180;

/** Let a closed map panel finish moving while immediately removing its controls from input. */
export default function MapPanelSlide({
  in: present,
  onExited,
  children,
}: {
  in?: boolean;
  onExited?: () => void;
  children: React.ReactNode;
}) {
  const layout = useGameWorkspaceLayout();
  const compact = useMediaQuery("(max-width: 699px), (pointer: coarse)");
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const slide =
    compact &&
    !reduceMotion &&
    !!layout &&
    layout.effectiveWidth < SIDE_TOOL_MIN_WIDTH;
  const node = React.useRef<HTMLDivElement>(null);
  const wasPresent = React.useRef(present);
  React.useLayoutEffect(() => {
    const wrapper = node.current;
    wrapper?.toggleAttribute("inert", present === false);
    // Reopening during the slide reuses the mounted panel and its heading.
    if (present && wasPresent.current === false)
      wrapper
        ?.querySelector<HTMLElement>(".gameToolTitle")
        ?.focus({ preventScroll: true });
    wasPresent.current = present;
  }, [present]);
  return (
    <CSSTransition
      nodeRef={node}
      in={present}
      onExited={onExited}
      classNames="mapPanelSlide"
      timeout={SLIDE_MS}
      enter={slide}
      exit={slide}
      mountOnEnter
      unmountOnExit
    >
      <div
        ref={node}
        className="mapPanelSlide"
        aria-hidden={present === false || undefined}
        data-leaving={present === false || undefined}
      >
        {children}
      </div>
    </CSSTransition>
  );
}
