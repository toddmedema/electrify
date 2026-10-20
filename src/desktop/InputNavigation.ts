const controlSelector =
  "button,a[href],input,select,textarea,summary,[role=button],[tabindex]";
const popupSelector = "[role=dialog],[role=menu],[role=listbox]";

function visible(element: HTMLElement): boolean {
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
  const event = new KeyboardEvent("keydown", {
    key: value,
    code: value,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  target.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: value,
      code: value,
      bubbles: true,
    }),
  );
  return event;
}

function focus(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({
    block: "nearest",
    inline: "nearest",
    behavior: "instant",
  });
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
}

/** Dispatch only to the current surface; its owner decides whether Back may dismiss it. */
export function backInput(): boolean {
  return key(actionTarget(inputScope()), "Escape").defaultPrevented;
}
