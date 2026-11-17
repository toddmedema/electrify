import { hasStoredWebAccount } from "./WebAuth";

export async function canStartLightweightHome(): Promise<boolean> {
  if (
    window.location.pathname !== "/" ||
    window.location.search ||
    window.location.hash
  )
    return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    // Preserve returning players' saves, account restoration, audio and stored preferences.
    // Unavailable inventory APIs use the normal app rather than guessing whether saves exist.
    if (!indexedDB.databases || localStorage.getItem("audioEnabled") === "true")
      return false;
    for (const key of [
      "interfaceScale",
      "textSize",
      "tvMode",
      "tvScale",
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
