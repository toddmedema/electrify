const sources = new Map<string, string>();
/** Reuse the HTML's inline artwork as a contentful image without another network request. */
export function homeLogoSource(mode: "light" | "dark"): string {
  const existing = sources.get(mode);
  if (existing) return existing;
  const artwork = document.getElementById("electrify-wordmark")?.innerHTML;
  if (!artwork)
    return mode === "dark"
      ? "/images/logo-home-dark.svg"
      : "/images/logo-home.svg";
  const color = mode === "dark" ? "#629be1" : "#0084f8";
  const source =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 70" color="${color}">${artwork}</svg>`,
    );
  sources.set(mode, source);
  return source;
}
