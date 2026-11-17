/** Reuse the early HTML request, including desktop builds with a relative asset root. */
export function homeLogoSource(mode: "light" | "dark"): string {
  const source =
    (typeof document === "undefined"
      ? undefined
      : document.body.dataset.homeLogo) || "/images/logo-home.svg";
  return mode === "dark"
    ? source.replace("logo-home.svg", "logo-home-dark.svg")
    : source;
}
