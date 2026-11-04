import type { ScenarioType } from "../Types";
import type { OfficialScenarioRuleDefinition } from "./OfficialScenarioRules";
import { formatMoneyConcise } from "../helpers/Format";

// 117–125 belong to the Legacy campaign, including generations outside SCENARIOS.
export const CHERNOBYL_SCENARIO_ID = 126;
// UN recovery assessment §2.08: $18bn of rehabilitation spending in 1986–1991.
// Flat six-year average, using the reported historical dollar total at full scale.
export const CHERNOBYL_RECOVERY_MONTHLY_COST = 18000000000 / (6 * 12);

/** A regional recovery model, not a reconstruction of Soviet tariffs or the national grid. */
export const CHERNOBYL_SCENARIO: ScenarioType = {
  id: CHERNOBYL_SCENARIO_ID,
  name: "Chernobyl: Recovery",
  icon: "chernobyl-recovery",
  locationId: "Kyiv",
  location: {
    id: "Kyiv",
    name: "Kyiv, Ukrainian SSR",
    country: "Ukraine",
    region: "Europe",
    lat: 50.4501,
    long: 30.5234,
    timeZone: "Europe/Kyiv",
    resources: { hydro: false },
  },
  summary:
    "March 1986: Chernobyl's disaster is one month away. Restore service and earn the best score you can.",
  threat:
    "Blackouts will cost you points but don't end the game in this scenario. You'll need to avoid bankruptcy while paying for cleanup on the unsellable damaged reactor.",
  themes: ["Energy transition"],
  ownership: "Public",
  startingYear: 1986,
  startingMonth: 3,
  durationMonths: 60,
  reliabilityFailureDisabled: true,
  retainCustomersDuringShortages: true,
  intertiesEnabled: false,
  startingCustomers: 1500000,
  startingDemandScale: 6,
  dollarsPerkWh: 0.065,
  // A recovery reserve makes the historical liability payable; pricing and construction
  // still determine how much of it survives. This opening fund is a gameplay calibration.
  cash: 12000000000,
  feePerKgCO2e: 0,
  // The site's actual four 1,000 MW units. The fossil plants represent regional support.
  // Dollar amounts, customer counts and support capacity are gameplay calibrations.
  facilities: [
    ...[9, 7, 5, 3].map((initialAgeYears, index) => ({
      assetId: `chernobyl-unit-${index + 1}`,
      label: `Chernobyl Unit ${index + 1}`,
      fuel: "Uranium" as const,
      peakW: 1000000000,
      initialAgeYears,
      cashBackMultiplier: 0,
      ...(index === 3
        ? {
            saleRestricted: true,
            maintenanceObligation: {
              startsMonth: 4,
              monthlyCost: CHERNOBYL_RECOVERY_MONTHLY_COST,
              reason: "Cleanup and recovery",
            },
          }
        : {}),
    })),
    {
      assetId: "chernobyl-regional-coal",
      fuel: "Coal",
      peakW: 1000000000,
      initialAgeYears: 16,
    },
    {
      assetId: "chernobyl-regional-oil",
      fuel: "Oil",
      peakW: 250000000,
      initialAgeYears: 10,
    },
  ],
  endTitle: "Five years of recovery",
  endMessage:
    "Your term is over. Review the service you restored, what customers paid and the emissions your grid produced. The disaster's human and environmental consequences continue.",
};

// Official plant chronology: https://www2.chnpp.gov.ua/en/101-2011-06-10-13-28-26
// The monthly simulation applies the April 26 accident to April's representative day.
const phases = [
  {
    id: "disaster",
    title: "The Chernobyl disaster",
    previewTitle: "The Chernobyl disaster",
    message: `Chernobyl's four units are offline after the 26 April 1986 disaster. Unit 4 is permanently lost and cannot be sold. Recovery costs on Unit 4 are ${formatMoneyConcise(CHERNOBYL_RECOVERY_MONTHLY_COST)} a month, even while paused.`,
    preview:
      "The disaster will destroy a reactor and shut down the site's surviving units.",
    startMonth: 4,
    durationMonths: 6,
    offlineUnits: [1, 2, 3, 4],
  },
  {
    id: "unit-one-returns",
    title: "Chernobyl Unit 1 returns",
    previewTitle: "First reactor returning",
    message:
      "Unit 1 restarted on 1 October 1986. Units 2 and 3 remain offline.",
    preview: "The first surviving reactor will return.",
    startMonth: 10,
    durationMonths: 1,
    offlineUnits: [2, 3, 4],
  },
  {
    id: "unit-two-returns",
    title: "Chernobyl Unit 2 returns",
    previewTitle: "Second reactor returning",
    message:
      "Unit 2 restarted on 5 November 1986. Unit 3 remains offline until December 1987.",
    preview: "The second surviving reactor will return.",
    startMonth: 11,
    durationMonths: 13,
    offlineUnits: [3, 4],
  },
  {
    id: "unit-three-returns",
    title: "Chernobyl Unit 3 returns",
    previewTitle: "Last surviving reactor returning",
    message:
      "Unit 3 restarted on 4 December 1987. The three surviving units are available again. Unit 4 will never return.",
    preview:
      "The last surviving reactor will return. The destroyed reactor will remain unavailable.",
    startMonth: 24,
    durationMonths: "untilEnd" as const,
    offlineUnits: [4],
  },
];

export const CHERNOBYL_RULES: OfficialScenarioRuleDefinition = {
  scenarioId: CHERNOBYL_SCENARIO_ID,
  arcId: "chernobyl-recovery",
  definitions: {
    events: phases.map(
      ({ offlineUnits, previewTitle: _previewTitle, ...phase }) => ({
        ...phase,
        visibility: "forecast" as const,
        effects: {
          outputMultipliersBySelector: offlineUnits.map((unit) => ({
            target: {
              selector: "startingAsset" as const,
              assetId: `chernobyl-unit-${unit}`,
            },
            outputMultiplier: 0,
          })),
        },
      }),
    ),
    objectives: [],
  },
  presentation: Object.fromEntries(
    phases.map((phase) => [
      phase.id,
      {
        previewTitle: phase.previewTitle,
        source: {
          kind: "WORLD_EVENT" as const,
          concept: "supply" as const,
          importance: phase.id === "disaster" ? "CRITICAL" : "NOTABLE",
          actionTarget: { card: "FACILITIES" as const, view: "FLEET" as const },
          turningPointPriority: phase.id === "disaster" ? 120 : 90,
        },
      },
    ]),
  ),
};
