import * as React from "react";
import { Collapse, useMediaQuery } from "@mui/material";

type Props = Pick<
  React.ComponentProps<typeof Collapse>,
  "children" | "id" | "in" | "onExited" | "sx"
> & {
  /** Pass false for filtering or other changes that are not explicit removals. */
  animate?: boolean;
};

/** A keyed child of TransitionGroup that lets the surrounding layout close up. */
export default function RemovalCollapse({
  animate = true,
  children,
  id,
  in: present,
  onExited,
  sx,
}: Props) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    ref.current?.toggleAttribute("inert", present === false);
  }, [present]);
  return (
    <Collapse
      ref={ref}
      id={id}
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
