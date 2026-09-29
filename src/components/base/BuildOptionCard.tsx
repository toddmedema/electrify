import * as React from "react";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardHeader,
  Collapse,
  Stack,
  Typography,
} from "@mui/material";
import { ChevronDownGlyph, ChevronUpGlyph } from "./Glyphs";
import ConceptIcon from "./ConceptIcon";

export interface BuildOptionCardProps {
  name: string;
  iconSrc: string;
  /** The avatar's alt text; the name by default */
  iconAlt?: string;
  className?: string;
  compared?: boolean;
  /** Attributes for the card root, such as data-testid */
  cardProps?: Record<`data-${string}`, string>;
  /** Heading semantics for the title (interties are navigable by heading) */
  titleComponent?: "h6";
  /** Omitted to leave the card without a Review button (replay playback) */
  review?: {
    ariaLabel: string;
    disabled: boolean;
    id?: string;
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
  };
  /** Beside Review, such as Compare on a wide layout */
  headerActions?: React.ReactNode;
  /** Under Review: Use max size or Use site maximum. Moves the context line into the header. */
  sizeAction?: React.ReactNode;
  /** The short role line under the name */
  context?: React.ReactNode;
  /** Anything between the context line and the warning, such as hydro site availability */
  summary?: React.ReactNode;
  /** Why the option cannot be bought now */
  warning?: React.ReactNode;
  /** BuildMetric children. Without metrics the card is a quiet one-line entry. */
  metrics?: React.ReactNode;
  /**
   * The disclosure's content; the footer toggle only appears when there is some. A function is
   * told whether the disclosure is open, so costly content can wait for it.
   */
  details?: React.ReactNode | ((expanded: boolean) => React.ReactNode);
  /** Beside the details toggle, such as Compare on a narrow layout */
  footerActions?: React.ReactNode;
  /** The review dialog */
  children?: React.ReactNode;
}

/**
 * The shared shell of a build catalog card: heading and Review, an optional resize shortcut, a
 * context line, the reason it can't be bought when it can't, a metric grid, then everything that
 * helps compare options behind the same disclosure.
 */
export default function BuildOptionCard(
  props: BuildOptionCardProps,
): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const { name, sizeAction, context, metrics, details } = props;
  const reviewButton = props.review && (
    <Button
      id={props.review.id}
      className="buy-button"
      size="small"
      variant="outlined"
      color="primary"
      onClick={props.review.onClick}
      disabled={props.review.disabled}
      startIcon={<ConceptIcon concept="buy" fontSize="small" />}
      aria-label={props.review.ariaLabel}
    >
      Review
    </Button>
  );
  const action =
    reviewButton || props.headerActions || sizeAction ? (
      <Box className="buildPurchaseActions">
        <Stack direction="row" spacing={0.5}>
          {props.headerActions}
          {reviewButton}
        </Stack>
        {sizeAction}
      </Box>
    ) : undefined;
  // Without metrics, or with a resize shortcut under Review, the context line moves up beside it
  const contextInHeader = metrics === undefined || !!sizeAction;
  const warningInHeader = !!sizeAction && !!props.warning;

  return (
    <Card
      className={[
        "build-list-item buildOption",
        props.className,
        props.compared ? "compared" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props.cardProps}
    >
      <CardHeader
        className={sizeAction ? "stackedActionsHeader" : undefined}
        avatar={<Avatar alt={props.iconAlt ?? name} src={props.iconSrc} />}
        action={action}
        slotProps={{
          ...(props.titleComponent && {
            title: { component: props.titleComponent },
          }),
          ...(warningInHeader && { subheader: { component: "div" } }),
        }}
        title={name}
        subheader={
          warningInHeader
            ? props.warning
            : contextInHeader
              ? context
              : undefined
        }
      />
      {metrics !== undefined && (
        <>
          {!contextInHeader && context && (
            <Typography className="buildOptionContext" variant="body2">
              {context}
            </Typography>
          )}
          {props.summary}
          {props.warning && !warningInHeader && (
            <Typography
              component="div"
              className="buildOptionWarning"
              color="textSecondary"
            >
              {props.warning}
            </Typography>
          )}
          <Box className="buildOptionMetrics">{metrics}</Box>
          {(details || props.footerActions) && (
            <Box className="buildOptionFooter">
              {details && (
                <Button
                  color="primary"
                  className="expand-details"
                  size="small"
                  aria-label={`${expanded ? "Hide" : "Show"} ${name} details`}
                  aria-expanded={expanded}
                  endIcon={expanded ? <ChevronUpGlyph /> : <ChevronDownGlyph />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded(!expanded);
                  }}
                >
                  {expanded ? "Hide details" : "Show details"}
                </Button>
              )}
              {props.footerActions}
            </Box>
          )}
          {details && (
            <Collapse in={expanded} timeout="auto" unmountOnExit>
              {typeof details === "function" ? details(expanded) : details}
            </Collapse>
          )}
        </>
      )}
      {props.children}
    </Card>
  );
}
