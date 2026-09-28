import * as React from "react";
import { Card, CardActionArea, CardHeader } from "@mui/material";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";

export interface NavigableCardRowProps {
  avatar: React.ReactNode;
  title: React.ReactNode;
  // The line under the title
  description?: React.ReactNode;
  ariaLabel: string;
  // Points assistive technology at an element in `description` that explains the row
  ariaDescribedBy?: string;
  onOpen: () => void;
  // The trailing chevron that says the row opens a screen of its own
  showChevron?: boolean;
  // Styling hooks for a row that's finished or currently in effect
  done?: boolean;
  active?: boolean;
  className?: string;
  testId?: string;
}

/**
 * One tappable catalog card that opens a detail view: the mission list and the customer programs
 * list both scan this way, so they share a single row.
 */
export default function NavigableCardRow({
  avatar,
  title,
  description,
  ariaLabel,
  ariaDescribedBy,
  onOpen,
  showChevron = true,
  done,
  active,
  className,
  testId,
}: NavigableCardRowProps): React.JSX.Element {
  return (
    <Card
      data-testid={testId}
      className={["build-list-item missionItem", className]
        .filter(Boolean)
        .join(" ")}
      data-completed={done || undefined}
      data-active={active || undefined}
    >
      <CardActionArea
        onClick={onOpen}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
      >
        <CardHeader
          avatar={avatar}
          title={title}
          subheader={description}
          action={showChevron && <ArrowRightIcon color="primary" aria-hidden />}
        />
      </CardActionArea>
    </Card>
  );
}
