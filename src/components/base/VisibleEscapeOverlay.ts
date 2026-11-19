/** Mounted menus can outlive their open state; only an available overlay owns Escape. */
export function hasVisibleEscapeOverlay(
  exceptWithin?: Element | null,
): boolean {
  return Array.from(
    document.querySelectorAll(
      '.MuiModal-root, [role="menu"], [role="listbox"], [data-escape-overlay="true"]',
    ),
  ).some((overlay) => {
    if (exceptWithin?.contains(overlay)) return false;
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
