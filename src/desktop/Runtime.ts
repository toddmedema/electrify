import type { AppStore } from "../Store";
import { getDesktop } from "../Desktop";
import { initializeDesktopSaves } from "../DesktopSaves";
import { startDesktopActivity } from "../DesktopActivity";
import { startDesktopFeedback } from "../audio/DesktopFeedback";
import { startAchievements } from "./AchievementObserver";
import { startDesktopInput } from "./Input";

/** One Electron-only chunk owns native Steam services and menu feedback. */
export async function initializeDesktop(): Promise<void> {
  await initializeDesktopSaves();
}

export function startDesktopServices(store: AppStore): () => void {
  const desktop = getDesktop();
  if (!desktop) return () => {};
  const feedback = startDesktopFeedback(store);
  const stops = [
    startDesktopActivity(store, desktop),
    feedback,
    startDesktopInput(store, desktop, feedback.controllerCue),
    startAchievements(store, desktop),
  ];
  return () => stops.forEach((stop) => stop());
}
