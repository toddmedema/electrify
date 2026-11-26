import * as React from "react";
import { Collapse, useMediaQuery } from "@mui/material";

type Props = Pick<
  React.ComponentProps<typeof Collapse>,
  "children" | "id" | "in" | "onExited" | "sx" | "orientation"
> & {
  /** Pass false for filtering or other changes that are not explicit removals. */
  animate?: boolean;
  component?: "div" | "li";
  className?: string;
};

/** A keyed child of TransitionGroup that lets the surrounding layout close up. */
export default function RemovalCollapse({
  animate = true,
  children,
  className,
  component,
  id,
  in: present,
  onExited,
  orientation,
  sx,
}: Props) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ref = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", present === false);
  }, [present]);
  return (
    <Collapse
      ref={ref}
      id={id}
      className={className}
      component={component}
      orientation={orientation}
      in={present}
      exit={animate && !reduceMotion}
      timeout={{ enter: 0, exit: 200 }}
      aria-hidden={present === false || undefined}
      onExited={onExited}
      sx={sx}
    >
      {children}
    </Collapse>
  );
}
