import type { PolicyId, PolicyTier } from "../Types";
import { costBetween } from "../helpers/Math";

export const POLICY_IDS: PolicyId[] = [
  "efficiency",
  "solar",
  "timeOfUse",
  "curtailment",
];
export const POLICY_TIERS: PolicyTier[] = ["Off", "On"];
// Explicit launch availability: longer scenarios from 2000 on, and custom games. Earlier
// historical scenarios and introductory tutorials deliberately have no program entry. Rooftop
// solar prices follow the year, so the early-2000s scenarios pay the era's much higher cost.
export const POLICY_SCENARIOS = [
  100, 101, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115, 999,
];
// Both rebate programs are one-time projects: they install a fixed pool of upgrades, then stop.
// Leading U.S. efficiency programs save roughly 2-3% of sales a year (ACEEE state scorecards), so
// four years is the pace at which the pools below are plausible for a single utility.
const BUILDOUT_MONTHS = 48;
// Efficiency upgrades wear out. LBNL reports program-weighted measure lives of about 11-13 years;
// savings hold for ten years, then fade linearly to nothing at twenty.
const EFFICIENCY_FULL_LIFE_MONTHS = 120;
const EFFICIENCY_END_LIFE_MONTHS = 240;
export const POLICIES = {
  timeOfUse: {
    name: "Time-of-use tariff",
    description:
      "Shift home electricity use out of chosen peak hours for a discount.",
    mechanism:
      "When on, half of homes participate. Choose a four-hour daily window: participants shift 20% of that electricity use into the following three hours, such as charging cars later. They pay 30% more during the chosen peak window and 10% less during the following three hours. Total energy use is unchanged, including across midnight.",
    tradeoff:
      "Rates apply only to enrolled residential consumption actually supplied. Higher bills can affect customer retention. Compare the forecast: shifted consumption can create a later peak.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  curtailment: {
    name: "Peak curtailment contracts",
    description:
      "Pay industry and data centers to cut use during chosen peak hours. This use is eliminated.",
    mechanism:
      "When on, half of industrial and data-center load participates. Enrolled loads forgo 20% of consumption during your chosen four-hour daily window, for a 10% bill credit on their electricity actually supplied throughout the day. This is scheduled curtailment, even without a shortage.",
    tradeoff:
      "Credits reduce sales revenue, including outside the curtailment window. Curtailment is agreed service, not a blackout. Contracts do not affect homes, businesses or transport, and do nothing without eligible industrial or data-center load.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  efficiency: {
    name: "Efficiency rebates",
    description: "Help homes and businesses use less electricity.",
    mechanism: `A one-time project that funds upgrades over ${BUILDOUT_MONTHS} months. Savings grow as upgrades are installed and are largest for heating and cooling, so they matter most in hot or cold climates. Upgrades wear out: savings fade after ${EFFICIENCY_FULL_LIFE_MONTHS / 12} years and end at ${EFFICIENCY_END_LIFE_MONTHS / 12}.`,
    tradeoff:
      "Upgrades cost money and reduce sales, but can lower generation costs and improve reliability.",
    // At full adoption: lighting and appliance upgrades cut all home and business use, while
    // insulation, sealing and efficient heat pumps cut the weather-driven part of it much more.
    // DOE's Weatherization Assistance Program evaluations report heating and cooling savings of
    // roughly a quarter to a third per home.
    applianceSaving: 0.1,
    weatherSaving: 0.35,
    // Total per starting customer over the whole build-out. About 2-3.5 cents per lifetime kWh
    // saved in play, against LBNL's 2.4-2.5 cent program administrator cost of saved electricity.
    costPerCustomer: 60,
    buildoutMonths: BUILDOUT_MONTHS,
    fullLifeMonths: EFFICIENCY_FULL_LIFE_MONTHS,
    endLifeMonths: EFFICIENCY_END_LIFE_MONTHS,
  },
  solar: {
    name: "Rooftop solar rebates",
    description: "Help customers make electricity during daylight.",
    mechanism: `A one-time project that funds rooftop panels over ${BUILDOUT_MONTHS} months. Output grows as panels are installed and continues with no further cost after completion. Helps in daylight; does not directly cover an evening peak.`,
    tradeoff:
      "Rebates cost money and reduce sales. Surplus is discarded, with no export payments or utility generation credits.",
    // Watts per starting customer, scaled with scenario demand, at full adoption. The California
    // Solar Initiative, among the largest rebate programs, funded about 1.9 GW across roughly 12
    // million utility customers - about 160 W each.
    cap: 150,
    // Utility rebates typically covered about a quarter of a residential system's installed price;
    // customers and tax credits paid the rest. The price itself follows the installation year.
    rebateShare: 0.25,
    // Only about half of residential systems face south (LBNL Tracking the Sun 2024), and roofs
    // add shading and soiling losses that ground-mounted utility plants avoid.
    derate: 0.9,
    buildoutMonths: BUILDOUT_MONTHS,
  },
} as const;

/**
 * Median installed price of a residential rooftop system, in 2023 dollars per watt, from LBNL's
 * Tracking the Sun 2024: about $14 in 2000, $8.5 in 2010 and $4.2 in 2023. Soft costs - permits,
 * customer acquisition and installation labor - dominate now, so later years decline gently rather
 * than following the utility-scale learning curve. The 2030 figure is a game assumption.
 */
export function residentialSolarCostPerW(year: number): number {
  if (year <= 2010) return costBetween(year, 2000, 14, 2010, 8.5);
  if (year <= 2023) return costBetween(year, 2010, 8.5, 2023, 4.2);
  return costBetween(year, 2023, 4.2, 2030, 3.6);
}
