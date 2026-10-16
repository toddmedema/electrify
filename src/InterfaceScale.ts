/** Interface size is measured in CSS pixels, independent of monitor resolution. */
export const INTERFACE_SCALES = [1, 1.25, 1.5] as const;
export type InterfaceScale = (typeof INTERFACE_SCALES)[number];

export function normalizeInterfaceScale(value: number): InterfaceScale {
  return INTERFACE_SCALES.find((scale) => scale === value) ?? 1;
}

// Kept separate from the saved preference: phones always use their original size.
export function getInterfaceScale(): InterfaceScale {
  return normalizeInterfaceScale(
    typeof document === "undefined"
      ? 1
      : Number(document.documentElement.dataset.interfaceScale ?? 1),
  );
}

export function subscribeInterfaceScale(listener: () => void): () => void {
  window.addEventListener("electrify-interface-scale", listener);
  return () =>
    window.removeEventListener("electrify-interface-scale", listener);
}
