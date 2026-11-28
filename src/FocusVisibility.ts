const navigationKeys = [
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
];

export function hasNavigationFocus(element: HTMLElement): boolean {
  const { keyboardNavigation, controllerInput } =
    element.ownerDocument.documentElement.dataset;
  return (
    (keyboardNavigation === "true" ||
      controllerInput === "true" ||
      element.hasAttribute("data-keyboard-restored-focus")) &&
    element.matches(":focus-visible")
  );
}

function canShowKeyboardFocus(event: KeyboardEvent): boolean {
  return (
    event.isTrusted &&
    !event.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

/** Keep the keyboard cue on a tool's returning trigger until focus or input changes. */
export function restoreToolTriggerFocus(
  trigger: HTMLElement | null,
  event?: KeyboardEvent,
): void {
  if (!trigger) return;
  if (event && canShowKeyboardFocus(event)) {
    trigger.setAttribute("data-keyboard-restored-focus", "");
    trigger.addEventListener(
      "blur",
      () => trigger.removeAttribute("data-keyboard-restored-focus"),
      { once: true },
    );
  }
  trigger.focus({ preventScroll: true });
  if (trigger.ownerDocument.activeElement !== trigger)
    trigger.removeAttribute("data-keyboard-restored-focus");
}

/** Touch focus can be inherited by buttons opened from a text field or an auto-focused menu.
 * Track actual input instead of guessing whether a device has a physical keyboard attached.
 */
export function installFocusVisibility(): () => void {
  const root = document.documentElement;
  // This chooses an initial presentation, not a claim that no keyboard is attached. Any
  // keyboard navigation below immediately restores the indicators, even on a touch screen.
  if (window.matchMedia("(hover: none) and (pointer: coarse)").matches)
    root.dataset.touchInput = "true";
  const pointer = (event: PointerEvent) => {
    if (event.isTrusted) {
      delete root.dataset.keyboardNavigation;
      document.activeElement?.removeAttribute("data-keyboard-restored-focus");
    }
    if (event.pointerType === "touch") root.dataset.touchInput = "true";
    else delete root.dataset.touchInput;
  };
  const keyboard = (event: KeyboardEvent) => {
    // Sliders use Page Up and Page Down for larger steps. Elsewhere they scroll the page.
    const stepsSlider =
      (event.key === "PageUp" || event.key === "PageDown") &&
      event.target instanceof HTMLInputElement &&
      event.target.type === "range";
    const navigatesFocus = navigationKeys.includes(event.key) || stepsSlider;
    // Browsers can report :focus-visible after any key, including gameplay shortcuts.
    // Keep their focus heuristic, but only show gameplay cues after keyboard navigation.
    if (navigatesFocus && canShowKeyboardFocus(event))
      root.dataset.keyboardNavigation = "true";
    if (navigatesFocus || ["Enter", " ", "Escape"].includes(event.key))
      delete root.dataset.touchInput;
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.touchInput;
    delete root.dataset.keyboardNavigation;
  };
}
