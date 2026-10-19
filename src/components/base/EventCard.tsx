import * as React from "react";
import { Typography } from "@mui/material";

interface Props extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "title" | "onClick"
> {
  /** `li` inside an event list; `div` where the card stands alone. */
  component?: "li" | "div";
  /** Sits in its own gutter, so wrapped text never runs under it. */
  icon: React.ReactNode;
  heading?: React.ReactNode;
  /** The secondary line under the body: when it happened, or the goal's state. */
  meta?: React.ReactNode;
  /** Makes the whole card one button. */
  onActivate?: () => void;
  /** A native tooltip, kept separate from the visible heading. */
  tooltip?: string;
  children?: React.ReactNode;
}

/**
 * The card every event-style row shares: the Events history, ongoing and upcoming events, and the
 * Operations pane's pinned goals and next event. Styles live under `.eventLogItem` in app.scss.
 */
export default function EventCard({
  component: Component = "li",
  icon,
  heading,
  meta,
  onActivate,
  tooltip,
  className,
  children,
  ...rest
}: Props): React.JSX.Element {
  return (
    <Component
      {...rest}
      className={`eventLogItem${onActivate ? " actionable" : ""}${className ? ` ${className}` : ""}`}
      title={tooltip}
      onClick={onActivate}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        rest.onKeyDown?.(e);
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
    >
      <span className="eventLogIcon">{icon}</span>
      <span>
        {heading && <strong>{heading}</strong>}
        <span className="eventLogCopy">
          <Typography
            variant="body2"
            component="span"
            sx={{ display: "block" }}
          >
            {children}
          </Typography>
        </span>
      </span>
      {meta && (
        <Typography
          className="eventLogWhen"
          variant="body2"
          color="textSecondary"
          component="span"
        >
          {meta}
        </Typography>
      )}
    </Component>
  );
}
