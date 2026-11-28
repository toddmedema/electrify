export const UTILITY_LOGOS = [
  { id: "sunburst", name: "Sunburst" },
  { id: "clipped-bolt", name: "Clipped bolt" },
  { id: "grid-pylon", name: "Grid pylon" },
  { id: "turbine-rotor", name: "Turbine rotor" },
  { id: "geothermal-plume", name: "Geothermal plume" },
  { id: "heavy-flywheel", name: "Heavy flywheel" },
  { id: "riven-peak", name: "Riven Peak" },
  { id: "starharbor", name: "Starharbor" },
  { id: "spanford", name: "Spanford" },
  { id: "pinesward", name: "Pinesward" },
  { id: "northmere", name: "Northmere" },
  { id: "lowreach", name: "Lowreach" },
] as const;

export type UtilityLogoId = (typeof UTILITY_LOGOS)[number]["id"];
export type UtilityLogoClaims = Readonly<Record<string, UtilityLogoId>>;

const byId = new Map<string, (typeof UTILITY_LOGOS)[number]>(
  UTILITY_LOGOS.map((logo) => [logo.id, logo]),
);

// The save upgrade accepts these former choices without putting them back in the picker.
const retiredUtilityLogos = new Set([
  "reservoir-spillway",
  "hookwater",
  "dawnshore",
  "beaconfell",
  "cell-stack",
  "stonestep",
  "switch-contacts",
  "transformer-coil",
]);

export const isRetiredUtilityLogo = (value: unknown): boolean =>
  typeof value === "string" && retiredUtilityLogos.has(value);

export const isUtilityLogo = (value: unknown): value is UtilityLogoId =>
  typeof value === "string" && byId.has(value);

export const utilityLogoName = (id: UtilityLogoId) => byId.get(id)!.name;

export const utilityLogoSrc = (id: UtilityLogoId) =>
  `/images/utility-logos/${id}.svg`;

export function validUtilityLogoRoster(
  seats: readonly { utilityLogo?: unknown }[],
): boolean {
  const seen = new Set<UtilityLogoId>();
  for (const { utilityLogo } of seats) {
    if (utilityLogo === undefined) continue;
    if (!isUtilityLogo(utilityLogo) || seen.has(utilityLogo)) return false;
    seen.add(utilityLogo);
  }
  return true;
}

export function validUtilityLogoClaims(
  value: unknown,
): value is UtilityLogoClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = Object.entries(value);
  return (
    claims.length <= 4 &&
    claims.every(
      ([id, logo]) => /^[a-zA-Z0-9-]{1,64}$/.test(id) && isUtilityLogo(logo),
    ) &&
    new Set(claims.map(([, logo]) => logo)).size === claims.length
  );
}

export const claimedUtilityLogo = (claims: UtilityLogoClaims, id: string) =>
  Object.hasOwn(claims, id) ? claims[id] : undefined;

/** Check a claim against the current owner before replacing any existing choice. */
export function updateUtilityLogoClaim(
  claims: UtilityLogoClaims,
  id: string,
  logo: UtilityLogoId | null,
): UtilityLogoClaims | undefined {
  if (
    logo &&
    Object.entries(claims).some(
      ([seat, value]) => seat !== id && value === logo,
    )
  )
    return undefined;
  const next = Object.entries(claims).filter(([seat]) => seat !== id);
  if (logo) next.push([id, logo]);
  return Object.fromEntries(next);
}
