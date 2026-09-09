import type { PolicyId, PolicyTier } from "../Types";

export const POLICY_IDS: PolicyId[] = [
  "efficiency",
  "solar",
  "timeOfUse",
  "curtailment",
];
export const POLICY_TIERS: PolicyTier[] = ["Off", "Small", "Large"];
// Explicit launch availability: modern, longer scenarios and custom games. Historical
// scenarios and introductory tutorials deliberately have no program entry.
export const POLICY_SCENARIOS = [
  100, 101, 104, 105, 106, 107, 108, 110, 111, 999,
];
export const POLICIES = {
  timeOfUse: {
    name: "Time-of-use tariff",
    description:
      "Offer homes and businesses overnight discounts for higher evening rates.",
    mechanism:
      "Small enrolls 25% of homes and businesses; Large enrolls 50%. Participants pay 30% more from 17:00–21:00, 10% less from 00:00–06:00, and the base rate otherwise. They forgo 20% of evening consumption by avoiding discretionary uses; this energy is not shifted to another hour.",
    tradeoff:
      "Rates apply only to enrolled residential and commercial consumption actually supplied. Higher evening bills can affect customer retention. Fixed local-clock windows may miss your seasonal peak.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  curtailment: {
    name: "Peak curtailment contracts",
    description:
      "Credit industrial users and data centers for scheduled evening curtailment.",
    mechanism:
      "Small enrolls 25% of industrial and data-center load; Large enrolls 50%. Enrolled loads forgo 20% of consumption from 17:00–21:00 every day (four hours maximum), for a 10% bill credit on their electricity actually supplied throughout the day. This is scheduled curtailment, even without a shortage.",
    tradeoff:
      "Credits reduce sales revenue, including outside the curtailment window. Curtailment is agreed service, not a blackout. Contracts do not affect homes, businesses or transport, and do nothing without eligible industrial or data-center load.",
    cap: 0.2,
    costPerCustomer: 0,
  },
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
