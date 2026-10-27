// Range sliders and buttons keep global shortcuts after a click; text inputs keep their typing.
const NON_TEXT_INPUT_TYPES = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "color",
  "submit",
  "reset",
  "image",
  "file",
]);
function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;
  if (
    event.key === " " &&
    event.target instanceof Element &&
    event.target.closest(
      'button, input, select, textarea, summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"]',
    )
  )
    return true;
  if (document.querySelector(".MuiModal-root:not(.MuiModal-hidden)"))
    return true;
  if (document.querySelector('[data-data-center-guide="true"]')) return true;
  if (document.querySelector('[data-scenario-choice="true"]')) return true;
  if (document.querySelector('[data-manual-help="true"]')) return true;
  if (
    event.target instanceof Element &&
    event.target.closest('[data-program-decision="true"]')
  )
    return true;
  if (event.key === "Escape") {
    return false;
  }
  const target = event.target as HTMLElement | null;
  const tagName = target?.tagName?.toLowerCase();
  if (!tagName) {
    return false;
  }
  if (
    tagName === "input" &&
    NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)
  ) {
    return false;
  }
  return (
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    !!target?.isContentEditable
  );
}

/** Only the single-key bindings used by the game, plus Shift for facility slots and help. */
function shortcutKey(event: KeyboardEvent): string {
  const key =
    event.key === " "
      ? "space"
      : event.key === "Escape"
        ? "esc"
        : event.key.toLowerCase();
  if (!event.shiftKey || key === "?") return key;
  // Shift changes the number row's key to punctuation (e.g. "!"). Prefer a digit from the
  // current layout, then its physical number-row code; letters continue to follow the layout.
  const digit = /^[1-9]$/.test(key)
    ? key
    : /^Digit[1-9]$/.test(event.code)
      ? event.code.slice(-1)
      : undefined;
  return `shift+${digit ?? key}`;
}

export function listenForShortcuts(
  keyMap: Record<string, string | string[]>,
  handlers: Record<string, (event: KeyboardEvent) => void>,
): () => void {
  const bindings = new Map(
    Object.entries(keyMap).flatMap(([action, keys]) =>
      (Array.isArray(keys) ? keys : [keys]).map(
        (key) => [key, action] as const,
      ),
    ),
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.repeat ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      shouldIgnoreShortcut(event)
    )
      return;
    const action = bindings.get(shortcutKey(event));
    if (action) handlers[action]?.(event);
  };
  // Bubble after local controls have had a chance to consume Escape or Space.
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
