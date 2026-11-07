import { withCouchPlatform } from "../couch/Platform";
import type { AppStore } from "../Store";
import { getDesktop } from "../Desktop";
import { initializeDesktopSaves } from "../DesktopSaves";
import { startDesktopActivity } from "../DesktopActivity";
import { startDesktopFeedback } from "../audio/DesktopFeedback";
import { startAchievements } from "./AchievementObserver";
import { startDesktopInput } from "./Input";
import "../TvLayout.scss";

/** One Electron-only chunk owns native Steam services and menu feedback. */
export async function initializeDesktop(): Promise<void> {
  await initializeDesktopSaves();
}

export function startDesktopServices(store: AppStore): () => void {
  const desktop = getDesktop();
  if (!desktop) return () => {};
  const account = withCouchPlatform(store);
  const feedback = startDesktopFeedback(store);
  const stops = [
    startDesktopActivity(account, desktop),
    feedback,
    startDesktopInput(store, desktop, feedback.controllerCue),
    startAchievements(account, desktop),
  ];
  return () => stops.forEach((stop) => stop());
}
