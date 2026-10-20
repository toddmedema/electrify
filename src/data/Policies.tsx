import type { PolicyId, PolicyTier } from "../Types";
import { costBetween } from "../helpers/Math";

export const POLICY_IDS: PolicyId[] = [
  "efficiency",
  "solar",
  "timeOfUse",
  "curtailment",
  "thermal",
  "evCharging",
  "battery",
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
  thermal: {
    name: "Smart heating and hot water",
    description:
      "Move eligible heating and hot-water use out of your peak window. Deferred use returns over the next three hours.",
    tradeoff:
      "Comfort limits constrain peak relief. Switching off stops installations and control, but deferred use still returns.",
  },
  evCharging: {
    name: "Managed EV charging",
    description:
      "Move some EV charging out of your peak window and into the next six hours.",
    tradeoff:
      "Drivers can override controls. Delayed charging can create a later peak.",
  },
  battery: {
    name: "Home battery virtual power plant",
    description:
      "Store surplus electricity in household batteries for your peak window.",
    tradeoff:
      "Batteries start empty, lose energy and age. A household reserve limits how much they can supply.",
  },
  timeOfUse: {
    name: "Time-of-use tariff",
    description:
      "Half of homes shift 20% of peak-window use into the next three hours.",
    tradeoff:
      "Participants pay 30% more during the peak window and 10% less for the next three hours. Higher bills can drive customers away; shifted demand can create a later peak.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  curtailment: {
    name: "Peak curtailment contracts",
    description:
      "Half of demand from factories, mines and data centers drops 20% during your peak window.",
    tradeoff:
      "Participants receive a 10% bill credit all day, even without shortages.",
    cap: 0.2,
    costPerCustomer: 0,
  },
  efficiency: {
    name: "Efficiency rebates",
    description:
      "Reduce home and business demand, especially heating and cooling.",
    tradeoff:
      "Upgrades reduce sales as well as generation needs. Savings fade between each upgrade’s tenth and twentieth years.",
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
    description:
      "Reduce daytime demand with rooftop panels. Home batteries can store surplus for later.",
    tradeoff:
      "Panels keep producing without further spending, but do not cover evening peaks alone. Surplus beyond enrolled battery charging is discarded.",
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
