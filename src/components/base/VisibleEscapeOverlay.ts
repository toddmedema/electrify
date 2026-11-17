/** Mounted menus can outlive their open state; only an available overlay owns Escape. */
export function hasVisibleEscapeOverlay(): boolean {
  return Array.from(
    document.querySelectorAll(
      '.MuiModal-root, [role="menu"], [role="listbox"]',
    ),
  ).some((overlay) => {
    if (
      overlay.closest(
        '.MuiModal-hidden, [hidden], [inert], [aria-hidden="true"]',
      )
    )
      return false;
    for (
      let element: Element | null = overlay;
      element;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      )
        return false;
    }
    return true;
  });
}
