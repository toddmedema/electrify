import { hasStoredWebAccount } from "./WebAuth";

export async function canStartLightweightHome(): Promise<boolean> {
  if (
    window.location.pathname !== "/" ||
    window.location.search ||
    window.location.hash
  )
    return false;
  // Safari's install instructions live in the normal menu; retain that flow on Apple touch devices.
  if (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return false;
  try {
    if (
      (navigator as Navigator & { standalone?: boolean }).standalone ||
      window.matchMedia("(display-mode: standalone)").matches
    )
      return false;
    // Preserve returning players' saves, tutorial progress, account, audio and preferences.
    // Unavailable inventory APIs use the normal app rather than guessing whether saves exist.
    if (!indexedDB.databases || localStorage.getItem("audioEnabled") === "true")
      return false;
    for (const key of [
      "plays",
      "interfaceScale",
      "screenEdgePadding",
      "workspace",
    ]) {
      if (localStorage.getItem(key) !== null) return false;
    }
    const databases = await indexedDB.databases();
    if (databases.some((db) => db.name === "electrify-saves")) return false;
    return !(await hasStoredWebAccount());
  } catch {
    return false;
  }
}
