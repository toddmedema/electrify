import { withCouchPlatform } from "../couch/Platform";
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

/** Start one disposable service set, projecting only account observers onto the couch owner.
 * Input and feedback keep the shell's real store rather than acting on another company's grid. */
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
