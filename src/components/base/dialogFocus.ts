/** Where focus goes when a dialog opens.
 *
 * MUI focuses the dialog container. These prompts then move that focus to the
 * first action once the open animation finishes, unless the player already
 * moved somewhere else. Titles stay the accessible name only.
 */

function resolveDialog(node: HTMLElement | null): HTMLElement | null {
  if (!node) return null;
  if (node.getAttribute("role") === "dialog") return node;
  return (
    node.querySelector<HTMLElement>('[role="dialog"]') ??
    node.closest<HTMLElement>('[role="dialog"]')
  );
}

function isDialogTitle(active: HTMLElement): boolean {
  // Back and Close sit in the title bar. A player who reached one has already chosen.
  if (active.closest("button, a, input, select, textarea")) return false;
  if (active.classList.contains("MuiDialogTitle-root")) return true;
  if (active.closest(".MuiDialogTitle-root")) return true;
  return /^H[1-6]$/.test(active.tagName);
}

/** True when focus is still the container, a title, or nowhere — not a control the player chose. */
function shouldReplaceInitialFocus(
  dialog: HTMLElement,
  active: Element | null,
): boolean {
  if (
    !active ||
    active === document.body ||
    active === document.documentElement ||
    active === dialog
  )
    return true;
  return (
    active instanceof HTMLElement &&
    dialog.contains(active) &&
    isDialogTitle(active)
  );
}

function isUnfocusable(element: HTMLElement): boolean {
  return (
    element.hasAttribute("disabled") ||
    (element instanceof HTMLButtonElement && element.disabled)
  );
}

function hasAutoFocus(element: HTMLElement): boolean {
  return (
    element.hasAttribute("autofocus") ||
    ("autofocus" in element &&
      (element as HTMLButtonElement).autofocus === true)
  );
}

function isChromeControl(element: HTMLElement): boolean {
  if (!element.classList.contains("MuiIconButton-root")) return false;
  const name = (element.getAttribute("aria-label") || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return /^(close|back)(\b|$)/.test(name);
}

function initialDialogAction(dialog: HTMLElement): HTMLElement | null {
  const marked = Array.from(dialog.querySelectorAll<HTMLElement>("*")).find(
    (element) => hasAutoFocus(element) && !isUnfocusable(element),
  );
  if (marked) return marked;

  const buttons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button) => !button.closest("[aria-hidden='true']"));
  const actionable = buttons.filter((button) => !isChromeControl(button));
  const pool = actionable.length ? actionable : buttons;
  const enabled = pool.filter((button) => !isUnfocusable(button));
  const candidates = enabled.length ? enabled : pool;
  return (
    candidates.find((button) =>
      button.classList.contains("MuiButton-contained"),
    ) ??
    candidates[0] ??
    null
  );
}

export function focusInitialDialogAction(
  node: HTMLElement | null,
  options?: { force?: boolean },
): void {
  const dialog = resolveDialog(node);
  if (!dialog) return;
  const active = document.activeElement;
  if (!options?.force && !shouldReplaceInitialFocus(dialog, active)) return;
  const target = initialDialogAction(dialog);
  if (target && target !== active) target.focus();
}
