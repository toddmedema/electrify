import * as React from "react";
import { useAppDispatch } from "../../Store";
import { navigateBack } from "../../reducers/Card";
import ScreenPage from "../base/ScreenPage";
import { restoreMenuFocus } from "../base/useMenuKeys";

/** Back from Saved games, to the control that opened it. */
export function useLeaveSavedGames(): () => void {
  const dispatch = useAppDispatch();
  return React.useCallback(() => {
    dispatch(navigateBack());
    restoreMenuFocus("[data-saves-trigger]");
  }, [dispatch]);
}

/** The Saved games page frame, with no content and no loading message. It stands in while the
 * screen's code downloads, so the screen is on display the moment Saves is pressed and the
 * list fills in beneath the same title and Back button. */
export default function SavedGamesShell(): React.JSX.Element {
  const onBack = useLeaveSavedGames();
  return <ScreenPage id="gameCard" title="Saved games" onBack={onBack} />;
}
