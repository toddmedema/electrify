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

// The shell's Back button is replaced by the real screen's, so a player who had focused it would
// land on <body>. The shell notes that it held focus as it unmounts; the screen that replaces it
// takes the note in the same commit and focuses its own Back. Cleared after the commit, so a
// shell that goes away for any other reason (Back, another screen) leaves nothing behind.
let shellHeldFocus = false;

/** True once, if the shell being replaced right now held keyboard focus. */
export function takeShellFocus(): boolean {
  const held = shellHeldFocus;
  shellHeldFocus = false;
  return held;
}

/** The Saved games page frame, with no content and no loading message. It stands in while the
 * screen's code downloads, so the screen is on display the moment Saves is pressed and the
 * list fills in beneath the same title and Back button. */
export default function SavedGamesShell(): React.JSX.Element {
  const onBack = useLeaveSavedGames();
  const page = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const root = page.current;
    return () => {
      // Runs before the shell's DOM is removed, so focus is still where the player left it.
      shellHeldFocus = !!root?.contains(document.activeElement);
      if (shellHeldFocus) queueMicrotask(() => (shellHeldFocus = false));
    };
  }, []);
  return (
    <ScreenPage ref={page} id="gameCard" title="Saved games" onBack={onBack} />
  );
}
