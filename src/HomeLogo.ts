const sources = new Map<string, string>();
/** Reuse the HTML's inline artwork as a contentful image without another network request. */
export function homeLogoSource(mode: "light" | "dark"): string {
  const existing = sources.get(mode);
  if (existing) return existing;
  const base = document.body.dataset.homeLogo;
  if (!base)
    return mode === "dark"
      ? "/images/logo-home-dark.svg"
      : "/images/logo-home.svg";
  const source =
    mode === "dark" ? base.replace(/%230084f8/g, "%23629be1") : base;
  sources.set(mode, source);
  return source;
}
