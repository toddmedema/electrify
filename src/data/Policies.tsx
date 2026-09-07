import type { PolicyId, PolicyTier } from "../Types";

export const POLICY_IDS: PolicyId[] = ["efficiency", "solar"];
export const POLICY_TIERS: PolicyTier[] = ["Off", "Small", "Large"];
// Explicit launch availability: modern, longer scenarios and custom games. Historical
// scenarios and introductory tutorials deliberately have no program entry.
export const POLICY_SCENARIOS = [
  100, 101, 104, 105, 106, 107, 108, 110, 111, 999,
];
export const POLICIES = {
  efficiency: {
    name: "Efficiency rebates",
    description: "Help homes and businesses use less electricity.",
    mechanism:
      "Grows gradually. Reduces residential and commercial electricity use throughout the day.",
    tradeoff:
      "Upgrades cost money and mean less electricity sold, in exchange for avoided generation costs and possible reliability benefits.",
    cap: 0.2,
    costPerCustomer: 30,
  },
  solar: {
    name: "Rooftop solar rebates",
    description: "Help customers make electricity during daylight.",
    mechanism:
      "Grows gradually. Helps in daylight; does not directly cover an evening peak.",
    tradeoff:
      "Rebates cost money and mean less electricity sold. Surplus is curtailed: there are no export payments or utility generation credits.",
    cap: 300, // Watts per initial market customer, scaled with scenario demand, at full adoption.
    costPerCustomer: 60,
  },
} as const;
// Large buys more absolute adoption, at a higher cost per extra installation.
export const POLICY_FUNDING = {
  Off: { adoption: 0, cost: 0 },
  Small: { adoption: 0.02, cost: 0.02 },
  Large: { adoption: 0.05, cost: 0.07 },
} as const;
