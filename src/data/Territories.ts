import type { TerritoryId } from "../Types";

export const GREEN_UPLANDS_CORRIDOR_ID = "vt-champlain-uplands";
export type TerritorySiteKind = "industrial" | "wind" | "open-land";
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
  sites: Readonly<Record<TerritorySiteKind, TerritorySiteBudget>>;
}
const sites = (industrial: number, wind: number, openLand: number) => ({
  industrial: { count: industrial, maxPeakW: 300e6 },
  wind: { count: wind, maxPeakW: 150e6 },
  "open-land": { count: openLand, maxPeakW: 150e6 },
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
    name: "Green Uplands",
    description:
      "Buy undeveloped land for wind, solar and storage. No customers or plants transfer.",
    kind: "greenfield",
    corridorId: GREEN_UPLANDS_CORRIDOR_ID,
    sites: sites(0, 4, 3),
  },
];

export function isTerritoryId(value: unknown): value is TerritoryId {
  return TERRITORIES.some(({ id }) => id === value);
}
