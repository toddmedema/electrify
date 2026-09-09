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
      "Move home electricity use to later in the evening in exchange for a discount.",
    mechanism:
      "When on, half of homes participate. They shift 20% of their 17:00–21:00 electricity use to 21:00–24:00, such as charging cars later. Participants pay 30% more during the peak and 10% less afterward. Total energy use is unchanged.",
    tradeoff:
      "Rates apply only to enrolled residential consumption actually supplied. Higher evening bills can affect customer retention. Fixed local-clock windows may miss your seasonal peak.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  curtailment: {
    name: "Peak curtailment contracts",
    description:
      "Pay industrial users and data centers to use less electricity during the evening peak. This load is eliminated.",
    mechanism:
      "When on, half of industrial and data-center load participates. Enrolled loads forgo 20% of consumption from 17:00–21:00 every day (four hours maximum), for a 10% bill credit on their electricity actually supplied throughout the day. This is scheduled curtailment, even without a shortage.",
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
