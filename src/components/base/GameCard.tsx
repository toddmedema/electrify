import * as React from "react";
import { connect } from "react-redux";
import { Toolbar, Typography } from "@mui/material";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { isDesktopScreen } from "../../Globals";
import { AppStateType, GameType } from "../../Types";
import GameAppBarContainer from "./GameAppBar";
import NavigationContainer from "./NavigationContainer";

/**
 * The frame the three in-game panes sit in.
 *
 * On a phone there is one pane on screen at a time, so the card carries the app bar and the
 * bottom nav that switches between them. On desktop all three are already on screen and the app
 * bar spans them (see Compositor.renderCard), so a card is just a pane: a header naming it and
 * its own contents.
 */

export interface GameCardProps extends React.ComponentPropsWithoutRef<"div"> {
  children?: React.JSX.Element | React.JSX.Element[] | undefined;
  className?: string | undefined;
  game: GameType;
  // Shown as this pane's own header in the desktop layout, since there's no bottom nav there to
  // tell the panes apart. Panes whose contents already lead with a header of their own (see
  // Facilities, whose header carries the build buttons) leave this unset.
  title?: string;
}

export interface Props extends GameCardProps {}

export function GameCard(props: Props) {
  const { game } = props;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);

  if (!game.inGame || !now) {
    return <span />;
  }

  const classes = ["flexContainer", props.className].filter(Boolean).join(" ");

  if (isDesktopScreen()) {
    return (
      // id is how tutorial steps address an individual pane, since the bottom nav they'd
      // otherwise point at is hidden in this layout
      <div id={props.id} className={classes + " pane"}>
        {props.title && (
          <Toolbar className="paneHeader">
            <Typography variant="h6">{props.title}</Typography>
          </Toolbar>
        )}
        {props.children}
      </div>
    );
  }

  return (
    <div className={classes} id="gameCard">
      <GameAppBarContainer />
      {props.children}
      <NavigationContainer />
    </div>
  );
}

const mapStateToProps = (
  state: AppStateType,
  ownProps: Partial<GameCardProps>,
): GameCardProps => ({
  game: state.game,
  ...ownProps,
});

const GameCardContainer = connect(mapStateToProps)(GameCard);

export default GameCardContainer;
