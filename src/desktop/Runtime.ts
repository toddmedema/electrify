import type { AppStore } from "../Store";
import { getDesktop } from "../Desktop";
import { initializeDesktopSaves } from "../DesktopSaves";
import { startDesktopActivity } from "../DesktopActivity";
import { startDesktopFeedback } from "../audio/DesktopFeedback";
import { achievementHooks } from "./Achievements";
import { installSimulationHooks } from "./SimulationHooks";
import { startAchievements } from "./AchievementObserver";

/** One Electron-only chunk owns native services and simulation instrumentation. */
export async function initializeDesktop(): Promise<void> {
  installSimulationHooks(achievementHooks);
  await initializeDesktopSaves();
}

export function startDesktopServices(store: AppStore): () => void {
  const desktop = getDesktop();
  if (!desktop) return () => {};
  const stops = [
    startDesktopActivity(store, desktop),
    startDesktopFeedback(store),
    startAchievements(store, desktop),
  ];
  return () => stops.forEach((stop) => stop());
}
