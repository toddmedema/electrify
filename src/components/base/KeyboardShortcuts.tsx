import * as React from "react";
import { GAME_TOOLS, GameNavigationLabel } from "./GameNavigation";
interface ShortcutType {
  keys: string[];
  description: string;
  tool?: (typeof GAME_TOOLS)[number];
}

export const SHORTCUTS: ShortcutType[] = [
  { keys: ["`", "space", "0"], description: "Pause" },
  { keys: ["1", "2", "3"], description: "Slow / normal / fast speed" },
  { keys: ["4"], description: "Ultra speed (desktop-sized screens)" },
  ...GAME_TOOLS.map((tool) => ({
    keys: tool.keys,
    description: `Open / close ${tool.label}`,
    tool,
  })),
  { keys: ["G"], description: "Build a generator" },
  { keys: ["Shift+S"], description: "Build storage" },
  {
    keys: ["shift", "1-9"],
    description: "Pause / resume that facility in the fleet",
  },
  {
    keys: ["[", "]"],
    description: "Move the selected facility up / down the dispatch order",
  },
  { keys: ["?"], description: "Open the manual" },
  { keys: ["Esc"], description: "Close the current panel or screen" },
];

// The shortcuts render as a component rather than as plain markup, so the manual's search has
// nothing to walk -- this is what its entry lists as keywords instead
export const SHORTCUTS_SEARCH_TEXT = SHORTCUTS.map(
  (s) => `${s.keys.join(" ")} ${s.description}`,
).join(" ");

export default function KeyboardShortcuts({
  showNavigationIcons = false,
}: {
  showNavigationIcons?: boolean;
}): React.JSX.Element {
  return (
    <table className="shortcuts">
      <caption className="srOnly">Keyboard shortcuts</caption>
      <tbody>
        {SHORTCUTS.map((shortcut: ShortcutType) => (
          <tr key={shortcut.description}>
            <th scope="row">
              {shortcut.keys.map((key: string) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </th>
            <td>
              {showNavigationIcons && shortcut.tool ? (
                <>
                  Open / close{" "}
                  <GameNavigationLabel destination={shortcut.tool.id}>
                    {shortcut.tool.label}
                  </GameNavigationLabel>
                </>
              ) : (
                shortcut.description
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
