import { useSyncExternalStore } from "react";
import type {
  DesktopInputAction,
  DesktopInputContext,
  DesktopInputFrame,
} from "../Desktop";

export interface InputPresentation {
  active: boolean;
  connected: boolean;
  pausedAfterDisconnect: boolean;
  context: DesktopInputContext;
  glyphs: DesktopInputFrame["glyphs"];
}
const initial: InputPresentation = {
  active: false,
  connected: false,
  pausedAfterDisconnect: false,
  context: "Menu",
  glyphs: {},
};
let presentation = initial;
const listeners = new Set<() => void>();
export const getInputPresentation = () => presentation;
export const subscribeInputPresentation = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function updateInputPresentation(update: Partial<InputPresentation>) {
  const next = { ...presentation, ...update };
  const glyphs = Object.entries(next.glyphs);
  const sameGlyphs =
    next.glyphs === presentation.glyphs ||
    (glyphs.length === Object.keys(presentation.glyphs).length &&
      glyphs.every(([action, glyph]) => {
        const previous = presentation.glyphs[action as DesktopInputAction];
        return (
          previous?.label === glyph.label && previous?.image === glyph.image
        );
      }));
  if (
    sameGlyphs &&
    next.active === presentation.active &&
    next.connected === presentation.connected &&
    next.pausedAfterDisconnect === presentation.pausedAfterDisconnect &&
    next.context === presentation.context
  )
    return;
  if (sameGlyphs) next.glyphs = presentation.glyphs;
  presentation = next;
  listeners.forEach((listener) => listener());
}

export function resetInputPresentation(): void {
  updateInputPresentation(initial);
}

/** Device presentation stays light enough to share with the web UI. */
export function useControllerInput(): boolean {
  return useSyncExternalStore(
    subscribeInputPresentation,
    () => presentation.active,
    () => false,
  );
}
