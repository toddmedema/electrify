import { KeyboardEvent, useEffect, useRef } from "react";

const selector = "button,a[href],input,select,textarea,[role=button]";
const popup = "[role=dialog],[role=menu],[role=listbox]";
function controls(root: Element): HTMLElement[] {
  return [
    root as HTMLElement,
    ...Array.from(root.querySelectorAll<HTMLElement>(selector)),
  ].filter(
    (element) =>
      element.matches(selector) &&
      element.tabIndex >= 0 &&
      !element.matches(":disabled,[aria-disabled=true]") &&
      !element.closest("[hidden],[inert],[aria-hidden=true]") &&
      !!element.getClientRects().length &&
      getComputedStyle(element).visibility !== "hidden",
  );
}
const preferred = (items: HTMLElement[]) =>
  items.find((item) => item.matches("[aria-pressed=true]")) || items[0];

/** Real focus is the selection, shared with pointer and native Tab navigation. */
export function useMenuKeys(settings = false, onBack?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // 0: entering, 1: initial focus, 2: the player has moved focus.
  const interaction = useRef(0);
  const rows = () =>
    !ref.current
      ? []
      : settings
        ? Array.from(
            ref.current.querySelectorAll(
              ".settingsRow,.settingsKeyboardRow,.MuiAccordionSummary-root",
            ),
          )
            .map(controls)
            .filter((items) => items.length)
        : [controls(ref.current)];
  useEffect(() => {
    const active = document.activeElement;
    if (
      !document.querySelector(popup) &&
      (active === document.body ||
        !interaction.current ||
        (interaction.current === 1 && ref.current?.contains(active)))
    ) {
      preferred(rows()[0] || [])?.focus();
    }
    if (!interaction.current) interaction.current = 1;
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !ref.current?.contains(target) ||
      document.querySelector(popup)
    )
      return;
    if (event.repeat && (event.key === "Enter" || event.key === "Escape")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    interaction.current = 2;
    const native = target.matches(
      "select,textarea,[contenteditable=true],[role=combobox],input:not([type=checkbox])",
    );
    if (event.key === "Escape" && onBack) {
      event.stopPropagation();
      event.preventDefault();
      onBack();
    } else if (
      event.key === "Enter" &&
      target.matches("input[type=checkbox]")
    ) {
      event.preventDefault();
      target.click();
    } else if (!native && event.key.startsWith("Arrow")) {
      const groups = rows();
      const row = groups.findIndex((items) => items.includes(target));
      if (row < 0) return;
      const step = /Up|Left/.test(event.key) ? -1 : 1;
      const vertical = /Up|Down/.test(event.key);
      const items = groups[row];
      const index = items.indexOf(target) + step;
      const next =
        settings && vertical
          ? preferred(
              groups[Math.max(0, Math.min(groups.length - 1, row + step))],
            )
          : items[
              settings
                ? Math.max(0, Math.min(items.length - 1, index))
                : (index + items.length) % items.length
            ];
      event.preventDefault();
      event.stopPropagation();
      next?.focus();
    }
  };
  return {
    ref,
    onKeyDown,
    onFocusCapture: () => {
      if (interaction.current) interaction.current = 2;
    },
  };
}
