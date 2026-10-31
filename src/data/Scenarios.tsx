import { UTILITY_AREAS } from "./UtilityExpansion";
import { officialRetentionMetadata } from "./OfficialScenarioRules";
import {
  beginIntertieStress,
  generatorSizeChanged,
  prepareStorageReorder,
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

// Every screen size opens these tools from the game dock. Teaching the same action on desktop
// and phone keeps a new player's first visit deliberate, even when the desktop can pin tools.
const onInsights = (s: AppStateType) => s.card.name === "INSIGHTS";
const onEvents = (s: AppStateType) => s.card.name === "EVENTS";

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

// Build now lives inside the dock. Keep its button available while later tools stay unrevealed.
const EARLY_MISSION_HIDDEN: TutorialUiIdType[] = ["sidePanes"];

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
        action: "Tap your coal plant",
        content: (
          <TutorialPrompt text="These two plants keep San Francisco’s lights on. The bar shows how hard each is working." />
        ),
      },
      {
        card: "FACILITIES",
        target: "#chartSupplyDemand",
        hideUi: MISSION_ONE_FIRST_LOOK,
        // Every Mission 1 step moves on from a tap on the thing it teaches; reading the chart
        // is the deed here, so touching it (which also shows that moment's readings) continues.
        continueOnClick: "#chartSupplyDemand",
        action: "Tap the supply and demand chart",
        content: (
          <TutorialPrompt text="Variable shows solar output; Dispatchable shows coal. Their top edge is total supply. Keep it at or above the demand line, or the city goes dark." />
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
          <TutorialPrompt text="Watch coal output climb slowly as sunlight fades. Reserve is spare power you could add within 15 minutes. Low reserve is a warning, not a blackout." />
        ),
        capstone: {
          // The step before is tapping 1x, so the player arrives with the clock already running.
          // Rebuilding the scenario here reloaded the game and paused it again under them, and the
          // guided steps changed nothing that the day's check needs reset
          preserveProgress: true,
          success: (s: AppStateType) =>
            s.game.date.minute >= 1440 && !hasBlackout(s),
          failure: hasBlackout,
          successMessage:
            "You learned how to keep electricity supply above demand as the day changes.",
          failureMessage:
            "Demand exceeded available supply. Check each plant’s output and the supply chart before you retry.",
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
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: ".button-buildFacility",
        revealActions: ["BUILD_GENERATORS"],
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_GENERATORS",
        action: "Tap Build",
        content: (
          <TutorialPrompt text="Add generation to cover demand. Tap Build again to return to your fleet." />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label^="Sort facilities"]',
        phase: "GENERATOR_CHOICES",
        continueOnClick: '[role="option"], #sort-menu [role="menuitem"]',
        action: "Sort generators",
        content: <TutorialPrompt text="Sort by cost, build time, etc" />,
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: ".constructionCapacitySlider",
        phase: "GENERATOR_CHOICES",
        advanceOnAction: generatorSizeChanged.type,
        action: "Choose a plant size",
        content: (
          <TutorialPrompt text="Use the size slider to change both cost and build time. Smaller plants cost less and can be built faster." />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label^="Review purchase of"]',
        phase: "GENERATOR_CHOICES",
        continueOn: (s: AppStateType) => s.game.facilities.length >= 2,
        continueOnClick: '[aria-label^="Review purchase of"]',
        action: "Review a generator purchase",
        content: (
          <TutorialPrompt text="Compare cost, build time and role to choose a plant for the shortage." />
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
        continueOnClick:
          ".facilityRowHeader:has(.constructionProgress) .facilityDisclosure",
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
        action: "Tap 12× to start construction time",
        content: (
          <TutorialPrompt text="Construction only moves while time runs." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: "#yearProgressBar",
        action: "Read the year progress bar",
        content: (
          <TutorialPrompt text="This bar tracks the year. Each simulated day represents one month." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        action: "Order a second generator of a different type",
        content: (
          <TutorialPrompt text="Compare output timing and running costs. Choose a plant that complements your grid." />
        ),
        capstone: {
          preserveProgress: true,
          success: generatorCapstoneSucceeded,
          successMessage:
            "You learned how to select and build generators that complement your grid’s needs.",
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
    durationMonths: 24,
    endTitle: "Mission complete!",
    endMessage:
      "You learned how to store spare electricity and use it to cover peak demand.",
    facilities: [
      {
        assetId: "scenario-2-pumped-hydro",
        name: "Pumped Hydro",
        peakWh: 500000000,
        initialAgeYears: 35,
      },
      {
        assetId: "scenario-2-coal",
        fuel: "Coal",
        peakW: 480000000,
        initialAgeYears: 25,
      },
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
        action: "Purchase a storage facility",
        content: (
          <TutorialPrompt text="Remember that you still have to provide the electricity to charge it." />
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
        phase: "STORAGE_ORDER_PREPARE",
        onNext: () => prepareStorageReorder(),
        action: "Check the storage bar",
        content: (
          <TutorialPrompt text="The vertical bar shows energy stored (MWh). The horizontal bar shows charging or discharging (MW)." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        target: '[aria-label="Reorder Coal"]',
        advanceOn: (s: AppStateType) => {
          const coal = s.game.facilities.findIndex(
            (f) => f.startingAssetId === "scenario-2-coal",
          );
          const hydro = s.game.facilities.findIndex(
            (f) => f.startingAssetId === "scenario-2-pumped-hydro",
          );
          return coal >= 0 && hydro >= 0 && coal < hydro;
        },
        action: "Drag Coal above Pumped Hydro",
        content: (
          <TutorialPrompt text="Drag Coal’s handle above Pumped Hydro so spare generation can charge it. Then try a new grid with only a coal plant." />
        ),
      },
      {
        card: "FACILITIES",
        hideUi: EARLY_MISSION_HIDDEN,
        action: "Build storage to cover peak demand",
        content: (
          <TutorialPrompt text="Your coal plant cannot cover the peaks. Choose storage that can be ready within two years, then supply a full day without a blackout." />
        ),
        capstone: {
          checkpoint: {
            facilities: [
              { fuel: "Coal", peakW: 390000000, initialAgeYears: 25 },
            ],
          },
          success: storageCapstoneSucceeded,
          failure: (s: AppStateType) =>
            s.game.date.monthsElapsed >= 24 && !storageCapstoneSucceeded(s),
          successMessage:
            "You learned how to store spare electricity and use it to cover peak demand.",
          failureMessage:
            "The grid still has peak shortages after two years. Try faster-building storage with enough output and stored energy to cover the peaks.",
        },
      },
    ],
  },
  {
    id: 4,
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
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#insightsNav",
        revealActions: ["INSIGHTS"],
        advanceOn: onInsights,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="Insights shows your revenue, expenses, cash, and profit over time." />
        ),
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
        target: "#programsNav",
        revealActions: ["PROGRAMS"],
        advanceOn: (s: AppStateType) => s.card.name === "PROGRAMS",
        action: "Tap Programs",
        content: (
          <TutorialPrompt text="Programs contains your electricity rate. Raise revenue by charging more per kWh." />
        ),
      },
      {
        card: "PROGRAMS",
        target: "#rateSlider",
        advanceOn: (s: AppStateType) => s.game.dollarsPerkWh > 0.03,
        action: "Raise the electricity rate",
        content: (
          <TutorialPrompt text="Drag the rate slider right, then compare revenue with expenses in Insights." />
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
        card: "PROGRAMS",
        action: "Set a rate that turns next month’s loss into profit",
        content: (
          <TutorialPrompt text="Raise the rate in Programs, then check that revenue covers expenses in Insights before the month ends. Keep supply above demand." />
        ),
        capstone: {
          preserveProgress: true,
          checkpoint: { dollarsPerkWh: 0.03 },
          success: financesCapstoneSucceeded,
          failure: (s: AppStateType) =>
            s.game.date.monthsElapsed >= 1 && !financesCapstoneSucceeded(s),
          successMessage:
            "You learned how to balance revenue and costs to keep your grid profitable.",
          failureMessage:
            "Revenue did not cover fuel, operating, and loan costs, or demand exceeded supply. Use the financial layers to set a workable rate before retrying.",
        },
      },
    ],
  },
  {
    id: 3,
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
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#programsNav",
        advanceOn: (s: AppStateType) =>
          s.card.name === "PROGRAMS" || s.game.dollarsPerkWh < 0.07,
        action: "Tap Programs",
        content: (
          <TutorialPrompt text="Set your electricity rate in Programs. In scenarios, it also offers ways to manage demand." />
        ),
      },
      {
        card: "PROGRAMS",
        target: "#rateSlider",
        advanceOn: (s: AppStateType) => s.game.dollarsPerkWh < 0.07,
        action: "Drag the rate slider below the market price",
        content: (
          <TutorialPrompt text="Investor utilities gain customers by pricing below market. Public utilities’ customers don’t switch over price; rates below their target earn score, and rates above it lose score." />
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
        capstone: {
          preserveProgress: true,
          success: pricingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 6 && !pricingCapstoneSucceeded(s)),
          successMessage:
            "You learned how to price electricity to attract customers while covering your costs.",
          failureMessage:
            "You need six months of target customer numbers, positive monthly profit and reliable supply. Balance growth and costs before retrying.",
        },
      },
    ],
  },
  {
    id: 5,
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
      "You learned how to use forecasts to build capacity before a shortage.",
    facilities: [
      {
        assetId: "scenario-5-coal",
        fuel: "Coal",
        peakW: 450000000,
        initialAgeYears: 20,
      },
    ],
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
        // they have opened Insights from the dock.
        target: "#insightsNav",
        advanceOn: onInsights,
        action: "Tap Insights",
        content: (
          <TutorialPrompt text="The supply forecast that shows the blackout lives in Insights." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastSupplyDemand",
        action: "Find the predicted blackout",
        content: (
          <TutorialPrompt text="The chart shows one representative day per month. Supply and demand are estimates, so leave room for forecast error." />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) =>
          s.game.eventLog.some((event) => event.kind === "BLACKOUT"),
        action: "Tap 1× to observe the blackout",
        content: (
          <TutorialPrompt text="Insights shows the forecast blackout." />
        ),
      },
      {
        // No card: the player makes the switch, and the step is done when they are on Events
        target: "#eventsNav",
        revealActions: ["EVENTS"],
        advanceOn: onEvents,
        action: "Tap Events",
        content: (
          <TutorialPrompt text="Events explains what just changed, dated and in order." />
        ),
      },
      {
        card: "EVENTS",
        target: ".eventLogItem",
        action: "Read the blackout event",
        content: (
          <TutorialPrompt text="Each dated event explains what changed." />
        ),
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
        advanceOn: onInsights,
        action: "Tap Insights",
        content: <TutorialPrompt text="Insights forecasts fuel costs." />,
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastFuelPrices",
        action: "Compare future fuel prices",
        content: (
          <TutorialPrompt text="Compare each fuel’s predicted prices before choosing what to build." />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastWeather",
        action: "Compare weather with demand",
        content: (
          <TutorialPrompt text="Weather drives demand and renewable output. Forecasts use seasonal averages farther ahead, while actual weather varies between years. Emissions affect your score and carbon fees, not local weather." />
        ),
      },
      {
        card: "INSIGHTS",
        nextLabel: "Start final challenge",
        action: "Restart for the final challenge",
        content: (
          <TutorialPrompt text="The next step resets time and your grid to the start of this tutorial. Then you’ll build generation to prevent the summer blackout." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Finish new generation before the summer shortage",
        content: (
          <TutorialPrompt text="Check the supply-and-demand forecast, then build enough generation before the summer shortage. Keep the grid supplied through month seven." />
        ),
        capstone: {
          success: forecastingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsElapsed >= 7 &&
              !forecastingCapstoneSucceeded(s)),
          successMessage:
            "You learned how to use forecasts to build capacity before a shortage.",
          failureMessage:
            "Demand exceeded available supply before the new generator was ready. Recheck the forecast shortage and start construction sooner.",
        },
      },
    ],
  },
  {
    id: 112,
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
      "You learned how to trade electricity through interties and keep local backup ready for regional shortages.",
    facilities: [
      // Slightly above the design sketch's 650 MW calibration: the fixed weather seed needs this
      // much nameplate to create observable daytime surplus after customer demand.
      {
        assetId: "scenario-112-sun",
        fuel: "Sun",
        peakW: 800000000,
        initialAgeYears: 5,
      },
      // A peaker, the backup the tutorial pauses and restores
      {
        assetId: "scenario-112-natural-gas-peaker",
        name: "Natural Gas Peaker",
        fuel: "Natural Gas",
        peakW: 500000000,
        initialAgeYears: 12,
      },
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
          <TutorialPrompt text="Wait until Building becomes a power reading such as 0/500MW, then pause. The line can now trade." />
        ),
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
          <TutorialPrompt text="Plants run in dispatch order; interties trade automatically." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[data-facility="Natural Gas Peaker"] .facilityDisclosure',
        advanceOn: (s: AppStateType) =>
          s.ui.selectedFacilityId ===
          s.game.facilities.find(
            (facility) => facility.name === "Natural Gas Peaker",
          )?.id,
        action: "Tap the gas plant",
        content: (
          <TutorialPrompt text="Open its controls to create a shortage." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[aria-label="Pause Natural Gas Peaker"]',
        advanceOn: (s: AppStateType) =>
          s.game.facilities.some(
            (facility) =>
              facility.name === "Natural Gas Peaker" && facility.paused,
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
          <TutorialPrompt text="Let a full importing month finish so it appears in Insights, then pause. Imports are limited by available capacity." />
        ),
      },
      {
        card: "INSIGHTS",
        target: '[data-layer="powerExchange"]',
        action: "Find imports on the chart",
        content: (
          <TutorialPrompt text="Imports appear alongside your shortage. Line and neighbor limits apply. Purchased emissions count in your total." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Supply your grid while selling surplus solar power",
        content: (
          <TutorialPrompt text="Choose “Buy for shortages, sell extra” and keep Solar on. Exports use surplus after local demand and storage charging." />
        ),
        capstone: {
          preserveProgress: true,
          success: intertiesCapstoneSucceeded,
          successMessage:
            "You learned how to buy backup power and sell surplus electricity through interties.",
          failureMessage:
            "The grid has not safely used both directions yet. Choose the balanced rule, keep Solar on, and run time.",
        },
      },
      {
        card: "FACILITIES",
        action: "Prepare for a regional shortage",
        phase: "INTERTIE_STRESS_PREPARE",
        nextLabel: "Inspect shortage safely",
        onNext: () => beginIntertieStress(),
        content: (
          <TutorialPrompt text="Your neighbor will have only 150 MW to spare before seasonal limits. Continue to inspect safely with time paused, then restore your existing gas backup." />
        ),
      },
      {
        card: "FACILITIES",
        target: ".transmissionLine",
        action: "Inspect the neighbor supply limit",
        phase: "INTERTIE_STRESS_INSPECT",
        content: (
          <TutorialPrompt text="The wire is still rated at 500 MW, but a wider wire cannot create power in the neighboring grid. Open the intertie to compare its line rating with available imports." />
        ),
      },
      {
        card: "FACILITIES",
        target: '[data-facility="Natural Gas Peaker"] .facilityDisclosure',
        action: "Restore your gas backup",
        phase: "INTERTIE_STRESS_INSPECT",
        advanceOn: (s: AppStateType) =>
          s.game.facilities.some(
            (f) => f.name === "Natural Gas Peaker" && !f.paused,
          ),
        content: (
          <TutorialPrompt text="Open the gas plant and resume it before running time. Keep Solar on too." />
        ),
      },
      {
        card: "FACILITIES",
        action: "Supply a full month with limited imports",
        phase: "INTERTIE_STRESS_SUPPLY",
        content: (
          <TutorialPrompt text="Run one continuously supplied month with your local fleet and limited imports. The clock then pauses and normal neighboring supply returns." />
        ),
        capstone: {
          preserveProgress: true,
          success: (s: AppStateType) =>
            s.game.tutorialIntertieStress?.completed === true,
          successMessage:
            "You learned how to trade electricity through interties and keep local backup ready for regional shortages.",
          failureMessage:
            "Keep local backup and Solar available, then run a full supplied month.",
        },
      },
    ],
  },
  {
    id: 100,
    name: "Carbon Fee",
    icon: "carbon fee",
    locationId: "SF",
    summary: "Coal was cheap. Now there's a bill for the pollution.",
    themes: ["Energy transition"],
    recommendationOrder: 3,
    briefing: {
      tone: "transition",
      fantasy: "Replace aging plants while keeping the business running.",
      objective:
        "Stay solvent and keep the lights on for 12 years under a carbon fee. Retain at least 80% of your starting customers.",
      threat:
        "Coal's high emissions mean higher fees. You don't have much cash to replace it.",
    },
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
    summary: "Fracking made gas cheap. How much are you willing to bet on it?",
    themes: ["Rapid growth"],
    briefing: {
      tone: "boom",
      fantasy: "Grow your utility while local gas is cheap.",
      objective:
        "Stay solvent for 20 years through a gas boom and whatever follows. Retain at least 80% of your starting customers.",
      threat: "Gas prices can rise long before a new plant pays for itself.",
    },
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
    summary: "Sun, wind and imported oil. Keep Hawaii powered on its own.",
    themes: ["Energy transition"],
    briefing: {
      tone: "island",
      fantasy: "Power an island that can't import electricity.",
      objective:
        "Keep the island supplied and solvent as oil prices swing. Retain at least 80% of your starting customers.",
      threat:
        "If your plants can't meet demand, there's no neighboring grid to help.",
    },
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
    summary: "Clean power keeps getting cheaper. When do you make the switch?",
    themes: ["Energy transition"],
    briefing: {
      tone: "innovation",
      fantasy: "Build the next generation of clean power.",
      objective:
        "Stay solvent and keep up with demand as clean technology gets cheaper. Retain at least 80% of your starting customers.",
      threat:
        "Build now and you may overpay. Wait too long and you may not have enough power.",
    },
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
    summary:
      "Hurricanes are coming to Puerto Rico. Build a grid that can take the hit.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy: "Keep Puerto Rico powered through years of hurricanes.",
      objective: "Keep customers supplied during severe storms.",
      threat:
        "Storms can damage several plants at once. A little spare capacity may not be enough.",
    },
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
    summary: "Your company was built on coal. What comes next?",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy: "Decide what comes after a century of coal.",
      objective:
        "Stay solvent as your coal fleet ages. Retain at least 80% of your starting customers.",
      threat:
        "Your plants are aging and competitors are moving in. Replacements take years to build.",
    },
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
      "Data centers want power. Residents want affordable bills. You have to deliver both.",
    themes: ["Rapid growth"],
    recommendationOrder: 2,
    briefing: {
      tone: "boom",
      fantasy: "Prepare a small city's grid for a surge in demand.",
      objective: "Keep customers supplied as data centers connect in 2026.",
      threat:
        "Data centers need power around the clock. New plants take years to build.",
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
    summary: "Austin is about to freeze. The grid was built for heat.",
    themes: ["Extreme weather"],
    recommendationOrder: 1,
    briefing: {
      tone: "storm",
      fantasy: "Keep Austin powered through a brutal winter storm.",
      objective:
        "Strengthen the grid to supply customers through the February 2021 freeze.",
      threat: "Heating demand surges as equipment freezes.",
    },
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
      "Spain needs more power to keep cool, just as drought leaves less water to generate it.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy: "Keep Spain powered through a hot, dry summer.",
      objective:
        "Keep power flowing as cooling demand rises and water supplies shrink.",
      threat:
        "Drought leaves less water for hydro. Hot river water also limits reactor cooling, cutting nuclear output.",
    },
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
    summary:
      "Your biggest reactor shuts down without warning. Have backup ready.",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy: "Keep the lights on when your largest generator shuts down.",
      objective: "Keep customers supplied after your main reactor shuts down.",
      threat:
        "The shutdown date is hidden. The reactor stays offline for the rest of the mission.",
    },
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
    summary:
      "Your main import route will lose 90% of its capacity. Build a backup plan before wildfire season.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy:
        "Keep Los Angeles supplied when wildfire cuts your northern intertie.",
      objective:
        "Replace lost imports during the January and February 2025 intertie outage.",
      threat: "Your existing northern intertie will lose 90% of its capacity.",
    },
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
    summary: "An aging coal fleet is breaking down faster than you can fix it.",
    themes: ["Energy transition"],
    briefing: {
      tone: "legacy",
      fantasy:
        "Run South Africa's coal-heavy grid as its oldest stations start failing.",
      objective:
        "Keep customers supplied through five years of coal plant breakdowns.",
      threat:
        "More coal plants break down each year. Diesel generators can cover the gap, but the fuel bill adds up fast.",
    },
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
      "Nearly all your power comes from one river. The rains have failed.",
    themes: ["Extreme weather"],
    briefing: {
      tone: "storm",
      fantasy:
        "Run a nearly all-hydro grid as an El Niño drought drains the reservoir.",
      objective:
        "Serve Zambia's customers through two years of falling water inflow to Kariba.",
      threat:
        "Less water reaches the reservoir each year. Your small diesel plant can't replace the dam's output.",
    },
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
      "Each summer needs more power than the last. Then comes the record heat of 2024.",
    themes: ["Extreme weather", "Rapid growth"],
    briefing: {
      tone: "storm",
      fantasy: "Keep Delhi supplied as each summer's demand exceeds the last.",
      objective:
        "Meet four rising summer peaks, ending with the record heat of May and June 2024.",
      threat:
        "Air-conditioning demand rises while heat cuts power plant output. The monsoon arrives late, delaying relief.",
    },
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
    summary:
      "Connect to your neighbors, acquire a utility, and keep your larger company supplied.",
    themes: ["Rapid growth"],
    briefing: {
      tone: "boom",
      fantasy: "Build Champlain Electric into a larger Vermont utility.",
      objective:
        "Acquire Valley Electric or Ridge Electric by the end of 2014. Retire original Oil A by the end of 2020 and acquired original oil plants by the end of 2023. Retain 90% of your expanded customer base at the end of 2024.",
      threat:
        "Compare company terms before connecting. This fictional network-renewal plan raises opening upkeep to 1.5× in 2015 and 2× in 2020, before inflation and customer growth. Valley's nuclear purchase halves in 2017; Champlain's ends in 2020, when Québec and Ridge purchase limits also halve. Plan supply and working capital.",
    },
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
