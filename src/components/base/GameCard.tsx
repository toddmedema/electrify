import { currentTick } from "../../helpers/GameSelectors";
import * as React from "react";
import { Toolbar, Typography } from "@mui/material";
import { isPaneLayout } from "../../Globals";
import { AppStateType, GameType } from "../../Types";
import { connectToStore } from "./ConnectToStore";
import GameAppBarContainer from "./GameAppBar";
import NavigationContainer from "./NavigationContainer";
import { GameWorkspaceContext } from "./GameWorkspaceContext";

/**
 * A game view's content frame. The persistent workspace owns game chrome; the standalone
 * fallback also supports previews and focused component tests.
 */

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
  const embedded = React.useContext(GameWorkspaceContext);
  const now = currentTick(game);

  if (!game.inGame || !now) {
    return <span />;
  }

  const classes = ["flexContainer", props.className].filter(Boolean).join(" ");

  if (embedded || isPaneLayout()) {
    return (
      // Stable IDs also let tutorial steps address content inside the workspace.
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

const GameCardContainer = connectToStore(mapStateToProps)(GameCard);

export default GameCardContainer;
