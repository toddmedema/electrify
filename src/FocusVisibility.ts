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
    if (event.pointerType === "touch") root.dataset.touchInput = "true";
    else delete root.dataset.touchInput;
  };
  const keyboard = (event: KeyboardEvent) => {
    // Virtual keyboards emit typing events too. Navigation keys indicate focus navigation.
    if (
      [
        "Tab",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        " ",
        "Escape",
      ].includes(event.key)
    )
      delete root.dataset.touchInput;
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.touchInput;
  };
}
