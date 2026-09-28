import * as React from "react";
import { IconButton, Toolbar, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

interface Props {
  title: React.ReactNode;
  /** Shows the one back glyph the app uses when set. */
  onBack?: () => void;
  /**
   * The title's element. A screen that already has its own h1 in the body (game details)
   * passes "div" so the page keeps a single top-level heading.
   */
  titleComponent?: "h1" | "div";
  /** Controls after the title: a search field, a help button. */
  trailing?: React.ReactNode;
}

/**
 * The header every standalone screen (Settings, Manual, Choose a game, Game details, Custom setup)
 * shares: one chevron, one left-aligned h6 title at every width, a hairline divider and the same
 * 16px inset as the body below it. The id keeps the safe-area and inset rules on #topbar.
 */
export default function ScreenHeader({
  title,
  onBack,
  titleComponent = "h1",
  trailing,
}: Props): React.JSX.Element {
  return (
    <div id="topbar" className="screenHeader">
      <Toolbar className="screenHeaderBar">
        {onBack && (
          <IconButton
            onClick={onBack}
            aria-label="Back"
            edge="start"
            color="primary"
            size="large"
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <Typography
          component={titleComponent}
          variant="h6"
          className="screenHeaderTitle"
        >
          {title}
        </Typography>
        {trailing}
      </Toolbar>
    </div>
  );
}
