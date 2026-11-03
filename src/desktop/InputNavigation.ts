import { revealControl } from "../components/base/RevealControl";
import { isTvLayout } from "../TvLayout";

const controlSelector =
  "button,a[href],input,select,textarea,summary,[role=button],[tabindex]";
const popupSelector = "[role=dialog],[role=menu],[role=listbox]";
const keyCodes: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  " ": 32,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

function visible(element: HTMLElement): boolean {
  // Native closed disclosures retain geometry for content-visibility layout, but cannot take focus.
  for (
    let details = element.closest("details:not([open])");
    details;
    details = details.parentElement?.closest("details:not([open])") ?? null
  ) {
    if (!details.querySelector(":scope > summary")?.contains(element))
      return false;
  }
  // Compact tools cover the fleet without unmounting it or changing pointer/keyboard access.
  // Controller focus must stay on the exposed surface, including when a resize covers focus.
  if (
    element.closest(".gameFleet") &&
    element
      .closest('.gameStage[data-layout="sheet"]')
      ?.querySelector(".gameToolPanel:not([hidden])")
  )
    return false;
  return (
    !element.closest("[hidden],[inert],[aria-hidden=true]") &&
    !!element.getClientRects().length &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

/** The top popup owns input even when it has no available actions. */
export function inputScope(): HTMLElement {
  const popups = Array.from(
    document.querySelectorAll<HTMLElement>(popupSelector),
  ).filter(visible);
  if (popups.length) return popups[popups.length - 1];
  const screens = Array.from(
    document.querySelectorAll<HTMLElement>(".base_main:not([inert])"),
  ).filter(visible);
  const screen = screens[screens.length - 1];
  const container = screen?.closest<HTMLElement>(".app_container");
  const tutorial = container?.querySelector<HTMLElement>(".tutorialHud");
  if (isTvLayout())
    return screen?.closest<HTMLElement>(".appFrame") ?? screen ?? document.body;
  return tutorial && visible(tutorial) ? container! : (screen ?? document.body);
}

export function visibleControls(
  root: HTMLElement,
  { tabStopsOnly = true } = {},
): HTMLElement[] {
  return [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>(controlSelector)),
  ].filter(
    (element) =>
      element.matches(controlSelector) &&
      (!tabStopsOnly || element.tabIndex >= 0) &&
      !element.matches(":disabled,[aria-disabled=true]") &&
      visible(element),
  );
}

function actionTarget(scope: HTMLElement): HTMLElement {
  const active = document.activeElement;
  if (active instanceof HTMLElement && visible(active)) {
    if (scope.contains(active)) return active;
    // Autocomplete keeps real focus in its input while its listbox is portaled.
    const owned = `${active.getAttribute("aria-controls") ?? ""} ${active.getAttribute("aria-owns") ?? ""}`;
    if (scope.id && owned.split(/\s+/).includes(scope.id)) return active;
  }
  return scope;
}

function key(target: HTMLElement, value: string): KeyboardEvent {
  // The reorder library uses the legacy numeric key fields, as real keyboard events do.
  const keyCode = keyCodes[value] ?? 0;
  const options = {
    key: value,
    code: value === " " ? "Space" : value,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
  };
  const event = new KeyboardEvent("keydown", options);
  target.dispatchEvent(event);
  target.dispatchEvent(new KeyboardEvent("keyup", options));
  return event;
}

function focus(element: HTMLElement) {
  element.focus({ preventScroll: true });
  revealControl(element);
}

function changeValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  if (element.value === value) return;
  // Bypass React's value tracker so its normal onChange receives the native update.
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Follow rendered rows, keeping a scrolling list together before leaving for fixed chrome. */
function spatialDestination(
  target: HTMLElement,
  controls: HTMLElement[],
  direction: "up" | "down" | "left" | "right",
): HTMLElement | undefined {
  const from = target.getBoundingClientRect();
  if (!from.width || !from.height) return undefined;
  const vertical = direction === "up" || direction === "down";
  const forward = direction === "down" || direction === "right" ? 1 : -1;
  const scrollParent = (element: HTMLElement): HTMLElement | undefined => {
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        /(auto|scroll)/.test(getComputedStyle(parent).overflowY) &&
        parent.scrollHeight > parent.clientHeight
      )
        return parent;
    }
    return undefined;
  };
  const scrolling = vertical ? scrollParent(target) : undefined;
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  const candidates = controls.flatMap((element) => {
    if (element === target) return [];
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    const dx = (rect.left + rect.right) / 2 - cx;
    const dy = (rect.top + rect.bottom) / 2 - cy;
    const advance = (vertical ? dy : dx) * forward;
    if (advance <= 2) return [];
    const overlap = vertical
      ? Math.min(from.right, rect.right) - Math.max(from.left, rect.left)
      : Math.min(from.bottom, rect.bottom) - Math.max(from.top, rect.top);
    // Horizontal navigation follows the current row; Down/Up leaves that row.
    if (!vertical && overlap <= 0) return [];
    const cross = Math.abs(vertical ? dx : dy);
    return [
      {
        element,
        advance,
        cross,
        aligned: overlap > 0,
        sameScroll: !!scrolling && scrollParent(element) === scrolling,
      },
    ];
  });
  candidates.sort(
    (a, b) =>
      Number(b.sameScroll) - Number(a.sameScroll) ||
      Number(b.aligned) - Number(a.aligned) ||
      a.advance + a.cross * 0.25 - (b.advance + b.cross * 0.25),
  );
  return candidates[0]?.element;
}

/** Widget handlers get the first opportunity; native browser defaults need an explicit update. */
export function moveInputFocus(
  direction: "up" | "down" | "left" | "right",
): void {
  const scope = inputScope();
  const target = actionTarget(scope);
  const vertical = direction === "up" || direction === "down";
  const step = direction === "up" || direction === "left" ? -1 : 1;
  const range = target instanceof HTMLInputElement && target.type === "range";
  const select = target instanceof HTMLSelectElement;
  const closedCombo =
    target.matches('[role="combobox"]') &&
    target.getAttribute("aria-expanded") !== "true";
  // Keep a way out of value controls: horizontal adjusts, vertical changes focus.
  if (!(vertical && (range || select || closedCombo))) {
    const arrow = `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`;
    if (key(target, arrow).defaultPrevented) return;
    if (range) {
      const min = Number(target.min || 0);
      const max = Number(target.max || 100);
      const increment = target.step === "any" ? 1 : Number(target.step || 1);
      changeValue(
        target,
        String(
          Math.max(min, Math.min(max, Number(target.value) + step * increment)),
        ),
      );
      return;
    }
    if (select) {
      const options = Array.from(target.options).filter(
        (option) =>
          !option.disabled &&
          !option.hidden &&
          !option.closest("optgroup[disabled]"),
      );
      const index = options.findIndex((option) => option.selected);
      const next =
        options[Math.max(0, Math.min(options.length - 1, index + step))];
      if (next) changeValue(target, next.value);
      return;
    }
  }
  const controls = visibleControls(scope);
  if (!controls.length) return;
  const index = controls.indexOf(target);
  if (isTvLayout() && index >= 0) {
    const next = spatialDestination(target, controls, direction);
    if (next) focus(next);
    return;
  }
  if (index >= 0) {
    focus(controls[(index + step + controls.length) % controls.length]);
  } else {
    // A tool heading receives initial focus; continue immediately after that heading.
    const candidates = controls.filter(
      (element) =>
        target.compareDocumentPosition(element) &
        (step > 0
          ? Node.DOCUMENT_POSITION_FOLLOWING
          : Node.DOCUMENT_POSITION_PRECEDING),
    );
    focus(
      (step > 0 ? candidates[0] : candidates[candidates.length - 1]) ??
        controls[step > 0 ? 0 : controls.length - 1],
    );
  }
}

export function confirmInput(): void {
  const scope = inputScope();
  const target = actionTarget(scope);
  if (target === scope || target.matches("h1,h2,h3,h4,h5,h6")) {
    moveInputFocus("down");
    // Focus a newly entered surface without choosing its first action immediately.
    return;
  }
  if (!visible(target) || target.matches(":disabled,[aria-disabled=true]"))
    return;
  // Confirm lifts/drops a reorder; arrows move it and Back cancels through its own sensor.
  if (target.matches("[data-rfd-drag-handle-draggable-id]")) {
    key(target, " ");
    return;
  }
  let clicked = false;
  const markClick = () => {
    clicked = true;
  };
  target.addEventListener("click", markClick, true);
  const event = key(target, "Enter");
  target.removeEventListener("click", markClick, true);
  if (
    !event.defaultPrevented &&
    !clicked &&
    target.isConnected &&
    target.matches(
      "button,a[href],summary,[role=button],input[type=checkbox],input[type=radio],input[type=button],input[type=submit],input[type=reset]",
    )
  )
    target.click();
  requestAnimationFrame(() => {
    if (document.activeElement === target && visible(target))
      revealControl(target);
  });
}

/** Dispatch only to the current surface; its owner decides whether Back may dismiss it. */
export function backInput(): boolean {
  return key(actionTarget(inputScope()), "Escape").defaultPrevented;
}
