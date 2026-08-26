import * as React from "react";

interface ShortcutType {
  keys: string[];
  description: string;
}

// The single definition of the game's keyboard shortcuts, rendered in both Settings and the
// Manual. They used to be two hand-maintained copies of the same table, which is exactly the
// kind of thing that drifts. Keep in sync with keyMap in Compositor.tsx, which is the other
// half of the contract -- the keys themselves.
export const SHORTCUTS: ShortcutType[] = [
  { keys: ["`", "space", "0"], description: "Pause" },
  { keys: ["1", "2", "3"], description: "Slow / normal / fast speed" },
  { keys: ["Q"], description: "Facilities tab" },
  { keys: ["W"], description: "Finances tab" },
  { keys: ["E"], description: "Forecasts tab" },
  { keys: ["G"], description: "Build a generator" },
  { keys: ["S"], description: "Build storage" },
  {
    keys: ["shift", "1-9"],
    description: "Pause / resume that facility in the fleet",
  },
  {
    keys: ["[", "]"],
    description: "Move the selected facility up / down the dispatch order",
  },
  { keys: ["?"], description: "Open the manual" },
];

// The shortcuts render as a component rather than as plain markup, so the manual's search has
// nothing to walk -- this is what its entry lists as keywords instead
export const SHORTCUTS_SEARCH_TEXT = SHORTCUTS.map(
  (s) => `${s.keys.join(" ")} ${s.description}`,
).join(" ");

export default function KeyboardShortcuts(): React.JSX.Element {
  return (
    <table className="shortcuts">
      <tbody>
        {SHORTCUTS.map((shortcut: ShortcutType) => (
          <tr key={shortcut.description}>
            <td>
              {shortcut.keys.map((key: string) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </td>
            <td>{shortcut.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
