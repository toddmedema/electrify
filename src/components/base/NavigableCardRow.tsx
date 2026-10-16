import * as React from "react";
import { Card, CardActionArea, CardHeader } from "@mui/material";
import { ChevronRightGlyph } from "./Glyphs";

export interface NavigableCardRowProps {
  avatar: React.ReactNode;
  title: React.ReactNode;
  // The line under the title
  description?: React.ReactNode;
  ariaLabel: string;
  // Points assistive technology at an element in `description` that explains the row
  ariaDescribedBy?: string;
  // Omitted for a row someone else opens, such as a co-op host's choice a guest only reads
  onOpen?: () => void;
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
  const header = (
    <CardHeader
      avatar={avatar}
      title={title}
      subheader={description}
      action={
        showChevron &&
        onOpen && <ChevronRightGlyph className="rowChevron" aria-hidden />
      }
    />
  );
  return (
    <Card
      data-testid={testId}
      className={["build-list-item missionItem", className]
        .filter(Boolean)
        .join(" ")}
      data-completed={done || undefined}
      data-active={active || undefined}
    >
      {onOpen ? (
        <CardActionArea
          onClick={onOpen}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
        >
          {header}
        </CardActionArea>
      ) : (
        header
      )}
    </Card>
  );
}
