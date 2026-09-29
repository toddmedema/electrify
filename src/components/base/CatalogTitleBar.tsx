import * as React from "react";
import { IconButton, Toolbar, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useAppDispatch, useAppSelector } from "../../Store";
import { setSpeed } from "../../reducers/Game";
import { formatMoneyStable } from "../../helpers/Format";
import { isDesktopScreen } from "../../Globals";
import { buildSpeedOptions } from "./SpeedControls";

export interface CatalogTitleBarProps {
  /** Sits before the title */
  icon: React.ReactNode;
  title: React.ReactNode;
  /** Sits after the title, such as a manual link */
  titleAdornment?: React.ReactNode;
  cash: number;
  /** Omit the cash suffix in compact headers. */
  compactCash?: boolean;
  onClose: () => void;
  closeLabel?: string;
  closeButtonId?: string;
  titleId?: string;
  /** The page's heading level, when the bar titles a dialog */
  titleComponent?: "h1";
  /** The game bar's id, for the one catalog that stands in for it (tutorials target it) */
  speedControlId?: string;
  disableGutters?: boolean;
}

/**
 * The title bar of a full-screen catalog that covers the game bar: close on the left, then the
 * title and cash, then the speed control the covered bar would otherwise have held. The clock
 * opens paused; a speed picked here is kept when the catalog closes.
 */
export default function CatalogTitleBar(
  props: CatalogTitleBarProps,
): React.JSX.Element {
  const dispatch = useAppDispatch();
  const inGame = useAppSelector((state) => state.game.inGame);
  const speed = useAppSelector((state) => state.game.speed);
  const cash = formatMoneyStable(props.cash);
  return (
    <Toolbar
      className="constructionTitleBar"
      disableGutters={props.disableGutters}
    >
      <IconButton
        id={props.closeButtonId}
        color="primary"
        onClick={props.onClose}
        aria-label={props.closeLabel ?? "close"}
        size="large"
      >
        <CloseIcon />
      </IconButton>
      <Typography
        variant="h6"
        component={props.titleComponent ?? "h6"}
        id={props.titleId}
        className="constructionTitle"
      >
        <span className="iconLabel">
          {props.icon}
          {props.title}
        </span>
        {props.titleAdornment}
        <span
          className="weak constructionCash"
          aria-label={`Available cash ${cash}`}
        >
          {cash}
          {props.compactCash ? "" : " cash"}
        </span>
      </Typography>
      {inGame && (
        <div className="constructionSpeed" id={props.speedControlId}>
          {buildSpeedOptions({
            speed,
            onSpeedChange: (next) => dispatch(setSpeed(next)),
            desktop: isDesktopScreen(),
          })}
        </div>
      )}
    </Toolbar>
  );
}
