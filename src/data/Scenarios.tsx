import { UTILITY_AREAS } from "./UtilityExpansion";
import { CHERNOBYL_SCENARIO } from "./ChernobylScenario";
import { LEGACY_CAMPAIGN_ID, LEGACY_SCENARIOS } from "./LegacyCampaign";
import { officialRetentionMetadata } from "./OfficialScenarioRules";
import {
  prepareStorageReorder,
  tutorialInspectedMapFacility,
  tutorialRaisedMapTool,
  tutorialRateCommitted,
} from "../reducers/GameActions";
import * as React from "react";
import CustomerGrowthChallenge from "../components/base/CustomerGrowthChallenge";

import TutorialPrompt from "../components/base/TutorialPrompt";
import {
  AppStateType,
  GameType,
  ScenarioType,
  TutorialStepType,
  TutorialUiIdType,
} from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";

const MISSION_ONE_PAUSED: TutorialUiIdType[] = [
  "menu",
  "speed",
  "facilityActions",
  "yearProgress",
];

const SLOW_CLOCK = '#speedChangeButtons [aria-label="slow speed"]';
const MAP_COAL = '[data-map-facility="Coal"][data-owned="true"]';
const BUILD_DOCK = '.button-buildFacility:not([aria-expanded="true"])';
const PROJECT_PAYMENT =
  ".projectCandidateActions button:is(.MuiButton-contained, .MuiButton-outlined):enabled";
const OWNED_PROJECT_SITE = '[data-project-site="owned"]';

function projectTarget(technology: string) {
  return [
    `${technology}:not([aria-disabled="true"])`,
    `.territoryNetwork:not(:has(.projectCandidateActions)) ${OWNED_PROJECT_SITE}`,
    PROJECT_PAYMENT,
  ].join(", ");
}

const hasBlackout = (state: AppStateType) =>
  state.game.eventLog.some((event) => event.kind === "BLACKOUT");

const generatorCapstoneSucceeded = (state: AppStateType) => {
  // Mission 2 starts with ID 1. Purchases go to the top and players can reorder.
  const playerBuiltGeneratorTypes = state.game.facilities
    .filter((facility) => facility.id > 1)
    .flatMap((facility) => ("fuel" in facility ? [facility.name] : []));
  return new Set(playerBuiltGeneratorTypes).size >= 2;
};

const latestMonthProfit = (state: AppStateType) => {
  const month = state.game.monthlyHistory[0];
  return month
    ? month.revenue -
        month.expensesFuel -
        month.expensesOM -
        month.expensesCarbonFee -
        month.expensesInterest -
        (month.expensesPolicy || 0)
    : undefined;
};

const storageCapstoneSucceeded = (state: AppStateType) => {
  // Early peaks may black out during construction. A fully supplied day after storage
  // has charged and discharged proves recovery, even if another purchase is still building.
  return (
    (state.game.monthlyHistory[0]?.minimumSupplyMarginW ?? -1) >= 0 &&
    state.game.facilities.some(
      (facility) =>
        "currentWh" in facility &&
        facility.yearsToBuildLeft <= 0 &&
        facility.lifetimeWh > 0,
    )
  );
};

const financesCapstoneSucceeded = (state: AppStateType) =>
  state.game.date.monthsElapsed >= 1 &&
  (latestMonthProfit(state) || 0) > 0 &&
  !hasBlackout(state);

const pricingReachedCustomerTarget = ({ game }: AppStateType) =>
  (getTimeFromTimeline(game.date.minute, game.timeline)?.customers ?? 0) >=
  (game.customerMarketSize / 2) * 1.05;

const pricingCapstoneSucceeded = (state: AppStateType) =>
  state.game.date.monthsElapsed >= 6 &&
  state.game.dollarsPerkWh < 0.07 &&
  pricingReachedCustomerTarget(state) &&
  (latestMonthProfit(state) ?? 0) > 0 &&
  !hasBlackout(state);

const pricingCapstoneFailure = (state: AppStateType) => {
  if (hasBlackout(state))
    return "A blackout occurred. Add enough supply to serve your customers.";
  const missedTarget = !pricingReachedCustomerTarget(state);
  const unprofitable = (latestMonthProfit(state) ?? 0) <= 0;
  if (missedTarget && unprofitable)
    return "You missed the customer target, and the last month was unprofitable. Try a rate that attracts customers and covers costs.";
  if (missedTarget)
    return "You missed the customer target. Try lowering your rate to attract more customers.";
  if (unprofitable)
    return state.game.dollarsPerkWh >= 0.07
      ? "Your last month was unprofitable. Reduce costs so you can make a profit below 7¢ per kWh."
      : "Your last month was unprofitable. Try raising your rate to cover costs.";
  return "Your final rate was too high. Finish below 7¢ per kWh.";
};

const isForecastingProject = (facility: GameType["facilities"][number]) =>
  facility.startingAssetId === undefined && !("currentWh" in facility);

const forecastingCapstoneSucceeded = (state: AppStateType) =>
  state.game.date.monthsElapsed >= 8 &&
  state.game.facilities.some(
    (facility) =>
      isForecastingProject(facility) && facility.yearsToBuildLeft <= 0,
  ) &&
  !hasBlackout(state);

const acceptedAgreement = (s: AppStateType) =>
  (s.game.transmission?.acceptedAgreements?.length ?? 0) > 0;

const hasImportedFromAgreement = ({ game }: AppStateType) => {
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  return (
    (now?.importedW ?? 0) > 0 &&
    !!game.transmission?.acceptedAgreements?.some(
      ({ blockId, cycle }) =>
        (now?.agreementUsefulMWh?.[`${blockId}:${cycle}`] ?? 0) > 0,
    )
  );
};

// Order sets the menu and tutorial sequence; ids are persisted, so never renumber them
export const SCENARIOS: ScenarioType[] = [
  {
    id: 0,
    name: "Mission 1: Electricity",
    icon: "solar",
    summary: "Meet your grid",
    locationId: "SF",
    ownership: "Investor",
    // Capstone retries rebuild the exact same weather, demand and market conditions.
    seed: 249001,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to keep electricity supply above demand as the day changes.",
    facilities: [
      // Coal rather than gas: it cannot turn down below its minimum output, so the midday sun
      // pushes supply visibly above demand instead of hiding the supply line under it. Sized so
      // it still ramps fast enough to cover the evening without a shortfall.
      {
        assetId: "scenario-0-coal",
        fuel: "Coal",
        peakW: 600000000,
        initialAgeYears: 12,
      },
      {
        assetId: "scenario-0-sun",
        fuel: "Sun",
        peakW: 600000000,
        initialAgeYears: 5,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        hideUi: MISSION_ONE_PAUSED,
        target: MAP_COAL,
        advanceOnAction: (action, s) =>
          tutorialInspectedMapFacility.match(action) &&
          s.game.facilities.some(
            (facility) =>
              facility.id === action.payload &&
              facility.startingAssetId === "scenario-0-coal",
          ),
        action: "Inspect the coal plant on the map",
        content: (
          <TutorialPrompt text="You run a power company. Keep the lights on and pay your bills. Select the highlighted coal plant to see its output." />
        ),
      },
      {
        target: "#fleetNav",
        revealActions: ["FLEET"],
        hideUi: MISSION_ONE_PAUSED,
        advanceOn: (s) => s.card.name === "FLEET",
        action: "Open Fleet",
        content: (
          <TutorialPrompt text="The map shows where your plants are. Fleet puts their output and the grid’s demand in one place." />
        ),
      },
      {
        card: "FLEET",
        target: "#chartSupplyDemand",
        hideUi: MISSION_ONE_PAUSED,
        continueOnClick: "#chartSupplyDemand",
        action: "Select the supply and demand chart",
        content: (
          <TutorialPrompt text="The shaded areas show power from solar and coal. Keep their combined supply at or above the demand line to avoid blackouts." />
        ),
      },
      {
        card: "FLEET",
        target: SLOW_CLOCK,
        hideUi: ["menu", "facilityActions", "yearProgress"],
        advanceOn: (s) => s.game.speed !== "PAUSED",
        action: "Start the clock",
        content: (
          <TutorialPrompt text="Choose slow speed. Watch how the grid changes as the city wakes up." />
        ),
      },
      {
        card: "FLEET",
        action: "Reach midnight without a blackout",
        content: (
          <TutorialPrompt text="Solar fades in the evening, so coal picks up the load. The grid status at the top warns you when spare power is low." />
        ),
        capstone: {
          preserveProgress: true,
          success: (s) => s.game.date.minute >= 1440 && !hasBlackout(s),
          failure: hasBlackout,
          successMessage:
            "You kept the lights on through a full day. Next, build a plant of your own.",
          failureMessage:
            "Demand exceeded supply. Watch the supply and demand lines as you try again.",
        },
      },
    ],
  },
  {
    id: 1,
    name: "Mission 2: Generators",
    icon: "natural gas peaker",
    summary: "Build a generator",
    locationId: "SF",
    ownership: "Investor",
    seed: 249002,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to select and build generators that complement your grid’s needs.",
    facilities: [
      {
        assetId: "scenario-1-coal",
        fuel: "Coal",
        peakW: 600000000,
        initialAgeYears: 15,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        revealActions: ["BUILD_GENERATORS"],
        target: `${BUILD_DOCK}, ${projectTarget('[aria-label="Pick site for Natural Gas Peaker"]')}`,
        desktop: {
          target: projectTarget(
            '[aria-label="Choose sites for Natural Gas Peaker"]',
          ),
          content: (
            <TutorialPrompt text="Choose a Natural Gas Peaker in the build rail, select a highlighted connected site, then choose Cash or Loan." />
          ),
        },
        advanceOn: (s) =>
          s.game.facilities.some(({ name }) => name === "Natural Gas Peaker"),
        action: "Build a gas peaker",
        content: (
          <TutorialPrompt text="Open Build. Pick a site for Natural Gas Peaker, select a highlighted connected tile, then choose Cash or Loan." />
        ),
      },
      {
        card: "FACILITIES",
        target: SLOW_CLOCK,
        advanceOn: ({ game }) =>
          game.speed === "SLOW" &&
          game.facilities.some(
            ({ name, minuteCreated }) =>
              name === "Natural Gas Peaker" && game.date.minute > minuteCreated,
          ),
        action: "Select 1× to watch construction advance",
        content: (
          <TutorialPrompt text="Watch your peaker’s progress on the map. It will supply power once construction finishes." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Build a second type of generator",
        content: (
          <TutorialPrompt text="Try Solar to complement your peaker. It produces power in daylight without buying fuel. Compare cost and output before you pick a site." />
        ),
        capstone: {
          preserveProgress: true,
          success: generatorCapstoneSucceeded,
          successMessage: "You planned two projects with different strengths.",
          failureMessage:
            "Order a different generator type from your first purchase. Your starting coal plant does not count.",
        },
      },
    ],
  },
  {
    id: 2,
    name: "Mission 3: Storage",
    icon: "pumped hydro",
    summary: "Store energy for later",
    locationId: "SF",
    ownership: "Investor",
    seed: 249003,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 24, // Initial forecast span; the capstone has no time limit.
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to store spare electricity and use it to cover peak demand.",
    facilities: [
      {
        assetId: "scenario-2-pumped-hydro",
        name: "Pumped Hydro",
        peakWh: 500000000,
        initialAgeYears: 35,
        saleRestricted: true,
      },
      {
        assetId: "scenario-2-coal",
        fuel: "Coal",
        peakW: 480000000,
        initialAgeYears: 25,
        saleRestricted: true,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        target: `${BUILD_DOCK}, #tab-BUILD_STORAGE:not([aria-selected="true"]), [aria-label="Pick site for Lithium Battery"]:not([aria-disabled="true"])`,
        desktop: {
          target:
            '[aria-label="Choose sites for Battery"]:not([aria-disabled="true"])',
          content: (
            <TutorialPrompt text="Choose Battery in the build rail, then pick a highlighted connected site. Storage saves spare electricity for busier hours." />
          ),
        },
        advanceOn: (s) =>
          s.game.facilities.some(({ name }) => name === "Battery"),
        action: "Build a battery",
        content: (
          <TutorialPrompt text="Open Build and choose Storage, then pick a connected site for Lithium Battery. Storage saves spare electricity for busier hours." />
        ),
      },
      {
        target: "#fleetNav",
        advanceOn: (s) => s.card.name === "FLEET",
        action: "Open Fleet to see how storage works",
        content: (
          <TutorialPrompt text="MW is how fast storage can charge or discharge. MWh is how much energy it can hold." />
        ),
      },
      {
        card: "FLEET",
        target: '.facilityRow[data-facility="Pumped Hydro"] .facilityRowHeader',
        phase: "STORAGE_ORDER_PREPARE",
        onNext: () => prepareStorageReorder(),
        action: "Find Pumped Hydro’s charge level",
        content: (
          <TutorialPrompt text="The vertical bar shows how much energy is stored. The dispatch order determines which plants serve first." />
        ),
      },
      {
        card: "FLEET",
        target: '[aria-label="Reorder Coal"]',
        advanceOn: (s) => {
          const coal = s.game.facilities.findIndex(
            (f) => f.startingAssetId === "scenario-2-coal",
          );
          const hydro = s.game.facilities.findIndex(
            (f) => f.startingAssetId === "scenario-2-pumped-hydro",
          );
          return coal >= 0 && hydro >= 0 && coal < hydro;
        },
        action: "Move Coal above Pumped Hydro",
        content: (
          <TutorialPrompt text="Use Coal’s reorder handle to move it up. Spare generation can then charge Pumped Hydro." />
        ),
      },
      {
        card: "FLEET",
        nextLabel: "Start final challenge",
        action: "Try a grid with only coal",
        content: (
          <TutorialPrompt text="Starting the challenge resets your grid to a single coal plant. Use storage to cover the daily peak." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Cover peak demand with storage",
        content: (
          <TutorialPrompt text="Build a big enough battery and fast-forward time until it covers the daily peak." />
        ),
        capstone: {
          checkpoint: {
            facilities: [
              { fuel: "Coal", peakW: 390000000, initialAgeYears: 25 },
            ],
          },
          success: storageCapstoneSucceeded,
          successMessage:
            "You stored spare electricity and used it to cover peak demand.",
          failureMessage:
            "Build storage with enough output and energy to cover the peaks for a full day.",
        },
      },
    ],
  },
  {
    id: 4,
    name: "Mission 4: Finances",
    icon: "tutorial-finances",
    summary: "Read the books",
    locationId: "SF",
    ownership: "Investor",
    seed: 249004,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.03,
    durationMonths: 1,
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to balance revenue and costs to keep your grid profitable.",
    facilities: [
      {
        assetId: "scenario-4-pumped-hydro",
        name: "Pumped Hydro",
        peakWh: 1000000000,
        initialAgeYears: 30,
      },
      {
        assetId: "scenario-4-coal",
        fuel: "Coal",
        peakW: 600000000,
        initialAgeYears: 25,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        target: "#insightsNav",
        revealActions: ["INSIGHTS"],
        advanceOn: (s) => s.card.name === "INSIGHTS",
        action: "Open Insights",
        content: (
          <TutorialPrompt text="Insights shows where your money comes from and where it goes." />
        ),
      },
      {
        card: "INSIGHTS",
        target: '[data-layer="financeDetails"]',
        action: "Compare revenue and costs",
        content: (
          <TutorialPrompt text="Find Revenue and Expenses in Finance details. Expenses are higher, so the grid is losing money." />
        ),
      },
      {
        target: "#programsNav",
        revealActions: ["PROGRAMS"],
        advanceOn: (s) => s.card.name === "PROGRAMS",
        action: "Open Programs",
        content: (
          <TutorialPrompt text="Programs has the electricity rate and, in some scenarios, ways to manage demand." />
        ),
      },
      {
        card: "PROGRAMS",
        target: "#rateSlider",
        advanceOnAction: (action, s) =>
          tutorialRateCommitted.match(action) && s.game.dollarsPerkWh >= 0.05,
        action: "Raise the electricity rate",
        content: (
          <TutorialPrompt text="Set at least 5¢ per kWh. Charging more helps cover fuel and plant costs." />
        ),
      },
      {
        card: "INSIGHTS",
        action: "Finish the month with a profit",
        content: (
          <TutorialPrompt text="Check your changes in Insights, then run the clock for a month. You can still adjust the rate in Programs." />
        ),
        capstone: {
          preserveProgress: true,
          checkpoint: { dollarsPerkWh: 0.03 },
          success: financesCapstoneSucceeded,
          failure: (s) =>
            s.game.date.monthsElapsed >= 1 && !financesCapstoneSucceeded(s),
          successMessage:
            "Your electricity revenue covered the grid’s expenses.",
          failureMessage:
            "Try a higher rate so your revenue covers expenses. Keep enough supply to avoid blackouts.",
        },
      },
    ],
  },
  {
    id: 3,
    name: "Mission 5: Pricing",
    icon: "tutorial-pricing",
    summary: "Grow your customers",
    locationId: "SF",
    ownership: "Investor",
    seed: 249005,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to price electricity to attract customers while covering your costs.",
    facilities: [
      {
        assetId: "scenario-3-pumped-hydro",
        name: "Pumped Hydro",
        peakWh: 1000000000,
        initialAgeYears: 30,
      },
      {
        assetId: "scenario-3-coal",
        fuel: "Coal",
        peakW: 600000000,
        initialAgeYears: 25,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        target: "#programsNav",
        advanceOn: (s) => s.card.name === "PROGRAMS",
        action: "Open Programs",
        content: (
          <TutorialPrompt text="More customers switch to your company when you have lower rates." />
        ),
      },
      {
        card: "PROGRAMS",
        target: "#rateSlider",
        advanceOnAction: (action, s) =>
          tutorialRateCommitted.match(action) && s.game.dollarsPerkWh <= 0.06,
        action: "Set a rate below the market price",
        content: (
          <TutorialPrompt text="Set 6¢ per kWh or less. Your rate still needs to cover costs." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartInsightsCustomers",
        action: "Find customer growth in Insights",
        content: (
          <TutorialPrompt text="More customers mean more demand. Leave enough spare generating capacity to serve them." />
        ),
      },
      {
        card: "INSIGHTS",
        action: "Grow customers 5% while staying profitable",
        content: <CustomerGrowthChallenge />,
        capstone: {
          preserveProgress: true,
          success: pricingCapstoneSucceeded,
          failure: (s) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 6 && !pricingCapstoneSucceeded(s)),
          successMessage:
            "You attracted more customers and kept the grid profitable.",
          failureMessage: pricingCapstoneFailure,
        },
      },
    ],
  },
  {
    id: 5,
    name: "Mission 6: Forecasting",
    icon: "tutorial-forecasting",
    summary: "See what's coming",
    locationId: "SF",
    ownership: "Investor",
    seed: 249006,
    startingYear: 2020,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage: "You spotted a shortage and built in time to cover it.",
    facilities: [
      // The starting fleet covers demand until the seeded August heat wave.
      {
        assetId: "scenario-5-coal",
        fuel: "Coal",
        peakW: 410000000,
        initialAgeYears: 20,
      },
      {
        assetId: "scenario-5-sun",
        fuel: "Sun",
        peakW: 100000000,
        initialAgeYears: 5,
      },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        target: "#insightsNav",
        advanceOn: (s) => s.card.name === "INSIGHTS",
        action: "Open Insights",
        content: (
          <TutorialPrompt text="A heat wave is coming. Look ahead so you can build before demand rises." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastSupplyDemand",
        action: "Find the summer shortage",
        content: (
          <TutorialPrompt text="Inspect the August points where demand rises above supply. Leave room for forecast error." />
        ),
      },
      {
        card: "FACILITIES",
        target: `${BUILD_DOCK}, ${projectTarget('[aria-label="Pick site for Oil"]')}`,
        desktop: {
          target: projectTarget('[aria-label="Choose sites for Oil"]'),
          content: (
            <TutorialPrompt text="Set Power to 70 MW and try Oil. Pick a connected site and check the online date before buying." />
          ),
        },
        advanceOn: (s) => s.game.facilities.some(isForecastingProject),
        action: "Order a plant that can finish before August",
        content: (
          <TutorialPrompt text="In Build, set capacity to 70 MW and try Oil. Pick a connected site and check the online date before buying." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Keep the lights on through August",
        content: (
          <TutorialPrompt text="Run the clock through August. Watch whether the new plant can cover the shortage." />
        ),
        capstone: {
          preserveProgress: true,
          retryFromPreviousStep: true,
          success: forecastingCapstoneSucceeded,
          failure: (s) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 8 &&
              !forecastingCapstoneSucceeded(s)),
          successMessage:
            "You spotted a shortage and built in time to cover it.",
          failureMessage:
            "Try a 70 MW Oil plant on a connected site. Check it comes online before August, then run the clock through August.",
        },
      },
      {
        card: "EVENTS",
        revealActions: ["EVENTS"],
        target: ".eventLogItem.kind-CONSTRUCTION",
        action: "Find your plant’s opening in Events",
        content: (
          <TutorialPrompt text="Events records changes to your grid, including construction finishing and any blackouts." />
        ),
      },
    ],
  },
  {
    id: 112,
    name: "Mission 7: Agreements",
    icon: "transmission",
    summary: "Buy backup power from a neighbor",
    locationId: "BurlingtonVT",
    location: UTILITY_AREAS.champlain.location,
    ownership: "Investor",
    seed: 249007,
    startingYear: 2005,
    startingCustomers: UTILITY_AREAS.champlain.customers,
    startingDemandScale: UTILITY_AREAS.champlain.demandScale,
    demandShapeExponent: UTILITY_AREAS.champlain.demandShapeExponent,
    cash: 120000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.105,
    durationMonths: 24,
    intertiesEnabled: true,
    endTitle: "Mission complete!",
    endMessage:
      "You put a regional power agreement to work. Use Agreements to track delivery and plan for contracts ending.",
    facilities: UTILITY_AREAS.champlain.facilities,
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        revealActions: ["AGREEMENTS"],
        target: "#agreementsNav",
        advanceOn: (s) => s.card.name === "AGREEMENTS",
        action: "Open Agreements",
        content: (
          <TutorialPrompt text="For an agreement with a neighboring utility, your territories need to share a border. Valley Electric and Ridge Electric both border your grid." />
        ),
      },
      {
        card: "AGREEMENTS",
        target: [
          '[aria-label="Review Valley Electric supply agreement"]',
          '[role="dialog"] .MuiDialogActions-root button.MuiButton-contained',
        ].join(", "),
        advanceOn: acceptedAgreement,
        action: "Review and accept a power agreement",
        content: (
          <TutorialPrompt text="Try Valley Electric. Check the price and minimum payment. You can have one agreement at a time with each neighboring utility." />
        ),
      },
      {
        card: "AGREEMENTS",
        target: "#fleetNav",
        advanceOn: (s) => s.card.name === "FLEET",
        advanceOnAction: (action) =>
          tutorialRaisedMapTool.match(action) && action.payload === "FLEET",
        action: "Open Fleet to see power flows",
        content: (
          <TutorialPrompt text="The chart in Fleet shows live imports and exports." />
        ),
      },
      {
        card: "FLEET",
        target: "#speedChangeButtons",
        action: "Run the clock until your grid imports power",
        content: (
          <TutorialPrompt text="Your agreement can cover demand when your own plants fall short." />
        ),
        capstone: {
          preserveProgress: true,
          success: hasImportedFromAgreement,
          successMessage: "Your grid drew power from a neighboring utility.",
          failureMessage: "Keep the agreement active and run the clock.",
        },
      },
      {
        card: "FLEET",
        target: "#chartSupplyDemand",
        nextLabel: "Finish tutorial",
        action: "Find External power on the chart",
        content: (
          <TutorialPrompt text="The patterned External power band shows imports in the supply stack. When you sell power, exports appear above the Demand line." />
        ),
      },
    ],
  },
  {
    id: 100,
    name: "Carbon Fee",
    icon: "carbon fee",
    locationId: "SF",
    summary:
      "Coal was cheap, but now pollution has a price. Your plants are aging.",
    threat:
      "Coal's high emissions mean higher fees. You don't have much cash to replace it.",
    themes: ["Energy transition"],
    recommendationOrder: 3,
    ownership: "Investor",
    minimumCustomerRetention: officialRetentionMetadata(100),
    startingYear: 2020,
    cash: 330000000,
    feePerKgCO2e: 50 / 1000,
    dollarsPerkWh: 0.11, // 0.6 x EIA 2020 CA average retail, 18.0 cents
    durationMonths: 12 * 12,
    facilities: [
      // California's 2010-vintage gas was mostly combined cycle
      {
        assetId: "scenario-100-natural-gas-cc",
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: 200000000,
        initialAgeYears: 10,
      },
      {
        assetId: "scenario-100-coal",
        fuel: "Coal",
        peakW: 300000000,
        initialAgeYears: 30,
      },
    ],
  },
  {
    id: 103,
    name: "The Shale Boom",
    icon: "the shale boom",
    locationId: "PIT",
    summary:
      "Fracking is making gas cheap. How much will you bet on it as your utility grows?",
    threat: "Gas prices can rise long before a new plant pays for itself.",
    themes: ["Rapid growth"],
    ownership: "Investor",
    minimumCustomerRetention: officialRetentionMetadata(103),
    startingYear: 2006,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.05, // 0.6 x EIA 2006 PA average retail, 8.68 cents
    durationMonths: 12 * 20,
    facilities: [
      {
        assetId: "scenario-103-coal",
        fuel: "Coal",
        peakW: 500000000,
        initialAgeYears: 25,
      },
    ],
  },
  {
    id: 105,
    name: "Paradise",
    icon: "paradise",
    locationId: "HNL",
    summary:
      "Hawaii runs on sun, wind and imported oil. Keep it powered as oil prices swing.",
    threat:
      "If your plants can't meet demand, there's no neighboring grid to help.",
    themes: ["Energy transition"],
    ownership: "Investor",
    minimumCustomerRetention: officialRetentionMetadata(105),
    startingYear: 2003,
    cash: 275000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.094, // 0.6 x EIA 2004 HI average retail, 15.7 cents
    durationMonths: 156,
    facilities: [
      {
        assetId: "scenario-105-sun",
        fuel: "Sun",
        peakW: 50000000,
        initialAgeYears: 5,
      },
      {
        assetId: "scenario-105-wind",
        fuel: "Wind",
        peakW: 150000000,
        initialAgeYears: 8,
      },
      {
        assetId: "scenario-105-oil",
        fuel: "Oil",
        peakW: 450000000,
        initialAgeYears: 20,
      },
    ],
  },
  {
    id: 101,
    name: "Rise of Renewables",
    icon: "rise of renewables",
    locationId: "SF",
    summary:
      "Clean power keeps getting cheaper as demand grows. When will you make the switch?",
    threat:
      "Build now and you may overpay. Wait too long and you may not have enough power.",
    themes: ["Energy transition"],
    ownership: "Investor",
    minimumCustomerRetention: officialRetentionMetadata(101),
    startingYear: 2002,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07, // 0.6 x EIA 2002 CA average retail, 12.19 cents
    durationMonths: 12 * 12,
    facilities: [
      {
        assetId: "scenario-101-uranium",
        fuel: "Uranium",
        peakW: 400000000,
        initialAgeYears: 15,
      },
      {
        assetId: "scenario-101-oil",
        fuel: "Oil",
        peakW: 100000000,
        initialAgeYears: 20,
      },
    ],
  },
  {
    id: 104,
    name: "Hurricane Season",
    icon: "hurricane season",
    locationId: "SJU",
    summary: "Hurricanes are coming to Puerto Rico.",
    threat:
      "Storms can damage several plants at once. A little spare capacity may not be enough.",
    themes: ["Extreme weather"],
    ownership: "Public",
    startingYear: 2000,
    cash: 220000000,
    feePerKgCO2e: 0,
    // About 0.6 x PREPA's oil-indexed tariff, which ran roughly twice the 2000 U.S. average
    // (6.81 cents): an island burning distillate cannot sell generation at mainland prices.
    dollarsPerkWh: 0.08,
    durationMonths: 12 * 20,
    facilities: [
      {
        assetId: "scenario-104-oil",
        fuel: "Oil",
        peakW: 220000000,
        initialAgeYears: 25,
      },
      // 1990-vintage island combustion turbines
      {
        assetId: "scenario-104-natural-gas-peaker",
        name: "Natural Gas Peaker",
        fuel: "Natural Gas",
        peakW: 200000000,
        initialAgeYears: 10,
      },
      {
        assetId: "scenario-104-coal",
        fuel: "Coal",
        peakW: 100000000,
        initialAgeYears: 30,
      },
    ],
  },
  {
    id: 102,
    name: "The End of an Era",
    icon: "the end of an era",
    locationId: "PIT",
    summary: "Your company was built on coal. Its plants are aging.",
    threat: "Competitors are moving in, and replacements take years to build.",
    themes: ["Energy transition"],
    ownership: "Investor",
    minimumCustomerRetention: officialRetentionMetadata(102),
    startingYear: 1980,
    // The authored coal derate temporarily avoids loss-making generation. Keep the original
    // CEO balance gate intact: a passive fleet still runs out of runway before year twenty.
    cash: 160000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.033, // 0.6 x 1980 US retail scaled by PA/US in 1990 (7.65 / 6.57)
    durationMonths: 12 * 20,
    facilities: [
      {
        assetId: "scenario-102-coal",
        fuel: "Coal",
        peakW: 200000000,
        initialAgeYears: 35,
      },
      {
        assetId: "scenario-102-coal-2",
        fuel: "Coal",
        peakW: 300000000,
        initialAgeYears: 20,
      },
    ],
  },
  {
    id: 106,
    name: "Data Center Boom",
    icon: "ai data center boom",
    locationId: "Manassas",
    location: {
      id: "Manassas",
      name: "Manassas, VA",
      admin: "VA",
      country: "United States",
      region: "North America",
      lat: 38.7509,
      long: -77.4753,
      timeZone: "America/New_York",
    },
    summary:
      "Data centers will connect in 2026. Power them without raising residents' bills.",
    threat:
      "Data centers need power around the clock. New plants take years to build.",
    themes: ["Rapid growth"],
    recommendationOrder: 2,
    ownership: "Public",
    startingYear: 2020,
    durationMonths: 16 * 12,
    startingCustomers: 16500,
    // Calibrates the customer-driven model to a 45-52 MW municipal average without inventing
    // hundreds of thousands of accounts. The authored data-center schedule is separate below.
    startingDemandScale: 7.7,
    // Surviving by shedding a third of the municipal customer base is not a successful response
    // to the boom. This is shown with the victory conditions before play and checked at the end.
    minimumCustomerRetention: officialRetentionMetadata(106),
    // Manassas City Utilities' researched average tariff. The two researched public-utility
    // scenarios keep their calibrated full tariffs rather than the 60% generation-share convention
    // (docs/facilities-economics.md): their demand, fleet and choice balance are fitted to them.
    dollarsPerkWh: 0.1,
    cash: 25000000,
    feePerKgCO2e: 0,
    facilities: [
      {
        assetId: "scenario-106-natural-gas-peaker",
        name: "Natural Gas Peaker",
        fuel: "Natural Gas",
        peakW: 75000000,
        initialAgeYears: 0,
      },
      {
        assetId: "scenario-106-oil",
        fuel: "Oil",
        peakW: 55000000,
        initialAgeYears: 27,
      },
    ],
    loadAdditions: [
      {
        id: "manassas-data-centers",
        label: "Data Centers",
        startsYear: 2026,
        peakW: 100000000,
        loadFactor: 0.9,
        demandType: "Data Centers",
      },
    ],
    endTitle: "A bigger city, a bigger grid",
    endMessage:
      "The data centers are connected. See how your grid handled the demand, and what residents paid for it.",
  },
  {
    id: 107,
    name: "Deep Freeze",
    icon: "texas deep freeze",
    locationId: "Austin",
    location: {
      id: "Austin",
      name: "Austin, TX",
      admin: "TX",
      country: "United States",
      region: "North America",
      lat: 30.2672,
      long: -97.7431,
      timeZone: "America/Chicago",
    },
    summary:
      "Austin will freeze in February 2021. Strengthen a grid built for heat before it does.",
    threat: "Heating demand surges as equipment freezes.",
    themes: ["Extreme weather"],
    recommendationOrder: 1,
    ownership: "Public",
    seed: 268107,
    startingYear: 2017,
    durationMonths: 7 * 12,
    startingCustomers: 472701,
    // Reconciles the customer model to Austin Energy's FY2017 13.010 TWh / 2.654 GW system.
    // Calibrated without utility-emissions weather forcing; representative days remain approximate.
    startingDemandScale: 7.75,
    // Austin Energy's researched average tariff; see the Manassas note above.
    dollarsPerkWh: 0.09,
    cash: 335000000,
    feePerKgCO2e: 0,
    // Aggregate Austin Energy resource/PPA portfolio, not a plant ownership table. To keep the
    // starting fleet legible, the sub-5% biomass share is grouped with coal and the sub-5% solar
    // share with wind; the published 3,827 MW total is unchanged.
    facilities: [
      // Sand Hill's combined cycle, Decker's steam units and both sites' peakers, grouped as the
      // combined cycle that carries the portfolio's mid-merit gas role
      // Capacity-weighted commissioning cohorts, rounded for these aggregates;
      // see docs/starting-facility-ages.md for the utility's plant/PPA sources.
      {
        assetId: "scenario-107-natural-gas-cc",
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: 1497000000,
        initialAgeYears: 30,
      },
      {
        assetId: "scenario-107-coal",
        fuel: "Coal",
        peakW: 700000000,
        initialAgeYears: 33,
      },
      {
        assetId: "scenario-107-uranium",
        fuel: "Uranium",
        peakW: 430000000,
        initialAgeYears: 29,
      },
      {
        assetId: "scenario-107-wind",
        fuel: "Wind",
        peakW: 1200000000,
        initialAgeYears: 4,
      },
    ],
    endTitle: "After the thaw",
    endMessage:
      "The freeze is over. How well did your winter preparations hold up?",
  },
  {
    id: 108,
    name: "Heatwave + Drought",
    icon: "heatwave-drought",
    locationId: "Madrid",
    location: {
      id: "Madrid",
      name: "Madrid, Spain",
      country: "Spain",
      region: "Europe",
      lat: 40.4168,
      long: -3.7038,
      timeZone: "Europe/Madrid",
      watershedId: "Madrid",
      watershedName: "Spanish river basins",
      resources: { hydro: true },
    },
    summary:
      "Spain faces hot, dry summers. Keep power flowing as cooling demand rises.",
    threat:
      "Drought leaves less water for hydro. Hot river water also limits reactor cooling, cutting nuclear output.",
    themes: ["Extreme weather"],
    ownership: "Public",
    startingYear: 2023,
    durationMonths: 48,
    startingCustomers: 900000,
    // Calibrates the game's account-based demand to 1% of Spain's 248.811TWh 2024 demand.
    // https://www.ree.es/es/sala-de-prensa/actualidad/nota-de-prensa/2025/03/la-produccion-renovable-crece-en-Espana-un-10-3-por-ciento-2024-alcanza-mayores-registros
    startingDemandScale: 0.73,
    dollarsPerkWh: 0.24,
    cash: 180000000,
    feePerKgCO2e: 50 / 1000,
    // A 1%-scale model of Spain's 2024 national fleet: 32.043GW solar PV, 32.007GW
    // wind, 20.4% combined cycle, 13.3% hydro, 5.5% nuclear, and 3.356GW storage.
    // https://www.ree.es/sites/default/files/2025-02/EN_0402_NP_Solar_FV_kuder_potencia_instalada.pdf
    facilities: [
      {
        assetId: "scenario-108-hydro",
        fuel: "Hydro",
        peakW: 171570000,
        initialAgeYears: 30,
        hydroSiteId: "azutan-2-esp",
      },
      {
        assetId: "scenario-108-sun",
        fuel: "Sun",
        peakW: 320430000,
        initialAgeYears: 5,
      },
      {
        assetId: "scenario-108-wind",
        fuel: "Wind",
        peakW: 320070000,
        initialAgeYears: 8,
      },
      {
        assetId: "scenario-108-natural-gas-cc",
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: 263160000,
        initialAgeYears: 12,
      },
      {
        assetId: "scenario-108-uranium",
        fuel: "Uranium",
        peakW: 71170000,
        initialAgeYears: 30,
      },
      // 1% of national storage power, represented as a four-hour equivalent.
      {
        assetId: "scenario-108-battery",
        name: "Battery",
        peakWh: 134240000,
        initialAgeYears: 3,
      },
    ],
    endTitle: "The heat finally breaks",
    endMessage:
      "The summer is over. How much backup power did you need when the water ran low?",
  },
  {
    id: 110,
    name: "Sudden Nuclear Shutdown",
    icon: "sudden-nuclear-trip",
    locationId: "Paris",
    location: {
      id: "Paris",
      name: "Paris, France",
      country: "France",
      region: "Europe",
      lat: 48.8566,
      long: 2.3522,
      timeZone: "Europe/Paris",
      resources: { hydro: false },
    },
    summary: "Your biggest reactor will shut down without warning.",
    threat: "The reactor stays offline for the rest of the mission.",
    themes: ["Energy transition"],
    ownership: "Public",
    startingYear: 2023,
    durationMonths: 60,
    startingCustomers: 900000,
    dollarsPerkWh: 0.14,
    cash: 180000000,
    feePerKgCO2e: 50 / 1000,
    facilities: [
      {
        assetId: "scenario-110-grand-nuclear-unit",
        fuel: "Uranium",
        peakW: 500000000,
        initialAgeYears: 22,
        label: "Grand Nuclear Unit",
      },
      {
        assetId: "scenario-110-wind",
        fuel: "Wind",
        peakW: 250000000,
        initialAgeYears: 6,
      },
      {
        assetId: "scenario-110-sun",
        fuel: "Sun",
        peakW: 200000000,
        initialAgeYears: 5,
      },
      // France keeps its few gas turbines as reserve
      {
        assetId: "scenario-110-natural-gas-peaker",
        name: "Natural Gas Peaker",
        fuel: "Natural Gas",
        peakW: 50000000,
        initialAgeYears: 15,
      },
      {
        assetId: "scenario-110-battery",
        name: "Battery",
        peakWh: 200000000,
        initialAgeYears: 3,
      },
    ],
    endTitle: "After the shutdown",
    endMessage:
      "Losing your biggest reactor left the rest of the grid to cover the gap. See how your backup plan held up.",
  },
  {
    id: 111,
    name: "Wildfire Emergency",
    icon: "wildfire emergency",
    locationId: "LA",
    summary: "Wildfire will cut your power imports in early 2025.",
    threat: "Your existing northern intertie will lose 90% of its capacity.",
    themes: ["Extreme weather"],
    ownership: "Public",
    startingYear: 2022,
    durationMonths: 60,
    startingCustomers: 16000,
    startingDemandScale: 3.55,
    dollarsPerkWh: 0.17,
    cash: 50000000,
    feePerKgCO2e: 50 / 1000,
    intertiesEnabled: true,
    startingInterties: ["california-north"],
    // A deliberately import-dependent utility, not LADWP's historical generation portfolio.
    facilities: [
      {
        assetId: "scenario-111-natural-gas-cc",
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: 12000000,
        initialAgeYears: 18,
      },
      {
        assetId: "scenario-111-sun",
        fuel: "Sun",
        peakW: 17000000,
        initialAgeYears: 6,
      },
      {
        assetId: "scenario-111-wind",
        fuel: "Wind",
        peakW: 10500000,
        initialAgeYears: 8,
      },
      {
        assetId: "scenario-111-battery",
        name: "Battery",
        peakWh: 20000000,
        initialAgeYears: 4,
      },
    ],
    endTitle: "After the wildfire outage",
    endMessage:
      "Your main import route lost 90% of its capacity. See how your replacement supply held up.",
  },
  {
    id: 113,
    name: "Load Shedding",
    icon: "load shedding",
    locationId: "Johannesburg",
    location: {
      id: "Johannesburg",
      name: "Johannesburg, South Africa",
      country: "South Africa",
      region: "Africa",
      lat: -26.2041,
      long: 28.0473,
      timeZone: "Africa/Johannesburg",
      // The Highveld is 1,750m of inland plateau: no usable river for hydro, no volcanic heat.
      resources: { hydro: false, geothermal: false },
    },
    summary:
      "South Africa's aging coal fleet is breaking down faster than you can fix it.",
    threat:
      "More plants fail each year. Diesel generators can cover the gap, but the fuel bill adds up fast.",
    themes: ["Energy transition"],
    ownership: "Public",
    startingYear: 2016,
    durationMonths: 84,
    // A 1%-scale model of Eskom's roughly 6.8 million direct and municipal customers, with the
    // demand scale reconciling the account-based load model to about 2.2TWh a year, a hundredth
    // of Eskom's roughly 208TWh of annual sales.
    // https://www.eskom.co.za/wp-content/uploads/2023/07/2023IntegratedReport.pdf
    startingCustomers: 68000,
    startingDemandScale: 8.8,
    // Eskom's 2018 standard tariff, about R0.89/kWh at roughly R13 to the dollar.
    dollarsPerkWh: 0.07,
    cash: 140000000,
    feePerKgCO2e: 0,
    // One percent of Eskom's 2018 nominal capacity: 38.5GW coal, 1.86GW nuclear at Koeberg,
    // 2.4GW of open-cycle diesel peakers, and the wind and solar the renewable independent power
    // producer programme had delivered by then. https://www.eskom.co.za/dataportal/supply-side/
    // Eskom's 2.7GW of pumped storage at Drakensberg, Ingula and Palmiet is deliberately absent:
    // PUMPED_HYDRO_SITES_BY_LOCATION has no researched site count for Johannesburg, so the game
    // cannot place the plant, and inventing one from the map is what that table forbids.
    facilities: [
      {
        assetId: "scenario-113-coal",
        fuel: "Coal",
        peakW: 385000000,
        initialAgeYears: 37,
      },
      // The diesel peakers are the standard Oil facility - fast-start internal combustion
      // engines, so they keep the catalog's icon, fuel price and economics rather than a
      // one-off label that would need its own artwork.
      {
        assetId: "scenario-113-oil",
        fuel: "Oil",
        peakW: 24000000,
        initialAgeYears: 11,
      },
      {
        assetId: "scenario-113-uranium",
        fuel: "Uranium",
        peakW: 18600000,
        initialAgeYears: 34,
      },
      {
        assetId: "scenario-113-wind",
        fuel: "Wind",
        peakW: 20000000,
        initialAgeYears: 4,
      },
      {
        assetId: "scenario-113-sun",
        fuel: "Sun",
        peakW: 15000000,
        initialAgeYears: 3,
      },
    ],
    endTitle: "Five years of breakdowns",
    endMessage:
      "New plants took years to build while old ones kept failing. Your results show whether you kept up.",
  },
  {
    id: 114,
    name: "The River Runs Dry",
    icon: "river runs dry",
    locationId: "Lusaka",
    hydroInventoryKey: "scenario:114",
    location: {
      id: "Lusaka",
      name: "Lusaka, Zambia",
      country: "Zambia",
      region: "Africa",
      lat: -15.3875,
      long: 28.3228,
      timeZone: "Africa/Lusaka",
      // Lusaka sits in the Zambezi basin and shares its rainy season, so the city's own record
      // stands in for catchment inflow the same way Madrid's does for the Spanish basins.
      watershedId: "Lusaka",
      watershedName: "Zambezi basin",
      resources: { hydro: true, geothermal: false },
    },
    summary:
      "Nearly all of Zambia's power comes from one river. An El Niño drought will drain it.",
    threat:
      "Inflow falls each year, and your small diesel plant can't replace the dam's output.",
    themes: ["Extreme weather"],
    ownership: "Public",
    startingYear: 2012,
    durationMonths: 72,
    // A fifth of ZESCO's roughly 700,000 connections in 2014, drawing about 0.55TWh a year,
    // which is what a fifth of its metered household and commercial sales actually came to.
    // Zambia's whole system is smaller than one scenario at the 1% scale the larger grids use.
    startingCustomers: 140000,
    startingDemandScale: 1.4,
    // The other half of the grid. Zambia's copper mines take roughly half of national
    // electricity and take it flat, around the clock, and a scenario that leaves them out ends
    // up with a fleet several times larger than anything its load can ask of it - which is a
    // grid no drought can reach. A fifth of the Copperbelt's roughly 700MW, at the load factor
    // a concentrator and a smelter actually run at.
    loadAdditions: [
      {
        id: "copperbelt-mines",
        label: "Copperbelt mines",
        startsYear: 2012,
        peakW: 65000000,
        loadFactor: 0.95,
        demandType: "Mining",
      },
    ],
    // Between ZESCO's 2014 residential tariff and the increases that followed the drought,
    // roughly K0.3/kWh at K6.2 to the dollar. Zambia's real 2014 tariff was about a third of
    // this and did not cover ZESCO's costs, which is a solvency story the game cannot model.
    dollarsPerkWh: 0.05,
    cash: 90000000,
    feePerKgCO2e: 0,
    // Twenty percent of Zambia's 2014 fleet: Kariba North Bank at 1,080MW after its extension,
    // Kafue Gorge at 990MW, Victoria Falls at 108MW, and a little emergency diesel. Maamba's
    // coal units had not yet been commissioned, which is what leaves the grid with no reserve.
    // https://www.zesco.co.zm/generation
    // Keep the authored 435 MW scaled fleet as one Kariba-site plant: it fits the ceiling.
    // Splitting changes reservoir dispatch and drought balance; hydrology is unchanged here.
    // Victoria Falls uses the national-grid inventory exception; see docs/hydro-sites.md.
    facilities: [
      // Kariba was essentially full when 2014 opened, and saying so is what makes the drought
      // the thing that empties it. On the default half-pool the lake cannot survive its first
      // dry season at any load worth playing, and the customers are gone before the rains fail.
      {
        assetId: "scenario-114-hydro",
        fuel: "Hydro",
        peakW: 435000000,
        hydroSiteId: "kariba-zmb",
        initialAgeYears: 38,
        initialReservoirFraction: 1,
      },
      // The emergency diesel is the standard Oil facility, so it keeps the catalog's icon and
      // economics rather than a one-off label that would need its own artwork.
      {
        assetId: "scenario-114-oil",
        fuel: "Oil",
        peakW: 16000000,
        initialAgeYears: 15,
      },
      {
        assetId: "scenario-114-sun",
        fuel: "Sun",
        peakW: 6000000,
        initialAgeYears: 1,
      },
    ],
    endTitle: "Two dry years",
    endMessage:
      "A grid built on one river needed another source of power. Did you find it before the water ran out?",
  },
  {
    id: 115,
    name: "Delhi Summer",
    icon: "delhi summer",
    locationId: "Delhi",
    location: {
      id: "Delhi",
      name: "Delhi, India",
      country: "India",
      region: "South Asia",
      lat: 28.6139,
      long: 77.209,
      timeZone: "Asia/Kolkata",
      // Delhi's own territory is flat alluvial plain; its hydro arrives over the national grid
      // rather than from anything the city utility could build.
      resources: { hydro: false, geothermal: false },
    },
    summary:
      "Each Delhi summer will need more power than the last, ending in the record heat of 2024.",
    threat:
      "Air-conditioning demand rises while heat cuts power plant output. The monsoon arrives late, delaying relief.",
    themes: ["Extreme weather", "Rapid growth"],
    ownership: "Public",
    startingYear: 2018,
    durationMonths: 84,
    // A 10%-scale model of Delhi's roughly 5.8 million distribution connections, with the demand
    // scale reconciling the account-based load model to about 3.5TWh a year, a tenth of the
    // city's 36TWh. https://cea.nic.in/general-review-report/
    startingCustomers: 580000,
    startingDemandScale: 1.42,
    // Delhi's 2021 domestic slab, about Rs 6.5/kWh at roughly Rs 79 to the dollar.
    dollarsPerkWh: 0.08,
    cash: 120000000,
    feePerKgCO2e: 0,
    // Delhi set an all-time peak of 8,656MW on 19 June 2024 after weeks above 45C.
    // Ten percent of the capacity tied to Delhi in 2021: its share of central coal stations,
    // the Bawana and Pragati gas plants, allocated Rajasthan and Gujarat wind, and the rooftop
    // and allocated solar that had been built by then.
    facilities: [
      {
        assetId: "scenario-115-coal",
        fuel: "Coal",
        peakW: 300000000,
        initialAgeYears: 20,
      },
      // Delhi's gas stations (Pragati, Bawana) are combined cycles
      {
        assetId: "scenario-115-natural-gas-cc",
        name: "Natural Gas CC",
        fuel: "Natural Gas",
        peakW: 200000000,
        initialAgeYears: 15,
      },
      {
        assetId: "scenario-115-sun",
        fuel: "Sun",
        peakW: 50000000,
        initialAgeYears: 4,
      },
      {
        assetId: "scenario-115-wind",
        fuel: "Wind",
        peakW: 30000000,
        initialAgeYears: 7,
      },
      {
        assetId: "scenario-115-battery",
        name: "Battery",
        peakWh: 40000000,
        initialAgeYears: 1,
      },
    ],
    endTitle: "The monsoon finally arrived",
    endMessage:
      "Four summers pushed demand higher and higher. See how your grid handled the peak, and what it cost.",
  },
  {
    id: 116,
    name: "Across the Valley",
    icon: "across-the-valley",
    locationId: "BurlingtonVT",
    location: UTILITY_AREAS.champlain.location,
    summary: "Acquire three competing utilities by December 2014.",
    threat:
      "Purchased-power coverage shrinks in 2017 and 2020. Plan replacement supply as you expand.",
    themes: ["Rapid growth"],
    ownership: "Investor",
    startingYear: 2005,
    durationMonths: 240,
    startingCustomers: UTILITY_AREAS.champlain.customers,
    startingDemandScale: UTILITY_AREAS.champlain.demandScale,
    demandShapeExponent: UTILITY_AREAS.champlain.demandShapeExponent,
    dollarsPerkWh: 0.105,
    cash: 120e6,
    feePerKgCO2e: 0,
    facilities: UTILITY_AREAS.champlain.facilities,
    endTitle: "A company across the valley",
    endMessage:
      "See what expansion cost and how your larger company performed.",
  },
  CHERNOBYL_SCENARIO,
];

// The opening missions, in the order a new player should work through them
export const TUTORIALS = SCENARIOS.filter((s) => s.tutorialSteps);

/**
 * The tutorial that follows this one in the authored sequence, so that finishing one can hand
 * the player straight into the next rather than back through the scenario list.
 *
 * Undefined for the last tutorial, and for anything that isn't a tutorial at all (a scenario or
 * a custom game), which is what "is there a next tutorial to offer?" reduces to at both call
 * sites - the in-game menu and the completion dialog
 */
export function getNextTutorial(scenarioId: number): ScenarioType | undefined {
  const index = TUTORIALS.findIndex((s: ScenarioType) => s.id === scenarioId);
  return index === -1 ? undefined : TUTORIALS[index + 1];
}

// Reserved for the game the player builds themselves; no authored scenario may use it
export const CUSTOM_SCENARIO_ID = 999;

/** The campaign competes as one career, never as nine independent CEO terms. */
export function isRankedScenarioId(scenarioId: number): boolean {
  return (
    scenarioId === LEGACY_CAMPAIGN_ID ||
    SCENARIOS.some(
      (scenario) => scenario.id === scenarioId && !scenario.tutorialSteps,
    )
  );
}

/**
 * The one place the game turns a scenario id into a scenario.
 *
 * Authored scenarios live in SCENARIOS, but a custom game is assembled at runtime and rides along
 * on the game slice instead, so a bare SCENARIOS.find() silently falls back to the wrong scenario
 * for it - which is what broke the custom game screen in the first place.
 */
export function getScenario(
  scenarioId: number,
  custom?: ScenarioType,
): ScenarioType | undefined {
  if (scenarioId === CUSTOM_SCENARIO_ID) {
    return custom;
  }
  return (
    SCENARIOS.find((s: ScenarioType) => s.id === scenarioId) ??
    LEGACY_SCENARIOS.find((s: ScenarioType) => s.id === scenarioId)
  );
}

/** Resolve the authored behavior of the current step without coupling callers to its index. */
export function getTutorialStep(
  game: Pick<GameType, "scenarioId" | "customScenario" | "tutorialStep">,
): TutorialStepType | undefined {
  return getScenario(game.scenarioId, game.customScenario)?.tutorialSteps?.[
    game.tutorialStep
  ];
}

/**
 * What the custom game screen opens on before the player has set one up, and the row that opens
 * it in the scenario list - which shows only its name, icon and summary, since the rest is
 * whatever they last chose rather than anything fixed.
 *
 * Deliberately not in SCENARIOS: everything that walks that array (the sim CLI and its tests, the
 * scenario list itself) means the authored scenarios.
 */
export const DEFAULT_CUSTOM_SCENARIO: ScenarioType = {
  id: CUSTOM_SCENARIO_ID,
  name: "Custom Game",
  icon: "battery",
  summary: "Set your own location, era and rules",
  locationId: "SF",
  ownership: "Investor",
  startingYear: 2020,
  cash: 200000000,
  startingCustomers: 1000000,
  dollarsPerkWh: 0.07,
  durationMonths: 12 * 20,
  feePerKgCO2e: 0,
  // A peaker because a custom game can start before combined cycles were built
  facilities: [
    // Representative California peaker age at the default 2020 opening (EIA-860).
    {
      assetId: "scenario-999-natural-gas-peaker",
      name: "Natural Gas Peaker",
      fuel: "Natural Gas",
      peakW: 500000000,
      initialAgeYears: 17,
    },
  ],
};
