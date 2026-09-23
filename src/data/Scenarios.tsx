import { beginIntertieStress } from "../reducers/GameActions";
import * as React from "react";
import CustomerGrowthChallenge from "../components/base/CustomerGrowthChallenge";

import TutorialPrompt from "../components/base/TutorialPrompt";
import { selectFacility } from "../reducers/UI";
import { AppStateType, ScenarioType, TutorialUiIdType } from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { isPaneLayout } from "../Globals";

// Wide layouts hide the bottom navigation and keep Insights and Events on screen, so a step
// that asks the player to switch to them cannot wait for a tap that cannot happen there.
// It advances on its own; narrow layouts still require the tap. Kept beside the missions
// rather than in the HUD because it is part of what the step is for, not how it looks.
const onInsightsOrPanes = (s: AppStateType) =>
  s.card.name === "INSIGHTS" || isPaneLayout();
const onEventsOrPanes = (s: AppStateType) =>
  s.card.name === "EVENTS" || isPaneLayout();

// Mission 1 is a new player's first minute in the game, so it opens on the fleet and the chart
// alone and hands over controls only as the steps teach them. Navigation, building, the menu and
// the Insights and Events panes belong to later missions; the objective's own Exit button is
// always there to leave by.
const MISSION_ONE_CAPSTONE: TutorialUiIdType[] = [
  "nav",
  "build",
  "yearProgress",
  "sidePanes",
];
const MISSION_ONE_CLOCK: TutorialUiIdType[] = [
  ...MISSION_ONE_CAPSTONE,
  "menu",
  "facilityActions",
];
const MISSION_ONE_FIRST_LOOK: TutorialUiIdType[] = [
  ...MISSION_ONE_CLOCK,
  "speed",
];

// Missions 2 and 3 hand over building, the clock and the menu, but still keep the player on the
// fleet: navigation and the Insights and Events panes arrive with the Finances mission.
const EARLY_MISSION_HIDDEN: TutorialUiIdType[] = ["nav", "sidePanes"];

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
  const storage = state.game.facilities.find(
    (facility) => "currentWh" in facility,
  );
  // Authored storage starts empty, so delivered lifetime energy proves that it first charged from
  // surplus and later discharged. Merely buying a battery cannot satisfy the objective.
  return !!(
    storage &&
    state.game.date.minute >= 1440 &&
    storage.lifetimeWh > 0 &&
    !hasBlackout(state)
  );
};

const financesCapstoneSucceeded = (state: AppStateType) =>
  state.game.date.monthsElapsed >= 1 &&
  (latestMonthProfit(state) || 0) > 0 &&
  !hasBlackout(state);

const pricingCapstoneSucceeded = (state: AppStateType) => {
  const now = getTimeFromTimeline(state.game.date.minute, state.game.timeline);
  const startingCustomers = state.game.customerMarketSize / 2;
  return !!(
    now &&
    state.game.date.monthsElapsed >= 6 &&
    state.game.dollarsPerkWh < 0.07 &&
    now.customers >= startingCustomers * 1.05 &&
    (latestMonthProfit(state) || 0) > 0 &&
    !hasBlackout(state)
  );
};

const forecastingCapstoneSucceeded = (state: AppStateType) => {
  const addedGenerator = state.game.facilities.some(
    (facility) =>
      facility.id > 1 &&
      !("currentWh" in facility) &&
      facility.yearsToBuildLeft <= 0,
  );
  return (
    state.game.date.monthsElapsed >= 7 && addedGenerator && !hasBlackout(state)
  );
};

const tutorialNorthernIntertie = (state: AppStateType) =>
  state.game.transmission?.lines.find(
    (line) => line.corridorId === "california-north",
  );

const tutorialSawImports = (state: AppStateType) =>
  state.game.monthlyHistory.some(
    (month) => (month.chartAverage?.importedW || 0) > 0,
  );

const tutorialSawSafeExport = (state: AppStateType) =>
  !!state.game.monthlyHistory[0] &&
  (state.game.monthlyHistory[0].chartAverage?.exportedW || 0) > 0 &&
  (state.game.monthlyHistory[0].minimumSupplyMarginW ?? -1) >= 0;

const intertiesCapstoneSucceeded = (state: AppStateType) =>
  state.game.date.monthsElapsed >= 14 &&
  tutorialNorthernIntertie(state)?.yearsToBuildLeft === 0 &&
  state.game.transmission?.tradingPolicy === "BALANCED" &&
  tutorialSawImports(state) &&
  tutorialSawSafeExport(state);

export const SCENARIOS = [
  {
    id: 0, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
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
    endMessage: "You kept the grid running for a full day.",
    facilities: [
      // Coal rather than gas: it cannot turn down below its minimum output, so the midday sun
      // pushes supply visibly above demand instead of hiding the supply line under it. Sized so
      // it still ramps fast enough to cover the evening without a shortfall.
      { fuel: "Coal", peakW: 600000000, initialAgeYears: 12 },
      { fuel: "Sun", peakW: 600000000, initialAgeYears: 5 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: '[data-fuel="Coal"] .facilityRowHeader',
        hideUi: MISSION_ONE_FIRST_LOOK,
        advanceOn: (s: AppStateType) =>
          s.ui.selectedFacilityId !== null &&
          s.ui.selectedFacilityId ===
            s.game.facilities.find(
              (facility) => "fuel" in facility && facility.fuel === "Coal",
            )?.id,
        // Selection only opens row actions this mission keeps hidden, so let it go rather
        // than leave a lit row behind that the capstone's first tap would close
        onNext: () => selectFacility(null),
        action: "Tap your coal plant",
        content: (
          <TutorialPrompt text="These two plants keep San Francisco’s lights on. The bar shows how hard each is working." />
        ),
      },
      {
        card: "FACILITIES",
        target: "#chartSupplyDemand",
        hideUi: MISSION_ONE_FIRST_LOOK,
        action: "Find the supply and demand lines",
        content: (
          <TutorialPrompt text="Supply must stay at or above demand, or the city goes dark. Coal adjusts slowly, so supply can run above demand." />
        ),
      },
      {
        card: "FACILITIES",
        // Only 1× is ringed: a new player's first choice of speed is the gentle one
        target: '#speedChangeButtons [aria-label="slow speed"]',
        hideUi: MISSION_ONE_CLOCK,
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        action: "Tap 1× to start time",
        content: <TutorialPrompt text="Demand rises as the city wakes up." />,
      },
      {
        card: "FACILITIES",
        hideUi: MISSION_ONE_CAPSTONE,
        action: "Reach midnight without a blackout",
        content: (
          <TutorialPrompt text="Watch coal output climb slowly as sunlight fades." />
        ),
        hint: "Pause to inspect the chart, or speed up when you’re ready.",
        capstone: {
          // The step before is tapping 1x, so the player arrives with the clock already running.
          // Rebuilding the scenario here reloaded the game and paused it again under them, and the
          // guided steps changed nothing that the day's check needs reset
          preserveProgress: true,
          success: (s: AppStateType) =>
            s.game.date.minute >= 1440 && !hasBlackout(s),
          failure: hasBlackout,
          successMessage:
            "You kept electricity supply above demand for the full day.",
          failureMessage:
            "Demand exceeded available supply. Check each plant’s output and the supply chart before you retry.",
        },
      },
    ],
  },
  {
    id: 1, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 2: Generators",
    icon: "natural gas",
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
    endMessage: "You built your first generator and put it to work.",
    facilities: [{ fuel: "Coal", peakW: 600000000, initialAgeYears: 15 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: ".button-buildFacility",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_GENERATORS",
        action: "Tap Build",
        content: (
          <TutorialPrompt text="Your grid needs more power. New plants come from the generator shop." />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label^="Review purchase of"]',
        continueOn: (s: AppStateType) => s.game.facilities.length >= 2,
        continueOnClick: '[aria-label^="Review purchase of"]',
        action: "Review a generator purchase",
        content: (
          <TutorialPrompt text="Compare cost, build time and role to choose a plant for the shortage. Starts and ramping are automatic." />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[role="dialog"] .MuiDialogActions-root button',
        advanceOn: (s: AppStateType) => s.game.facilities.length >= 2,
        action: "Buy it with cash, or take a loan",
        content: (
          <TutorialPrompt text="Choose cash or a loan after checking the payments and upkeep. Leave money for bills during construction." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: ".facilityRowHeader:has(.constructionProgress)",
        action: "Find the construction progress",
        content: (
          <TutorialPrompt text="Construction started. The generator supplies power only when complete." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: '#speedChangeButtons [aria-label="fast speed"]',
        advanceOn: (s: AppStateType) => s.game.speed === "FAST",
        action: "Tap 20× to start construction time",
        content: (
          <TutorialPrompt text="Construction only moves while time runs." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: "#yearProgressBar",
        action: "Watch the year bar advance",
        content: (
          <TutorialPrompt text="This bar tracks the year. Each simulated day represents one month. The bar resets in January; construction continues." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        action: "Order a second generator of a different type",
        content: (
          <TutorialPrompt text="Compare output timing and running costs. Choose a plant that complements your grid." />
        ),
        hint: "Open Build and order a different type from your first purchase. Your starting coal plant does not count; construction need not finish.",
        capstone: {
          preserveProgress: true,
          success: generatorCapstoneSucceeded,
          successMessage:
            "Final challenge complete—you ordered two different generator types. Their output and running costs will shape your grid.",
          failureMessage:
            "Order a different generator type from your first purchase. Your starting coal plant does not count.",
        },
      },
    ],
  },
  {
    id: 2, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
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
    durationMonths: 6,
    endTitle: "Mission complete!",
    endMessage:
      "You stored extra energy and used the facility order to control the grid.",
    facilities: [
      { name: "Pumped Hydro", peakWh: 500000000, initialAgeYears: 35 },
      { fuel: "Coal", peakW: 480000000, initialAgeYears: 25 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: ".button-buildFacility",
        advanceOn: (s: AppStateType) => s.card.name.startsWith("BUILD_"),
        action: "Tap Build",
        content: <TutorialPrompt text="Storage saves spare power for later." />,
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: "#tab-BUILD_STORAGE",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_STORAGE",
        action: "Tap Storage",
        content: (
          <TutorialPrompt text="Compare how much energy each option stores and how quickly it can deliver it." />
        ),
      },
      {
        card: { name: "BUILD_STORAGE", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label^="Review purchase of"]',
        continueOn: (s: AppStateType) => s.game.facilities.length >= 3,
        continueOnClick: '[aria-label^="Review purchase of"]',
        action: "Review a storage purchase",
        content: (
          <TutorialPrompt text="Each storage option has a cash price and loan payments. Charging electricity costs extra." />
        ),
      },
      {
        card: { name: "BUILD_STORAGE", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[role="dialog"] .MuiDialogActions-root button',
        advanceOn: (s: AppStateType) => s.game.facilities.length >= 3,
        action: "Buy it with cash, or take a loan",
        content: (
          <TutorialPrompt text="Buying starts construction. Budget for loan payments, upkeep and other bills." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target:
          '.facilityRowHeader[data-storage="true"]:has(.capacityProgressBar)',
        action: "Check the storage bar",
        content: (
          <TutorialPrompt text="The bar shows usable stored energy in MWh. MW tells you how quickly the system can charge or discharge." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label="Reorder Coal"]',
        action: "Check generation comes before storage",
        content: (
          <TutorialPrompt text="Spare power charges storage only when generation comes first. Storage returns less energy than it takes in." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        nextLabel: "Start final challenge",
        action: "Try storage through the evening peak",
        content: (
          <TutorialPrompt text="Restart with a smaller coal plant and the original storage. Your practice purchase is cleared." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        action: "Supply the evening peak with stored energy",
        content: (
          <TutorialPrompt text="Charge from spare generation, then keep supply above demand through the evening." />
        ),
        hint: "Put Coal above storage, then run time. Finish within two simulated days.",
        capstone: {
          checkpoint: {
            facilities: [
              {
                name: "Pumped Hydro",
                peakWh: 500000000,
                initialAgeYears: 35,
              },
              { fuel: "Coal", peakW: 390000000, initialAgeYears: 25 },
            ],
          },
          success: storageCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.minute >= 2880 && !storageCapstoneSucceeded(s)),
          successMessage:
            "Final challenge complete—the storage charged with extra energy, then supplied the grid during peak demand without a blackout.",
          failureMessage:
            "The storage did not fill and empty before the deadline, or demand exceeded supply. Check how full it is and the facility order before retrying.",
        },
      },
    ],
  },
  {
    id: 4, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 4: Finances",
    icon: "coal",
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
    endMessage: "You read the books and tracked how the company makes money.",
    facilities: [
      { name: "Pumped Hydro", peakWh: 1000000000, initialAgeYears: 30 },
      { fuel: "Coal", peakW: 600000000, initialAgeYears: 25 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#insightsNav",
        advanceOn: onInsightsOrPanes,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="Insights shows your revenue, expenses, cash, and profit over time." />
        ),
        desktop: {
          target: "#insightsPane",
          action: "Find the Insights pane",
          content: (
            <TutorialPrompt text="Insights tracks revenue, expenses, cash and profit." />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: ".insightsViewportToolbar",
        continueOnClick:
          ".insightsViewportToolbar button, [data-insight-preset]",
        action: "Change the chart time period",
        content: (
          <TutorialPrompt text="Use the arrows and zoom controls to compare upcoming months." />
        ),
      },
      {
        card: "INSIGHTS",
        target: ".insightsLayerControls",
        continueOnClick: "#insightsLayersButton, [data-insight-preset]",
        action: "Tap Layers, or choose a preset question",
        content: (
          <TutorialPrompt text="Layers let you compare the information you care about." />
        ),
      },
      {
        card: "INSIGHTS",
        target: '#speedChangeButtons [aria-label="slow speed"]',
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        action: "Tap 1× to run the month",
        content: (
          <TutorialPrompt text="Watch the numbers change as the month runs." />
        ),
      },
      {
        card: "INSIGHTS",
        action: "Set a rate that turns next month’s loss into profit",
        content: (
          <TutorialPrompt text="Revenue must cover fuel, upkeep and loan payments while supply meets demand." />
        ),
        hint: "Raise the rate in Insights and compare revenue with expenses before the month ends.",
        capstone: {
          preserveProgress: true,
          checkpoint: { dollarsPerkWh: 0.03 },
          success: financesCapstoneSucceeded,
          failure: (s: AppStateType) =>
            s.game.date.monthsElapsed >= 1 && !financesCapstoneSucceeded(s),
          successMessage:
            "Final challenge complete—revenue covered fuel and operating costs, leaving a monthly profit while the grid stayed reliable.",
          failureMessage:
            "Revenue did not cover fuel, operating, and loan costs, or demand exceeded supply. Use the financial layers to set a workable rate before retrying.",
        },
      },
    ],
  },
  {
    id: 3, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 5: Pricing",
    icon: "wind",
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
    endMessage: "You grew your customer base while keeping demand in view.",
    facilities: [
      { name: "Pumped Hydro", peakWh: 1000000000, initialAgeYears: 30 },
      { fuel: "Coal", peakW: 600000000, initialAgeYears: 25 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#insightsNav",
        advanceOn: (s: AppStateType) =>
          onInsightsOrPanes(s) || s.game.dollarsPerkWh < 0.07,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="Your electricity rate lives in Insights." />
        ),
        desktop: {
          target: "#insightsPane",
          action: "Find your rate in Insights",
          content: (
            <TutorialPrompt text="Your electricity rate lives in the Insights pane." />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: "#rateSlider",
        advanceOn: (s: AppStateType) => s.game.dollarsPerkWh < 0.07,
        action: "Drag the rate slider below the market price",
        content: (
          <TutorialPrompt text="A rate below the market price wins more customers." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartInsightsCustomers",
        action: "Find customer growth on the chart",
        content: (
          <TutorialPrompt text="Watch how customer growth changes demand and profit. Customers respond gradually to price and reliability." />
        ),
      },
      {
        card: "INSIGHTS",
        target: '#speedChangeButtons [aria-label="slow speed"]',
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        action: "Tap 1× to watch customers respond",
        content: (
          <TutorialPrompt text="Customers switch gradually; keep supply ahead of their growing demand." />
        ),
      },
      {
        card: "INSIGHTS",
        action: "Grow customers 5% while staying profitable",
        content: <CustomerGrowthChallenge />,
        hint: "A modest discount below market attracts customers. Check finances too: pricing too low can grow sales at a loss.",
        capstone: {
          preserveProgress: true,
          success: pricingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 6 && !pricingCapstoneSucceeded(s)),
          successMessage:
            "Final challenge complete—the lower rate grew the customer base by 5% while monthly revenue covered costs and supply met demand.",
          failureMessage:
            "You need six months of target customer numbers, positive monthly profit and reliable supply. Balance growth and costs before retrying.",
        },
      },
    ],
  },
  {
    id: 5, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 6: Forecasting",
    icon: "geothermal",
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
    endMessage:
      "You used forecasts to plan ahead. You're ready for a full scenario.",
    facilities: [{ fuel: "Coal", peakW: 450000000, initialAgeYears: 20 }],
    tutorialSteps: [
      {
        card: "FACILITIES",
        skipBeacon: true,
        target: '[data-fuel="Coal"] .facilityDisclosure',
        advanceOn: (s: AppStateType) =>
          s.ui.selectedFacilityId ===
          s.game.facilities.find(
            (facility) => "fuel" in facility && facility.fuel === "Coal",
          )?.id,
        action: "Tap your coal plant",
        content: <TutorialPrompt text="Open the plant’s controls." />,
      },
      {
        card: "FACILITIES",
        target: '[aria-label="Pause Coal"]',
        advanceOn: (s: AppStateType) =>
          s.game.facilities.some((facility) => facility.paused),
        action: "Tap Pause",
        content: (
          <TutorialPrompt text="Pausing a plant changes the supply forecast." />
        ),
      },
      {
        // No card: the player is the one who makes the switch, and the step is done when
        // they are on Insights. Wide layouts show the pane and advance on their own
        target: "#insightsNav",
        advanceOn: onInsightsOrPanes,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="The supply forecast that shows the blackout lives in Insights." />
        ),
        desktop: {
          target: "#insightsPane",
          action: "Find the Insights pane",
          content: (
            <TutorialPrompt text="Open Insights to see the predicted blackout." />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastSupplyDemand",
        action: "Find the predicted blackout",
        content: (
          <TutorialPrompt text="The chart shows one representative day per month." />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) =>
          s.game.eventLog.some((event) => event.kind === "BLACKOUT"),
        action: "Tap 1× to observe the blackout",
        content: (
          <TutorialPrompt text="See what a forecast blackout looks like when it arrives." />
        ),
      },
      {
        // No card: the player makes the switch, and the step is done when they are on Events
        target: "#eventsNav",
        advanceOn: onEventsOrPanes,
        action: "Tap Events",
        content: (
          <TutorialPrompt text="Events explains what just changed, dated and in order." />
        ),
        desktop: {
          target: "#eventsPane",
          action: "Find the Events pane",
          content: (
            <TutorialPrompt text="Events explains what just changed, dated and in order." />
          ),
        },
      },
      {
        card: "EVENTS",
        target: ".eventLogItem",
        action: "Read the blackout event",
        content: (
          <TutorialPrompt text="Each dated event explains what changed." />
        ),
        desktop: {
          target: "#eventsPane",
          content: (
            <TutorialPrompt text="Each dated event explains what changed." />
          ),
        },
      },
      {
        card: "FACILITIES",
        target: '[data-fuel="Coal"] .facilityDisclosure',
        advanceOn: (s: AppStateType) =>
          s.ui.selectedFacilityId ===
          s.game.facilities.find(
            (facility) => "fuel" in facility && facility.fuel === "Coal",
          )?.id,
        action: "Tap your coal plant",
        content: <TutorialPrompt text="Open the plant’s controls." />,
      },
      {
        card: "FACILITIES",
        target: '[aria-label="Resume Coal"]',
        advanceOn: (s: AppStateType) =>
          s.game.facilities.every((f) => !f.paused),
        action: "Tap Resume",
        content: <TutorialPrompt text="Bring your plant back online." />,
      },
      {
        // No card: the player makes the switch, and the step is done when they are on Insights
        target: "#insightsNav",
        advanceOn: onInsightsOrPanes,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="Possible fuel costs live in the Insights forecast." />
        ),
        desktop: {
          target: "#insightsPane",
          action: "Find the Insights pane",
          content: (
            <TutorialPrompt text="Possible fuel costs live in the Insights pane." />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastFuelPrices",
        action: "Compare future fuel prices",
        content: (
          <TutorialPrompt text="Compare possible fuel costs in five years. These examples do not change your game." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastWeather",
        action: "Compare weather with demand",
        content: (
          <TutorialPrompt text="Weather drives demand and renewable output. In this game, emissions affect your score and any carbon fee, not local weather." />
        ),
      },
      {
        card: "INSIGHTS",
        nextLabel: "Start final challenge",
        action: "Prevent the shortage you can see ahead",
        content: (
          <TutorialPrompt text="Start again before the blackout, then build enough generation to cover summer demand." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Finish new generation before the summer shortage",
        content: (
          <TutorialPrompt text="Keep the grid supplied through month seven with new generation ready for the predicted summer shortage." />
        ),
        hint: "Check the supply-and-demand forecast. Choose a generator with enough capacity that can finish before the shortage.",
        capstone: {
          success: forecastingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 7 &&
              !forecastingCapstoneSucceeded(s)),
          successMessage:
            "Final challenge complete—construction finished before peak demand, and the added generator prevented the predicted summer shortage.",
          failureMessage:
            "Demand exceeded available supply before the new generator was ready. Recheck the forecast shortage and start construction sooner.",
        },
      },
    ],
  },
  {
    id: 112, // Append-only persisted scenario id; tutorial order is its position in this array
    name: "Mission 7: Interties",
    icon: "transmission",
    summary: "Share power with neighbors",
    locationId: "SF",
    ownership: "Investor",
    seed: 249007,
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 24,
    intertiesEnabled: true,
    endTitle: "Mission complete!",
    endMessage:
      "You used a limited grid connection to cover shortages and sell only safe surplus.",
    facilities: [
      // Slightly above the design sketch's 650 MW calibration: the fixed weather seed needs this
      // much nameplate to create observable daytime surplus after customer demand.
      { fuel: "Sun", peakW: 800000000, initialAgeYears: 5 },
      { fuel: "Natural Gas", peakW: 500000000, initialAgeYears: 12 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true,
        card: "FACILITIES",
        target: ".button-buildFacility",
        advanceOn: (s: AppStateType) => s.card.name.startsWith("BUILD_"),
        action: "Tap Build",
        content: (
          <TutorialPrompt text="An intertie connects you to a neighboring grid." />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: "#tab-BUILD_INTERTIES",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_INTERTIES",
        action: "Tap Interties",
        content: (
          <TutorialPrompt text="Each line has a capacity limit and takes time to build." />
        ),
      },
      {
        card: { name: "BUILD_INTERTIES", dontRemember: true },
        target: "#review-intertie-california-north",
        continueOn: (s: AppStateType) => !!tutorialNorthernIntertie(s),
        continueOnClick: "#review-intertie-california-north",
        action: "Review the Pacific Northwest line",
        content: (
          <TutorialPrompt text="A loan spreads the line’s cost over time." />
        ),
      },
      {
        card: { name: "BUILD_INTERTIES", dontRemember: true },
        target: "#approve-intertie-california-north",
        advanceOn: (s: AppStateType) => !!tutorialNorthernIntertie(s),
        action: "Tap Take loan",
        content: (
          <TutorialPrompt text="The loan starts construction of the line." />
        ),
      },
      {
        card: "FACILITIES",
        target: '#speedChangeButtons [aria-label="slow speed"]',
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        action: "Tap 1× to build the line",
        content: (
          <TutorialPrompt text="Construction progresses while time runs." />
        ),
      },
      {
        card: "FACILITIES",
        target: '#speedChangeButtons [aria-label="pause"]',
        advanceOn: (s: AppStateType) =>
          tutorialNorthernIntertie(s)?.yearsToBuildLeft === 0 &&
          s.game.speed === "PAUSED",
        action: "Pause when the line shows a power reading",
        content: (
          <TutorialPrompt text="The line can’t trade until construction finishes." />
        ),
        hint: "Once the line is live, Building gives way to a power reading such as 0/500MW. Pause then.",
      },
      {
        card: "FACILITIES",
        target: ".tradingPolicy",
        advanceOn: (s: AppStateType) =>
          s.game.transmission?.tradingPolicy === "RELIABILITY_FIRST",
        action: "Choose “Buy for shortages only”",
        content: (
          <TutorialPrompt text="This uses the neighboring grid as backup." />
        ),
      },
      {
        card: "FACILITIES",
        target: "#dispatch-order",
        action: "Find the dispatch order",
        content: (
          <TutorialPrompt text="Plants and interties share one list. Plants run in dispatch order; interties trade automatically." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[data-fuel="Natural Gas"] .facilityDisclosure',
        advanceOn: (s: AppStateType) =>
          s.ui.selectedFacilityId ===
          s.game.facilities.find(
            (facility) => "fuel" in facility && facility.fuel === "Natural Gas",
          )?.id,
        action: "Tap the gas plant",
        content: (
          <TutorialPrompt text="Open its controls to create a shortage." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[aria-label="Pause Natural Gas"]',
        advanceOn: (s: AppStateType) =>
          s.game.facilities.some(
            (facility) =>
              "fuel" in facility &&
              facility.fuel === "Natural Gas" &&
              facility.paused,
          ),
        action: "Tap Pause on the gas plant",
        content: (
          <TutorialPrompt text="A shortage lets you see the intertie cover it." />
        ),
      },
      {
        card: "FACILITIES",
        target: '#speedChangeButtons [aria-label="slow speed"]',
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        action: "Tap 1× to observe imports",
        content: (
          <TutorialPrompt text="The connected line can now cover shortages." />
        ),
      },
      {
        card: "FACILITIES",
        target: '#speedChangeButtons [aria-label="pause"]',
        advanceOn: (s: AppStateType) =>
          s.game.date.monthsElapsed >= 13 &&
          tutorialSawImports(s) &&
          s.game.speed === "PAUSED",
        action: "Pause after an importing month",
        content: (
          <TutorialPrompt text="The line can cover only up to its available capacity." />
        ),
        hint: "Let a full importing month finish so it appears in Insights, then pause.",
      },
      {
        card: "INSIGHTS",
        target: '[data-layer="powerExchange"]',
        action: "Find imports on the chart",
        content: (
          <TutorialPrompt text="Imports appear alongside your shortage. Line and neighbor limits constrain backup; purchased emissions count in your total." />
        ),
      },
      {
        card: "INSIGHTS",
        target: ".powerExchangeSummary",
        action: "Compare available capacity with 500 MW",
        content: (
          <TutorialPrompt text="Hot, sunny weather can reduce how much the line carries." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Supply your grid while selling surplus solar power",
        content: (
          <TutorialPrompt text="Use the trading rule to safely sell spare solar power over the next month." />
        ),
        hint: "Exports use surplus after charging and local demand. If flow stays at 0, make sure Solar is on.",
        capstone: {
          preserveProgress: true,
          success: intertiesCapstoneSucceeded,
          successMessage:
            "You bought power at night and sold extra solar by day, while keeping your own grid safe.",
          failureMessage:
            "The grid has not safely used both directions yet. Choose the balanced rule, keep Solar on, and run time.",
        },
      },
      {
        card: "FACILITIES",
        action: "Prepare for a regional shortage",
        nextLabel: "Inspect shortage safely",
        onNext: () => beginIntertieStress(),
        content: (
          <TutorialPrompt text="Your neighbor will have only 150 MW to spare before seasonal limits. The clock stays paused while you inspect the shortage and restore backup." />
        ),
        hint: "This practice starts only when you continue. Your existing gas plant can cover the gap; no new construction is needed.",
      },
      {
        card: "FACILITIES",
        target: ".transmissionLine",
        action: "Inspect the neighbor supply limit",
        content: (
          <TutorialPrompt text="The wire is still rated at 500 MW, but a wider wire cannot create power in the neighboring grid. Open the intertie to compare its line rating with available imports." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[data-fuel="Natural Gas"] .facilityDisclosure',
        action: "Restore your gas backup",
        advanceOn: (s: AppStateType) =>
          s.game.facilities.some(
            (f) => "fuel" in f && f.fuel === "Natural Gas" && !f.paused,
          ),
        content: (
          <TutorialPrompt text="Open the gas plant and resume it before running time. Keep Solar on too." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Supply a full month with limited imports",
        content: (
          <TutorialPrompt text="Run time to prove your local fleet and limited imports can serve the grid together." />
        ),
        hint: "The clock pauses after one continuously supplied month. Normal neighboring supply then returns.",
        capstone: {
          preserveProgress: true,
          success: (s: AppStateType) =>
            s.game.tutorialIntertieStress?.completed === true,
          successMessage:
            "You kept demand supplied through a regional shortage. The neighbor’s normal supply is restored; imports work best with a prepared local fleet.",
          failureMessage:
            "Keep local backup and Solar available, then run a full supplied month.",
        },
      },
    ],
  },
  {
    id: 100, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Carbon Fee",
    icon: "carbon fee",
    locationId: "SF",
    summary: "Pollution now costs money. Can you replace your aging plants?",
    themes: ["Energy transition"],
    recommendationOrder: 3,
    briefing: {
      tone: "transition",
      fantasy: "Modernize an aging grid as pollution gets more expensive.",
      objective: "Replace high-emission power while keeping the lights on.",
      threat: "Old coal plants and tight finances leave little room for delay.",
    },
    ownership: "Investor",
    startingYear: 2020,
    cash: 330000000,
    feePerKgCO2e: 50 / 1000,
    dollarsPerkWh: 0.05,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Natural Gas", peakW: 200000000, initialAgeYears: 10 },
      { fuel: "Coal", peakW: 300000000, initialAgeYears: 30 },
    ],
  },
  {
    id: 103, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "The Shale Boom",
    icon: "the shale boom",
    locationId: "PIT",
    summary: "Local gas is suddenly cheap—but the boom may not last.",
    themes: ["Rapid growth"],
    briefing: {
      tone: "boom",
      fantasy: "Turn a cheap-gas boom into lasting success.",
      objective: "Grow with cheaper gas without relying on it alone.",
      threat: "Gas prices may rebound before new plants pay off.",
    },
    ownership: "Investor",
    startingYear: 2006,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.03,
    durationMonths: 12 * 20,
    facilities: [{ fuel: "Coal", peakW: 500000000, initialAgeYears: 25 }],
  },
  {
    id: 105, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Paradise",
    icon: "paradise",
    locationId: "HNL",
    summary: "Power an island where every shipment and outage matters.",
    themes: ["Energy transition"],
    briefing: {
      tone: "island",
      fantasy: "Keep an island paradise bright without outside backup.",
      objective: "Use less costly oil while meeting changing demand.",
      threat: "One weak link can leave the whole island in the dark.",
    },
    ownership: "Investor",
    startingYear: 2004,
    cash: 275000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Sun", peakW: 50000000, initialAgeYears: 5 },
      { fuel: "Wind", peakW: 150000000, initialAgeYears: 8 },
      { fuel: "Oil", peakW: 450000000, initialAgeYears: 20 },
    ],
  },
  {
    id: 101, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Rise of Renewables",
    icon: "rise of renewables",
    locationId: "SF",
    summary: "New clean technologies are arriving fast. Choose when to invest.",
    themes: ["Energy transition"],
    briefing: {
      tone: "innovation",
      fantasy: "Build the next generation of clean power.",
      objective: "Replace aging oil plants with cleaner options.",
      threat:
        "Invest too early and overpay; wait too long and demand may exceed supply.",
    },
    ownership: "Investor",
    startingYear: 2002,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.02,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Uranium", peakW: 400000000, initialAgeYears: 15 },
      { fuel: "Oil", peakW: 100000000, initialAgeYears: 20 },
    ],
  },
  {
    id: 104, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Hurricane Season",
    icon: "hurricane season",
    locationId: "SJU",
    summary: "Prepare an island grid for storms and costly fuel.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy: "Protect an island grid through years of fierce storms.",
      objective:
        "Build a grid that keeps demand supplied during severe storms.",
      threat: "A major storm can overwhelm a small backup margin.",
    },
    ownership: "Public",
    startingYear: 2000,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.05,
    durationMonths: 12 * 20,
    facilities: [
      { fuel: "Oil", peakW: 220000000, initialAgeYears: 25 },
      { fuel: "Natural Gas", peakW: 200000000, initialAgeYears: 10 },
      { fuel: "Coal", peakW: 100000000, initialAgeYears: 30 },
    ],
  },
  {
    id: 102, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "The End of an Era",
    icon: "the end of an era",
    locationId: "PIT",
    summary: "Your coal company must adapt to a changing power market.",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy: "Decide what comes after a century of coal.",
      objective: "Build a new business before old coal plants hold you back.",
      threat: "Old plants, new rivals, and slow construction punish delay.",
    },
    ownership: "Investor",
    startingYear: 1980,
    // The authored coal derate temporarily avoids loss-making generation. Keep the original
    // CEO balance gate intact: a passive fleet still runs out of runway before year twenty.
    cash: 160000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.025,
    durationMonths: 12 * 20,
    facilities: [
      { fuel: "Coal", peakW: 200000000, initialAgeYears: 35 },
      { fuel: "Coal", peakW: 300000000, initialAgeYears: 20 },
    ],
  },
  {
    id: 106, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
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
    summary: "Prepare for data-center growth without pricing out residents.",
    themes: ["Rapid growth"],
    recommendationOrder: 2,
    briefing: {
      tone: "boom",
      fantasy: "Guide a small city grid through explosive growth.",
      objective:
        "Build dependable generation and storage before data centers connect.",
      threat: "New demand will overwhelm the grid if you build too late.",
    },
    ownership: "Public",
    startingYear: 2020,
    durationMonths: 16 * 12,
    startingCustomers: 16500,
    // Calibrates the customer-driven model to a 45-52 MW municipal average without inventing
    // hundreds of thousands of accounts. The authored data-center schedule is separate below.
    startingDemandScale: 7.7,
    // Surviving by shedding a third of the municipal customer base is not a successful response
    // to the boom. This is shown with the victory conditions before play and checked at the end.
    minimumCustomerRetention: 0.9,
    dollarsPerkWh: 0.1,
    cash: 25000000,
    feePerKgCO2e: 0,
    facilities: [
      {
        fuel: "Natural Gas",
        peakW: 75000000,
        initialAgeYears: 0,
      },
      { fuel: "Oil", peakW: 55000000, initialAgeYears: 27 },
    ],
    loadAdditions: [
      {
        id: "manassas-data-centers",
        label: "New data centers",
        startsYear: 2026,
        peakW: 100000000,
        loadFactor: 0.9,
        demandType: "Data centers",
      },
    ],
    endTitle: "The municipal grid, transformed",
    endMessage:
      "Sixteen years tested whether a small public utility could prepare for growth without leaving residents behind.",
  },
  {
    id: 107, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
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
    summary: "Prepare Austin's grid for a historic winter emergency.",
    themes: ["Extreme weather"],
    recommendationOrder: 1,
    briefing: {
      tone: "storm",
      fantasy: "Keep Austin powered through a brutal winter storm.",
      objective:
        "Strengthen the grid and keep every customer supplied during the February 2021 freeze.",
      threat:
        "Extreme cold will cut supplies just as demand surges. In January 2020, choose winterization or preserve your construction budget.",
    },
    ownership: "Public",
    seed: 268107,
    startingYear: 2017,
    durationMonths: 7 * 12,
    startingCustomers: 472701,
    // Reconciles the customer model to Austin Energy's FY2017 13.010 TWh / 2.654 GW system.
    // Calibrated without utility-emissions weather forcing; representative days remain approximate.
    startingDemandScale: 7.75,
    dollarsPerkWh: 0.09,
    cash: 335000000,
    feePerKgCO2e: 0,
    reliabilityObjective: {
      year: 2021,
      month: 2,
      minimumDemandServed: 1,
      label: "February 2021 freeze",
    },
    // Aggregate Austin Energy resource/PPA portfolio, not a plant ownership table. To keep the
    // starting fleet legible, the sub-5% biomass share is grouped with coal and the sub-5% solar
    // share with wind; the published 3,827 MW total is unchanged.
    facilities: [
      { fuel: "Natural Gas", peakW: 1497000000 },
      { fuel: "Coal", peakW: 700000000 },
      { fuel: "Uranium", peakW: 430000000 },
      { fuel: "Wind", peakW: 1200000000 },
    ],
    endTitle: "After the thaw",
    endMessage: "The storm tested every choice you made to prepare Austin.",
  },
  {
    id: 108, // Scenario IDs are persisted and shared; append rather than renumbering.
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
    summary: "Keep Spain powered through a worsening heatwave and drought.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy:
        "Guide Spain's renewable-rich grid through a summer of heat and drought.",
      objective:
        "Serve every customer through three months of rising demand and falling water availability.",
      threat: "Rising heat will cut hydro inflow and nuclear output.",
    },
    ownership: "Public",
    startingYear: 2024,
    durationMonths: 36,
    startingCustomers: 900000,
    // Calibrates the game's account-based demand to 1% of Spain's 248.811TWh 2024 demand.
    // https://www.ree.es/es/sala-de-prensa/actualidad/nota-de-prensa/2025/03/la-produccion-renovable-crece-en-Espana-un-10-3-por-ciento-2024-alcanza-mayores-registros
    startingDemandScale: 0.73,
    dollarsPerkWh: 0.24,
    cash: 180000000,
    feePerKgCO2e: 50 / 1000,
    reliabilityObjective: {
      year: 2026,
      month: 6,
      durationMonths: 3,
      minimumDemandServed: 1,
      label: "2026 heatwave and drought",
    },
    // A 1%-scale model of Spain's 2024 national fleet: 32.043GW solar PV, 32.007GW
    // wind, 20.4% combined cycle, 13.3% hydro, 5.5% nuclear, and 3.356GW storage.
    // https://www.ree.es/sites/default/files/2025-02/EN_0402_NP_Solar_FV_kuder_potencia_instalada.pdf
    facilities: [
      {
        fuel: "Hydro",
        peakW: 171570000,
        initialAgeYears: 30,
        hydroSiteId: "azutan-2-esp",
      },
      { fuel: "Sun", peakW: 320430000, initialAgeYears: 5 },
      { fuel: "Wind", peakW: 320070000, initialAgeYears: 8 },
      { fuel: "Natural Gas", peakW: 263160000, initialAgeYears: 12 },
      { fuel: "Uranium", peakW: 71170000, initialAgeYears: 30 },
      // 1% of national storage power, represented as a four-hour equivalent.
      { name: "Battery", peakWh: 134240000, initialAgeYears: 3 },
    ],
    endTitle: "The heat finally breaks",
    endMessage:
      "The long hot summer tested whether your mix of generators and storage could save energy for the days it mattered most.",
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
    summary: "Cover an unexpected nuclear shutdown in France.",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy:
        "Keep France's grid steady when its largest generator suddenly disappears.",
      objective:
        "Build a mix of resources that can replace the main nuclear unit if it shuts down.",
      threat:
        "The shutdown date is hidden, and the reactor will remain offline for the rest of the mission.",
    },
    ownership: "Public",
    startingYear: 2024,
    durationMonths: 48,
    startingCustomers: 900000,
    dollarsPerkWh: 0.14,
    cash: 180000000,
    feePerKgCO2e: 50 / 1000,
    reliabilityObjective: {
      // The trip can occur from July 2026 through January 2027. Requiring the whole window and
      // its aftermath keeps the hidden seeded month out of the objective text.
      year: 2026,
      month: 7,
      durationMonths: 18,
      minimumDemandServed: 1,
      label: "possible nuclear shutdown period and recovery",
    },
    facilities: [
      {
        fuel: "Uranium",
        peakW: 500000000,
        initialAgeYears: 22,
        label: "Grand Nuclear Unit",
      },
      { fuel: "Wind", peakW: 250000000, initialAgeYears: 6 },
      { fuel: "Sun", peakW: 200000000, initialAgeYears: 5 },
      { fuel: "Natural Gas", peakW: 50000000, initialAgeYears: 15 },
      { name: "Battery", peakWh: 200000000, initialAgeYears: 3 },
    ],
    endTitle: "Reserve proved its value",
    endMessage:
      "The sudden shutdown tested the backup capacity your normal plan rarely needed.",
  },
  {
    id: 111, // Scenario IDs are persisted and shared; append rather than renumbering.
    name: "Wildfire Emergency",
    icon: "wildfire emergency",
    locationId: "LA",
    summary: "Prepare Los Angeles for the January 2025 firestorm.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy:
        "Guide Los Angeles through extreme fire weather and a long restoration effort.",
      objective:
        "Keep all connected customers supplied during the January and February 2025 wildfire emergency.",
      threat:
        "Safety shutoffs will cut sales, constrain part of the fleet, and raise restoration costs.",
    },
    ownership: "Public",
    startingYear: 2024,
    durationMonths: 36,
    // A 1%-scale model of LADWP's roughly 1.6 million electric customers and 20,749 GWh of
    // FY2023-24 retail sales. The demand scale reconciles the account-based load model to that
    // annual energy total. https://www.ladwp.com/who-we-are/power-system
    startingCustomers: 16000,
    startingDemandScale: 3.55,
    dollarsPerkWh: 0.17,
    cash: 50000000,
    feePerKgCO2e: 50 / 1000,
    reliabilityObjective: {
      year: 2025,
      month: 1,
      durationMonths: 2,
      minimumDemandServed: 1,
      label: "January and February 2025 wildfire emergency",
    },
    // One percent of LADWP's 8,081 MW net dependable capacity, grouped into six readable
    // resources using its 2024 power-content mix as the portfolio anchor.
    // https://www.ladwp.com/who-we-are/power-system/power-content-label
    facilities: [
      {
        fuel: "Natural Gas",
        peakW: 24240000,
        initialAgeYears: 18,
      },
      { fuel: "Sun", peakW: 17000000, initialAgeYears: 6 },
      { fuel: "Uranium", peakW: 12120000, initialAgeYears: 30 },
      { fuel: "Wind", peakW: 10500000, initialAgeYears: 8 },
      { fuel: "Coal", peakW: 8890000, initialAgeYears: 35 },
      { fuel: "Geothermal", peakW: 8060000, initialAgeYears: 20 },
      { name: "Battery", peakWh: 20000000, initialAgeYears: 4 },
    ],
    endTitle: "After the firestorm",
    endMessage:
      "The emergency tested whether backup power and financial reserves could carry Los Angeles through shutoffs and restoration.",
  },
  {
    id: 113, // Scenario IDs are persisted and shared; append rather than renumbering.
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
    summary: "An aging coal fleet is breaking down faster than you can fix it.",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy:
        "Run South Africa's coal-heavy grid as its oldest stations start failing.",
      objective:
        "Keep customers supplied through five years of falling coal availability.",
      threat:
        "Unplanned breakdowns take more of the coal fleet offline every year, and the diesel peakers that cover them burn cash.",
    },
    ownership: "Public",
    startingYear: 2018,
    durationMonths: 60,
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
    reliabilityObjective: {
      // The deepest stage of the real shortage. Requiring the whole of 2022 keeps the objective
      // on the sustained problem rather than on any single bad week.
      year: 2022,
      month: 1,
      durationMonths: 12,
      minimumDemandServed: 1,
      label: "2022, the worst year of the shortage",
    },
    // One percent of Eskom's 2018 nominal capacity: 38.5GW coal, 1.86GW nuclear at Koeberg,
    // 2.4GW of open-cycle diesel peakers, and the wind and solar the renewable independent power
    // producer programme had delivered by then. https://www.eskom.co.za/dataportal/supply-side/
    // Eskom's 2.7GW of pumped storage at Drakensberg, Ingula and Palmiet is deliberately absent:
    // PUMPED_HYDRO_SITES_BY_LOCATION has no researched site count for Johannesburg, so the game
    // cannot place the plant, and inventing one from the map is what that table forbids.
    facilities: [
      { fuel: "Coal", peakW: 385000000, initialAgeYears: 37 },
      {
        fuel: "Oil",
        peakW: 24000000,
        initialAgeYears: 11,
        label: "Diesel Peakers",
      },
      { fuel: "Uranium", peakW: 18600000, initialAgeYears: 34 },
      { fuel: "Wind", peakW: 20000000, initialAgeYears: 4 },
      { fuel: "Sun", peakW: 15000000, initialAgeYears: 3 },
    ],
    endTitle: "The lights stayed on, or they didn't",
    endMessage:
      "Five years of breakdowns tested whether new capacity could be built faster than the old fleet gave out.",
  },
  {
    id: 114, // Scenario IDs are persisted and shared; append rather than renumbering.
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
      "Nearly all your power comes from one river, and the rains failed.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy:
        "Run a nearly all-hydro grid as an El Nino drought drains the reservoir.",
      objective:
        "Serve Zambia's customers through two years of collapsing inflow to Kariba.",
      threat:
        "Reservoir inflow falls year after year, and a fleet with no other firm generation has nothing to fall back on.",
    },
    ownership: "Public",
    startingYear: 2014,
    durationMonths: 48,
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
        startsYear: 2014,
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
    reliabilityObjective: {
      year: 2016,
      month: 1,
      durationMonths: 12,
      // The only objective in the set that is not a flat 100%. Every other scenario asks the
      // player to prevent a shortage; this one asks them to hold a grid together through one,
      // on a fleet whose fuel arrives as rain. A plan good enough to get through the worst of
      // Kariba still trims a fraction of a percent in the pre-rains months, and failing it for
      // that is grading the weather rather than the decisions. Passive play sheds 86% in the
      // October of this year, so this stays a long way from a formality.
      minimumDemandServed: 0.98,
      label: "2016, the year the reservoir bottomed out",
    },
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
        fuel: "Hydro",
        peakW: 435000000,
        hydroSiteId: "kariba-zmb",
        initialAgeYears: 38,
        initialReservoirFraction: 1,
      },
      {
        fuel: "Oil",
        peakW: 16000000,
        initialAgeYears: 15,
        label: "Emergency Diesel",
      },
      { fuel: "Sun", peakW: 6000000, initialAgeYears: 1 },
    ],
    endTitle: "The rains returned",
    endMessage:
      "The drought tested whether a grid built on one river could find firm power anywhere else in time.",
  },
  {
    id: 115, // Scenario IDs are persisted and shared; append rather than renumbering.
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
      "Each summer peaks higher than the last, and 2024 breaks the record.",
    themes: ["Extreme weather", "Rapid growth"],
    briefing: {
      tone: "storm",
      fantasy:
        "Supply one of the world's hottest large cities through four rising summers.",
      objective:
        "Meet four rising summer peaks, ending with the record heat of May and June 2024.",
      threat:
        "Extreme heat raises demand and cuts thermal output. A late monsoon prolongs the strain.",
    },
    ownership: "Public",
    startingYear: 2021,
    durationMonths: 48,
    // A 10%-scale model of Delhi's roughly 5.8 million distribution connections, with the demand
    // scale reconciling the account-based load model to about 3.5TWh a year, a tenth of the
    // city's 36TWh. https://cea.nic.in/general-review-report/
    startingCustomers: 580000,
    startingDemandScale: 1.42,
    // Delhi's 2021 domestic slab, about Rs 6.5/kWh at roughly Rs 79 to the dollar.
    dollarsPerkWh: 0.08,
    cash: 120000000,
    feePerKgCO2e: 0,
    reliabilityObjective: {
      // Delhi set an all-time peak of 8,656MW on 19 June 2024 after weeks above 45C.
      year: 2024,
      month: 5,
      durationMonths: 3,
      minimumDemandServed: 1,
      label: "the record summer of 2024",
    },
    // Ten percent of the capacity tied to Delhi in 2021: its share of central coal stations,
    // the Bawana and Pragati gas plants, allocated Rajasthan and Gujarat wind, and the rooftop
    // and allocated solar that had been built by then.
    facilities: [
      { fuel: "Coal", peakW: 300000000, initialAgeYears: 20 },
      { fuel: "Natural Gas", peakW: 200000000, initialAgeYears: 15 },
      { fuel: "Sun", peakW: 50000000, initialAgeYears: 4 },
      { fuel: "Wind", peakW: 30000000, initialAgeYears: 7 },
      { name: "Battery", peakWh: 40000000, initialAgeYears: 1 },
    ],
    endTitle: "The monsoon finally arrived",
    endMessage:
      "Four summers tested whether a grid could grow fast enough to stay ahead of its own peak.",
  },
] as ScenarioType[];

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
  return SCENARIOS.find((s: ScenarioType) => s.id === scenarioId);
}

/**
 * What the custom game screen opens on before the player has set one up, and the row that opens
 * it in the scenario list - which shows only its name, icon and summary, since the rest is
 * whatever they last chose rather than anything fixed.
 *
 * Deliberately not in SCENARIOS: everything that walks that array (the sim CLI and its tests, the
 * scenario list itself) means the authored scenarios.
 */
export const DEFAULT_CUSTOM_SCENARIO = {
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
  facilities: [{ name: "Natural Gas", peakW: 500000000 }],
} as ScenarioType;
