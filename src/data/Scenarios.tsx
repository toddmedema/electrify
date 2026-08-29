import * as React from "react";

import TutorialPrompt from "../components/base/TutorialPrompt";
import { AppStateType, ScenarioType } from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";

const hasBlackout = (state: AppStateType) =>
  state.game.eventLog.some((event) => event.kind === "BLACKOUT");

const generatorCapstoneSucceeded = (state: AppStateType) => {
  const now = getTimeFromTimeline(state.game.date.minute, state.game.timeline);
  return !!(
    now &&
    state.game.facilities.length >= 2 &&
    state.game.facilities
      .slice(1)
      .some((facility) => facility.yearsToBuildLeft <= 0) &&
    now.supplyW >= now.demandW &&
    now.cash >= 0
  );
};

const latestMonthProfit = (state: AppStateType) => {
  const month = state.game.monthlyHistory[0];
  return month
    ? month.revenue -
        month.expensesFuel -
        month.expensesOM -
        month.expensesCarbonFee -
        month.expensesInterest
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
  state.game.date.monthsEllapsed >= 1 &&
  (latestMonthProfit(state) || 0) > 0 &&
  !hasBlackout(state);

const pricingCapstoneSucceeded = (state: AppStateType) => {
  const now = getTimeFromTimeline(state.game.date.minute, state.game.timeline);
  const startingCustomers = state.game.customerMarketSize / 2;
  return !!(
    now &&
    state.game.date.monthsEllapsed >= 6 &&
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
    state.game.date.monthsEllapsed >= 7 && addedGenerator && !hasBlackout(state)
  );
};

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
      { fuel: "Natural Gas", peakW: 410000000 },
      { fuel: "Sun", peakW: 300000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#topbar",
        content: (
          <TutorialPrompt
            concepts={["money", "goal"]}
            text="Your goal: keep the lights on and finish with more cash."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#chartSupplyDemand",
        content: (
          <TutorialPrompt
            concepts={["supply", "demand"]}
            text="Blue supply must stay above demand all day. Red means a blackout."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <TutorialPrompt
            concepts={["generator"]}
            text="Your plants make electricity. 351/410 MW means 351 MW now, out of 410 MW max."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Tap 1× to start time."
            action={["play"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#chartSupplyDemand",
        advanceOn: (s: AppStateType) => s.game.date.minute >= 1440,
        content: (
          <TutorialPrompt
            concepts={["weather", "time"]}
            text="Watch one full day go by."
          />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["goal", "supply", "time"]}
            text="Your turn: keep the lights on for a full day with no blackout."
          />
        ),
        hint: "Check the reserve readout, then choose a speed. Positive reserve means available capacity exceeds demand right now.",
        capstone: {
          success: (s: AppStateType) =>
            s.game.date.minute >= 1440 && !hasBlackout(s),
          failure: hasBlackout,
          successMessage:
            "Capstone complete - positive reserve kept demand covered for the full day.",
          failureMessage:
            "Demand outran available supply, so some electricity went unserved. Watch reserve before running the clock and retry from the same forecast.",
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
    facilities: [{ fuel: "Natural Gas", peakW: 500000000 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".button-buildGenerator",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_GENERATORS",
        content: (
          <TutorialPrompt
            concepts={["build", "generator"]}
            text="Open the generator shop."
            action={["generator"]}
          />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".build-list-item",
        content: (
          <TutorialPrompt
            concepts={["money", "time", "fuel"]}
            text="Compare build cost, time, fuel and O&M. Oil pays fixed O&M even when idle, plus variable O&M whenever it generates."
          />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".buy-button",
        advanceOn: (s: AppStateType) => s.game.facilities.length >= 2,
        content: (
          <TutorialPrompt
            concepts={["buy", "generator"]}
            text="Buy one - cash or loan."
            action={["buy"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <TutorialPrompt
            concepts={["construction", "time"]}
            text="It's being built."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Tap 1× to run the year."
            action={["play"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["forecast", "build", "supply"]}
            text="Your turn: commission enough capacity to cover demand within nine months and stay solvent."
          />
        ),
        hint: "Compare the forecast peak with your current capacity, then choose any generator whose cost and construction time fit the deadline.",
        capstone: {
          success: generatorCapstoneSucceeded,
          failure: (s: AppStateType) =>
            s.game.date.monthsEllapsed >= 9 && !generatorCapstoneSucceeded(s),
          successMessage:
            "Capstone complete - new capacity came online before the deadline and covered demand without exhausting cash.",
          failureMessage:
            "The added capacity was not online and covering demand by the nine-month deadline. Compare construction time, capacity and financing before trying again.",
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
      "You stored spare power and used dispatch order to control the grid.",
    facilities: [
      { name: "Pumped Hydro", peakWh: 500000000 },
      { fuel: "Coal", peakW: 480000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".button-buildStorage",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_STORAGE",
        content: (
          <TutorialPrompt
            concepts={["build", "storage"]}
            text="Storage banks spare power for when you need it - open the storage shop."
            action={["storage"]}
          />
        ),
      },
      {
        card: { name: "BUILD_STORAGE", dontRemember: true },
        target: ".build-list-item",
        advanceOn: (s: AppStateType) => s.game.facilities.length >= 3,
        content: (
          <TutorialPrompt
            concepts={["buy", "storage"]}
            text="Buy one."
            action={["buy"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".capacityProgressBar",
        content: (
          <TutorialPrompt
            concepts={["storage"]}
            text="The vertical bar is how much energy it holds."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        advanceOnAction: "game/reprioritizeFacility",
        content: (
          <TutorialPrompt
            concepts={["reorder"]}
            text="Drag to re-order - the top runs first and charges storage below it."
            action={["reorder"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Tap 1× to run it."
            action={["play"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["storage", "supply", "time"]}
            text="Your turn: charge from spare supply, then discharge through an evening peak within two days without a blackout."
          />
        ),
        hint: "Run the clock and watch the storage bar and power readout. Stored energy should rise off-peak, then fall while storage supplies the grid at peak.",
        capstone: {
          checkpoint: {
            facilities: [
              { name: "Pumped Hydro", peakWh: 500000000 },
              { fuel: "Coal", peakW: 375000000 },
            ],
          },
          success: storageCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.minute >= 2880 && !storageCapstoneSucceeded(s)),
          successMessage:
            "Capstone complete - surplus charged storage, and its later discharge carried demand through the peak without unserved energy.",
          failureMessage:
            "Storage did not complete a charge-and-discharge cycle before the deadline, or demand went unserved. Watch its state of charge and dispatch order before retrying.",
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
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Mission complete!",
    endMessage: "You read the books and tracked how the company makes money.",
    facilities: [
      { name: "Pumped Hydro", peakWh: 1000000000 },
      { fuel: "Coal", peakW: 600000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#insightsNav",
        content: (
          <TutorialPrompt
            concepts={["finances", "money"]}
            text="Your money lives in Insights."
          />
        ),
        desktop: {
          target: "#insightsPane",
          content: (
            <TutorialPrompt
              concepts={["finances", "money"]}
              text="Your money lives in the Insights pane."
            />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: "#chartFinances",
        content: (
          <TutorialPrompt
            concepts={["forecast", "money"]}
            text="Chart any metric, any year."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: ".insightsLayerControls",
        content: (
          <TutorialPrompt
            concepts={["finances"]}
            text="Choose presets or Layers to decide which questions this view answers."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play", "money"]}
            text="Tap 1× to run a month and watch the numbers."
            action={["play"]}
          />
        ),
      },
      {
        card: "INSIGHTS",
        content: (
          <TutorialPrompt
            concepts={["finances", "rate", "money"]}
            text="Your turn: turn the projected loss into a profitable month without causing a blackout."
          />
        ),
        hint: "Compare revenue with fuel and O&M expenses. The rate control changes revenue per unit sold; choose a rate that makes the next month profitable.",
        capstone: {
          checkpoint: { dollarsPerkWh: 0.03 },
          success: financesCapstoneSucceeded,
          failure: (s: AppStateType) =>
            s.game.date.monthsEllapsed >= 1 && !financesCapstoneSucceeded(s),
          successMessage:
            "Capstone complete - revenue covered fuel and operating costs, leaving a positive monthly profit while the grid stayed reliable.",
          failureMessage:
            "Revenue did not cover fuel, O&M and financing costs for the month, or demand went unserved. Use the financial layers to set a sustainable rate before retrying.",
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
      { name: "Pumped Hydro", peakWh: 1000000000 },
      { fuel: "Coal", peakW: 600000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#insightsNav",
        content: (
          <TutorialPrompt
            concepts={["rate", "customers"]}
            text="Your electricity rate lives in Insights."
          />
        ),
        desktop: {
          target: "#insightsPane",
          content: (
            <TutorialPrompt
              concepts={["rate", "customers"]}
              text="Your electricity rate lives in the Insights pane."
            />
          ),
        },
      },
      {
        card: "INSIGHTS",
        target: "#rateSlider",
        advanceOn: (s: AppStateType) => s.game.dollarsPerkWh < 0.07,
        content: (
          <TutorialPrompt
            concepts={["rate", "customers"]}
            text="Lower the rate below market to win customers."
            action={["rate"]}
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartInsightsCustomers",
        content: (
          <TutorialPrompt
            concepts={["customers", "forecast"]}
            text="The Customers layer shows growth beside the grid consequences."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Tap 1× to run the year."
            action={["play"]}
          />
        ),
      },
      {
        card: "INSIGHTS",
        content: (
          <TutorialPrompt
            concepts={["rate", "customers", "money"]}
            text="Your turn: grow customers by at least 5% in six months while staying profitable and reliable."
          />
        ),
        hint: "A modest discount below the market rate attracts customers. Check the financial forecast too: a rate that is too low can grow sales while losing money.",
        capstone: {
          success: pricingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsEllapsed >= 6 && !pricingCapstoneSucceeded(s)),
          successMessage:
            "Capstone complete - the lower rate grew the customer base by 5% while monthly revenue still covered costs and every unit of demand was served.",
          failureMessage:
            "The customer target, positive monthly profit and reliable supply did not all hold for six months. Balance the rate against both demand growth and cost before retrying.",
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
    facilities: [{ fuel: "Coal", peakW: 450000000 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".facility",
        advanceOnAction: "game/togglePauseFacility",
        content: (
          <TutorialPrompt
            concepts={["pause", "generator"]}
            text="Pause your only plant - see what the future thinks."
            action={["pause"]}
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastSupplyDemand",
        content: (
          <TutorialPrompt
            concepts={["forecast", "blackout"]}
            text="Blackouts ahead - forecasts show the year to come."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) =>
          s.game.eventLog.some((event) => event.kind === "BLACKOUT"),
        content: (
          <TutorialPrompt
            concepts={["play", "blackout"]}
            text="Tap 1× and let the forecasted blackout begin."
            action={["play"]}
          />
        ),
      },
      {
        card: "EVENTS",
        target: ".eventLogItem",
        content: (
          <TutorialPrompt
            concepts={["time", "blackout"]}
            text="This dated event explains what changed. Fuel cost crossovers appear here too, and only interrupt you the first time each fuel crosses."
          />
        ),
        desktop: {
          target: "#eventsPane",
          content: (
            <TutorialPrompt
              concepts={["time", "blackout"]}
              text="This pane keeps dated explanations of important changes. Fuel cost crossovers appear here too, and only interrupt you the first time each fuel crosses."
            />
          ),
        },
      },
      {
        card: "FACILITIES",
        target: ".facility",
        advanceOn: (s: AppStateType) =>
          s.game.facilities.every((f) => !f.paused),
        content: (
          <TutorialPrompt
            concepts={["play", "generator"]}
            text="Turn it back on."
            action={["play"]}
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastFuelPrices",
        content: (
          <TutorialPrompt
            concepts={["fuel", "money"]}
            text="Fuel prices move - and move your profits with them."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastWeather",
        content: (
          <TutorialPrompt
            concepts={["weather", "demand"]}
            text="Weather drives demand - and solar and wind output."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Tap 1× to run the year. The Manual has the deep dives."
            action={["play"]}
          />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["forecast", "build", "blackout"]}
            text="Your turn: commission enough generation before the forecast summer shortage, then reach month seven without a blackout."
          />
        ),
        hint: "Inspect the supply-and-demand forecast, then choose any generator with enough capacity and a construction time shorter than the shortage deadline.",
        capstone: {
          success: forecastingCapstoneSucceeded,
          failure: (s: AppStateType) =>
            hasBlackout(s) ||
            (s.game.date.monthsEllapsed >= 7 &&
              !forecastingCapstoneSucceeded(s)),
          successMessage:
            "Capstone complete - construction finished before the forecast peak, and the added generator prevented the projected summer shortage.",
          failureMessage:
            "Demand reached available capacity before enough new generation was online. Recheck the forecast gap and construction time, then commission earlier.",
        },
      },
    ],
  },
  {
    id: 100, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Carbon Fee",
    icon: "solar",
    locationId: "SF",
    summary: `New limits have been placed on pollution - can you modernize the company?`,
    briefing: {
      tone: "transition",
      fantasy: "Lead a legacy utility through a clean-energy transition.",
      objective: "Modernize the fleet without sacrificing reliability.",
      constraint: "A $50/t CO2 fee makes every dirty MWh more expensive.",
      threat: "Aging coal assets and thin margins leave little room for delay.",
      target: "A reliable, lower-carbon grid that still creates value.",
    },
    ownership: "Investor",
    startingYear: 2020,
    cash: 330000000,
    feePerKgCO2e: 50 / 1000,
    dollarsPerkWh: 0.05,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Coal", peakW: 300000000, initialAgeYears: 30 },
      { fuel: "Natural Gas", peakW: 200000000, initialAgeYears: 10 },
    ],
  },
  {
    id: 103, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "The Shale Boom",
    icon: "natural gas",
    locationId: "PIT",
    summary: `Cheap natural gas has been discovered nearby - are you ready for the boom?`,
    briefing: {
      tone: "boom",
      fantasy: "Turn an energy boom into durable advantage.",
      objective:
        "Use cheap gas to grow without betting the company on one fuel.",
      constraint:
        "Coal dominates the starting fleet and new plants last decades.",
      threat: "Fuel prices can turn before a rushed buildout pays for itself.",
      target: "A flexible fleet that can survive the boom's next turn.",
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
    icon: "wind",
    locationId: "HNL",
    summary: "A beautiful island - with a complex grid.",
    briefing: {
      tone: "island",
      fantasy: "Keep an island paradise bright without mainland backup.",
      objective: "Replace expensive oil while matching a volatile island load.",
      constraint:
        "Every fuel shipment and every build dollar matters more offshore.",
      threat: "One weak link can leave the whole island in the dark.",
      target: "A diverse island grid powered by local resources.",
    },
    ownership: "Investor",
    startingYear: 2004,
    cash: 275000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Oil", peakW: 450000000, initialAgeYears: 20 },
      { fuel: "Wind", peakW: 150000000, initialAgeYears: 8 },
      { fuel: "Sun", peakW: 50000000, initialAgeYears: 5 },
    ],
  },
  {
    id: 101, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Rise of Renewables",
    icon: "geothermal",
    locationId: "SF",
    summary: "Technology is advancing rapidly - can you keep up?",
    briefing: {
      tone: "innovation",
      fantasy: "Ride the first great wave of modern renewable power.",
      objective: "Retire aging oil and build the technologies of the future.",
      constraint:
        "Promising options arrive at different times and price points.",
      threat:
        "Move too early and overpay; move too late and fall behind demand.",
      target: "A modern fleet ready for the next energy era.",
    },
    ownership: "Investor",
    startingYear: 2002,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.02,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Oil", peakW: 100000000, initialAgeYears: 20 },
      { fuel: "Uranium", peakW: 400000000, initialAgeYears: 15 },
    ],
  },
  {
    id: 104, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Hurricane Season",
    icon: "wind",
    locationId: "SJU",
    summary: "A remote island, with expensive fuel and destructive weather.",
    briefing: {
      tone: "storm",
      fantasy: "Run a fragile island grid through relentless storm seasons.",
      objective: "Build enough resilience to keep essential power flowing.",
      constraint: "Remote fuel is costly and replacement capacity takes time.",
      threat: "Extreme weather can turn a narrow reserve into a crisis.",
      target: "A resilient, diversified grid that can weather the next storm.",
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
    icon: "coal",
    locationId: "PIT",
    summary: "Your coal business faces new challenges - and opportunities.",
    briefing: {
      tone: "legacy",
      fantasy: "Decide what comes after a century built on coal.",
      objective:
        "Evolve the business before its aging fleet becomes a liability.",
      constraint: "Most of your capital and operating knowledge sits in coal.",
      threat:
        "Old plants, new competitors and long build times punish hesitation.",
      target: "A profitable successor to the coal empire you inherited.",
    },
    ownership: "Investor",
    startingYear: 1980,
    cash: 198000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.025,
    durationMonths: 12 * 20,
    facilities: [
      { fuel: "Coal", peakW: 200000000, initialAgeYears: 25 },
      { fuel: "Coal", peakW: 300000000, initialAgeYears: 10 },
    ],
  },
  // TODO more public-ownership scenarios, such as in LA or Nebraska
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
