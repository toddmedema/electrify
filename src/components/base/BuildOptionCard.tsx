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
  /** Omitted to leave the card without a Review button */
  review?: {
    ariaLabel: string;
    pickSite?: boolean;
    disabled: boolean;
    id?: string;
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
  };
  /** Beside Review, such as Compare on a wide layout */
  headerActions?: React.ReactNode;
  /** Under Review: Use max size or Use site maximum. Moves the context line into the header. */
  sizeAction?: React.ReactNode;
  /** Description directly beneath the card header */
  description?: string;
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
  /** Read-only technology preview; purchase dialogs are not mounted. */
  preview?: boolean;
  previewSummary?: React.ReactNode;
  comparisonCaption?: string;
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
  const [disclosed, setExpanded] = React.useState(false);
  const expanded = disclosed;
  const { name, sizeAction, context, metrics, details } = props;
  const titleComponent = props.preview ? "h2" : props.titleComponent;
  const detailContent =
    typeof details === "function" ? details(expanded) : details;
  const warningId = React.useId();
  const detailsId = React.useId();
  // A disabled Review says why through the visible shortfall rather than staying silent.
  const describedBy =
    props.review?.disabled && props.warning ? warningId : undefined;
  const reviewButton = props.review && (
    <Button
      id={props.review.id}
      className="buy-button"
      size="small"
      variant="outlined"
      color="primary"
      onClick={props.review.onClick}
      disabled={props.review.disabled}
      startIcon={
        !props.review.pickSite && <ConceptIcon concept="buy" fontSize="small" />
      }
      aria-label={props.review.ariaLabel}
      aria-describedby={describedBy}
    >
      {props.review.pickSite ? "Pick site" : "Review"}
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
  const contextInHeader =
    !props.preview && (metrics === undefined || !!sizeAction);
  const warningInHeader = !props.preview && !!sizeAction && !!props.warning;

  return (
    <Card
      // Every catalog renders these cards as the items of its list.
      component="li"
      className={[
        "build-list-item buildOption",
        props.className,
        props.compared ? "compared" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props.cardProps}
      data-build-option={name}
    >
      <CardHeader
        className={
          sizeAction && !props.preview ? "stackedActionsHeader" : undefined
        }
        avatar={<Avatar alt={props.iconAlt ?? name} src={props.iconSrc} />}
        action={action}
        slotProps={{
          ...(titleComponent && { title: { component: titleComponent } }),
          ...(warningInHeader && {
            subheader: {
              component: "div",
              className: "buildOptionHeaderWarning",
              id: warningId,
            },
          }),
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
      {props.description && (
        <Typography
          className="buildOptionDescription"
          variant="body2"
          color="textSecondary"
        >
          {props.description}
        </Typography>
      )}
      {(props.preview || metrics !== undefined) && (
        <>
          {!contextInHeader && context && (
            <Typography
              className="buildOptionContext"
              variant="body2"
              color="textSecondary"
            >
              {context}
            </Typography>
          )}
          {props.summary}
          {props.warning && !warningInHeader && (
            <Typography
              component="div"
              id={warningId}
              className="buildOptionWarning"
              color="textSecondary"
            >
              {props.warning}
            </Typography>
          )}
          {props.preview ? (
            <>
              {props.comparisonCaption && (
                <Typography
                  className="buildComparisonCaption"
                  variant="caption"
                  component="p"
                >
                  {props.comparisonCaption}
                </Typography>
              )}
              {props.previewSummary}
            </>
          ) : (
            <Box className="buildOptionMetrics">{metrics}</Box>
          )}
          {(details || props.footerActions) && (
            <Box className="buildOptionFooter">
              {details && (
                <Button
                  color="primary"
                  className="expand-details"
                  size="small"
                  aria-label={
                    props.preview
                      ? undefined
                      : `${expanded ? "Hide" : "Show"} ${name} details`
                  }
                  aria-controls={
                    expanded && props.preview ? detailsId : undefined
                  }
                  aria-expanded={expanded}
                  endIcon={expanded ? <ChevronUpGlyph /> : <ChevronDownGlyph />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded(!expanded);
                  }}
                >
                  {props.preview
                    ? "Advanced"
                    : expanded
                      ? "Hide details"
                      : "Show details"}
                </Button>
              )}
              {props.footerActions}
            </Box>
          )}
          {details &&
            (props.preview ? (
              expanded && <div id={detailsId}>{detailContent}</div>
            ) : (
              <Collapse in={expanded} timeout="auto" unmountOnExit>
                {detailContent}
              </Collapse>
            ))}
        </>
      )}
      {!props.preview && props.children}
    </Card>
  );
}
