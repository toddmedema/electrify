import { SHORTCUTS } from "./KeyboardShortcuts";
import { keyMap } from "../Compositor";

/**
 * The two halves of the keyboard contract: the keys react-hotkeys actually listens for, and the
 * table the Manual and Settings print. They live in different files and drifted before -- a key
 * the game answers to but never mentions is only a little worse than one it advertises and
 * ignores, and this is the cheapest way to have neither.
 */

// Every key any binding listens for, in react-hotkeys' own spelling
const bound = new Set(
  Object.values(keyMap)
    .flatMap((keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]))
    .map((key: string) => key.toLowerCase()),
);

/**
 * The printed form of a key, in that spelling. The table writes for a reader rather than for a
 * parser: letters are capitalised, and the nine facility slots are one row reading "1-9" rather
 * than nine rows of their own.
 */
function bindingsFor(shortcut: (typeof SHORTCUTS)[number]): string[] {
  const [first, ...rest] = shortcut.keys;
  if (first === "shift") {
    // "shift" then "1-9": nine bindings, one row
    return rest.flatMap((range: string) => {
      const [from, to] = range.split("-").map(Number);
      const keys = [];
      for (let n = from; n <= to; n++) {
        keys.push(`shift+${n}`);
      }
      return keys;
    });
  }
  return shortcut.keys.map((key: string) => key.toLowerCase());
}

describe("the keyboard shortcuts", () => {
  it("binds every key the manual and settings list", () => {
    const unbound = SHORTCUTS.flatMap((shortcut) =>
      bindingsFor(shortcut).filter((key: string) => !bound.has(key)),
    );
    expect(unbound).toEqual([]);
  });

  it("keeps the number row on the speeds, and the fleet a shift away from it", () => {
    // The fleet shortcuts were asked for on the bare number row, which is where the speeds have
    // lived since long before the fleet had any
    expect(keyMap.SLOW).toEqual("1");
    expect(keyMap.NORMAL).toEqual("2");
    expect(keyMap.FAST).toEqual("3");
    expect(bound.has("shift+1")).toBe(true);
    expect(bound.has("shift+9")).toBe(true);
  });

  it("gives the desktop-only actions keys of their own", () => {
    // Building and reordering used to be mouse-only, on the screen most likely to have a keyboard
    expect(bound.has("g")).toBe(true);
    expect(bound.has("s")).toBe(true);
    expect(bound.has("[")).toBe(true);
    expect(bound.has("]")).toBe(true);
  });
});
