import { moveInputFocus } from "../../desktop/InputNavigation";

/**
 * A closed dropdown: a native select or the combobox of a MUI Select, never a text field (the
 * place search is an editable combobox and keeps its arrow keys).
 */
function closedDropdown(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  if (target instanceof HTMLSelectElement)
    return target.multiple || target.size > 1 || target.disabled
      ? undefined
      : target;
  return target.matches('[role="combobox"][aria-haspopup="listbox"]') &&
    !(target instanceof HTMLInputElement) &&
    target.getAttribute("aria-expanded") !== "true" &&
    target.getAttribute("aria-disabled") !== "true"
    ? target
    : undefined;
}

/**
 * Dropdowns open with Enter, Space or a controller's A, and never by arrow keys. Arrow keys move
 * the player's focus on, as they do between every other control; otherwise focus that lands on a
 * dropdown while arrowing down a page opens it, and the next arrow press navigates its options
 * instead of leaving. Once an option is chosen the list closes and focus stays on the dropdown,
 * so the arrows carry on from there.
 *
 * Listens in the capture phase, so that a dropdown's own handler (MUI opens on ArrowUp and
 * ArrowDown, and a native select changes value or opens depending on the platform) never sees them.
 */
export function listenForDropdownKeys(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const dropdown = closedDropdown(event.target);
    if (!dropdown) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveInputFocus(event.key === "ArrowUp" ? "up" : "down");
    } else if (
      event.key === "Enter" &&
      dropdown instanceof HTMLSelectElement &&
      // A controller's Confirm arrives as a synthetic Enter. The operating system's own list
      // cannot be driven by the controller, so it must never open from one.
      event.isTrusted
    ) {
      // Browsers differ on whether Enter opens a native select; here it always does.
      event.preventDefault();
      try {
        dropdown.showPicker();
      } catch {
        // No picker without a user gesture, or no showPicker at all: Space still opens it.
      }
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}
