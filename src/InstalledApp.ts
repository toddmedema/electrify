/** Installed web apps use standalone display mode, or Safari's home-screen flag on iOS. */
export function isInstalledWebApp(): boolean {
  return Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches,
  );
}
