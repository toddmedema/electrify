import type { LandTerritoryId, TerritoryId } from "../Types";

export const GREEN_UPLANDS_CORRIDOR_ID = "vt-champlain-uplands";
export type TerritorySiteKind =
  "industrial" | "wind" | "open-land" | "general" | "hydro" | "geothermal";
export interface TerritorySiteBudget {
  count: number;
  maxPeakW: number;
}
export interface TerritoryDefinition {
  id: TerritoryId;
  name: string;
  description: string;
  kind: "home" | "utility" | "greenfield";
  corridorId?: string;
  benefit?: "general" | "residential" | "industrial" | "hydro" | "geothermal";
  price2005?: number;
  customers?: number;
  /** Relative per-account load; industrial connections are larger than households. */
  customerLoadMultiplier?: number;
  sites: Readonly<Record<TerritorySiteKind, TerritorySiteBudget>>;
}
const sites = (industrial: number, wind: number, openLand: number) => ({
  industrial: { count: industrial, maxPeakW: 300e6 },
  wind: { count: wind, maxPeakW: 150e6 },
  "open-land": { count: openLand, maxPeakW: 150e6 },
  general: { count: 0, maxPeakW: 300e6 },
  hydro: { count: 0, maxPeakW: 20e6 },
  geothermal: { count: 0, maxPeakW: 25e6 },
});

/** Fictional project budgets, including inherited non-hydro projects. Hydro keeps named sites. */
export const TERRITORIES: readonly TerritoryDefinition[] = [
  {
    id: "champlain",
    name: "Champlain",
    description:
      "Your home service territory. All owned facilities serve one company power pool.",
    kind: "home",
    sites: sites(7, 3, 3),
  },
  {
    id: "valley-electric",
    name: "Valley Electric",
    description:
      "Acquire a residential and commercial utility with plants and dated power agreements.",
    kind: "utility",
    corridorId: "vt-champlain-valley",
    sites: sites(5, 3, 3),
  },
  {
    id: "ridge-electric",
    name: "Ridge Electric",
    description:
      "Acquire an industrial utility with inherited wind and thermal plants.",
    kind: "utility",
    corridorId: "vt-champlain-ridge",
    sites: sites(5, 3, 3),
  },
  {
    id: "green-uplands",
    name: "Open land",
    description: "Buy general building land. No customers or plants transfer.",
    kind: "greenfield",
    corridorId: GREEN_UPLANDS_CORRIDOR_ID,
    benefit: "general",
    price2005: 18e6,
    sites: { ...sites(0, 0, 0), general: { count: 7, maxPeakW: 300e6 } },
  },
  ...Array.from({ length: 18 }, (_, index): TerritoryDefinition => {
    const benefit =
      index === 1 || index === 9
        ? "residential"
        : index === 5 || index === 11
          ? "industrial"
          : index === 7 || index === 15
            ? "hydro"
            : index === 3 || index === 13
              ? "geothermal"
              : "general";
    const name =
      benefit === "residential"
        ? "Residential customers"
        : benefit === "industrial"
          ? "Industrial customers"
          : benefit === "hydro"
            ? "Hydro site"
            : benefit === "geothermal"
              ? "Geothermal site"
              : "Open land";
    const budget = sites(0, 0, 0);
    if (benefit === "general") budget.general.count = 2;
    if (benefit === "hydro" || benefit === "geothermal")
      budget[benefit].count = 1;
    return {
      id: `parcel-${index}` as LandTerritoryId,
      name,
      kind: "greenfield",
      benefit,
      price2005:
        benefit === "residential"
          ? 32e6
          : benefit === "industrial"
            ? 12e6
            : benefit === "hydro"
              ? 16e6
              : benefit === "geothermal"
                ? 14e6
                : 6e6,
      customers:
        benefit === "residential" ? 16000 : benefit === "industrial" ? 400 : 0,
      customerLoadMultiplier: benefit === "industrial" ? 20 : 1,
      description:
        benefit === "residential"
          ? "Connect 16,000 residential customers. No plants or building sites transfer."
          : benefit === "industrial"
            ? "Connect 400 industrial customers. No plants or building sites transfer."
            : benefit === "hydro"
              ? "One fictional 20 MW hydro development site. Construction and water limits still apply."
              : benefit === "geothermal"
                ? "One fictional 25 MW underground heat site. Build a geothermal plant to use it."
                : "Two general building sites for generators or storage.",
      sites: budget,
    };
  }),
];

export const LAND_TERRITORIES = TERRITORIES.filter(
  (territory) => territory.kind === "greenfield",
);
export function isLandTerritoryId(value: unknown): value is LandTerritoryId {
  return LAND_TERRITORIES.some(({ id }) => id === value);
}
export const territoryHydroSiteId = (id: TerritoryId) =>
  `scenario-116-${id}-hydro`;

export function isTerritoryId(value: unknown): value is TerritoryId {
  return TERRITORIES.some(({ id }) => id === value);
}

/** Catalogue access shared by quotes and purchase validation; construction reserves the site. */
export function availableTerritorySpecialSites(
  game: Pick<
    import("../Types").GameType,
    "territoryNetwork" | "facilities" | "commissionedHydroSiteIds"
  >,
  benefit: "hydro" | "geothermal",
  id?: TerritoryId,
) {
  return LAND_TERRITORIES.filter(
    (territory) =>
      territory.benefit === benefit &&
      (!id || territory.id === id) &&
      Array.isArray(game.territoryNetwork?.landPurchases) &&
      game.territoryNetwork.landPurchases.some(
        (receipt) => receipt.territoryId === territory.id,
      ) &&
      !game.facilities.some(
        (facility) =>
          facility.territoryId === territory.id &&
          (benefit === "hydro"
            ? facility.fuel === "Hydro" && facility.peakWh === undefined
            : facility.fuel === "Geothermal"),
      ) &&
      (benefit !== "hydro" ||
        !game.commissionedHydroSiteIds.includes(
          territoryHydroSiteId(territory.id),
        )),
  );
}
