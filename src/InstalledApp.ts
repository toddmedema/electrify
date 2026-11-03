/** Installed web apps use standalone display mode, or Safari's home-screen flag on iOS. */
export function isInstalledWebApp(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;
  return Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches,
  );
}
