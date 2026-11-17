// Startup and the menu hook share initial focus without treating it as player input.
// Keep this DOM-only: the startup entry must not import React or the game store.
let initialTarget: HTMLElement | undefined;

export function focusInitialMenuControl(target?: HTMLElement): void {
  const previous = initialTarget;
  initialTarget = target;
  try {
    target?.focus({ preventScroll: true });
  } finally {
    initialTarget = previous;
  }
}

export function isInitialMenuFocus(target: EventTarget): boolean {
  return target === initialTarget;
}
