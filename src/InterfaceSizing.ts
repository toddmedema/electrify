import { InterfaceSizeType } from "./Types";

export const INTERFACE_SIZES: readonly InterfaceSizeType[] = [
  "normal",
  "larger",
];
const DISPLAY_EVENT = "electrify-interface-size";
let currentSize: InterfaceSizeType = "normal";

export function getInterfaceSize(): InterfaceSizeType {
  return currentSize;
}

export function getInterfaceScale(): number {
  return currentSize === "larger" ? 1.25 : 1;
}

/** Natural layout sizing, not a transformed surface: canvas pointers stay in CSS pixels. */
export function setInterfaceSize(size: InterfaceSizeType): void {
  document.documentElement.dataset.interfaceSize = size;
  document.documentElement.style.fontSize = size === "larger" ? "125%" : "100%";
  if (size === currentSize) return;
  currentSize = size;
  window.dispatchEvent(new Event(DISPLAY_EVENT));
  window.dispatchEvent(new Event("resize"));
}

export function subscribeInterfaceSize(onChange: () => void): () => void {
  window.addEventListener(DISPLAY_EVENT, onChange);
  return () => window.removeEventListener(DISPLAY_EVENT, onChange);
}
