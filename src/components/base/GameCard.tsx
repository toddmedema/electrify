import { currentTick } from "../../helpers/GameSelectors";
import * as React from "react";
import { Toolbar, Typography } from "@mui/material";
import { AppStateType, GameType } from "../../Types";
import { connectToStore } from "./ConnectToStore";

/** Content frame for views hosted by the map workspace. */

export interface GameCardProps extends React.ComponentPropsWithoutRef<"div"> {
  children?: React.JSX.Element | React.JSX.Element[] | undefined;
  className?: string | undefined;
  game: GameType;
  // Optional heading for standalone content. The workspace supplies each tool's header.
  title?: string;
}

export interface Props extends GameCardProps {}

export function GameCard(props: Props) {
  const { game } = props;
  const now = currentTick(game);

  if (!game.inGame || !now) {
    return <span />;
  }

  const classes = ["flexContainer", props.className].filter(Boolean).join(" ");

  return (
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

const mapStateToProps = (
  state: AppStateType,
  ownProps: Partial<GameCardProps>,
): GameCardProps => ({
  game: state.game,
  ...ownProps,
});

const GameCardContainer = connectToStore(mapStateToProps)(GameCard);

export default GameCardContainer;
