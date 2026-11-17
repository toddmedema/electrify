let helpAnchor: HTMLElement | null = null;
export function setManualHelpAnchor(element: HTMLElement | null) {
  helpAnchor = element;
}
export function getManualHelpAnchor() {
  return helpAnchor;
}
