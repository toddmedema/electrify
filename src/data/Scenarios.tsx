import * as React from "react";

import TutorialPrompt from "../components/base/TutorialPrompt";
import { AppStateType, ScenarioType } from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";

const hasBlackout = (state: AppStateType) =>
  state.game.eventLog.some((event) => event.kind === "BLACKOUT");

const generatorCapstoneSucceeded = (state: AppStateType) => {
  const playerBuiltGeneratorTypes = state.game.facilities
    .slice(1)
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
      { fuel: "Natural Gas", peakW: 410000000, initialAgeYears: 12 },
      { fuel: "Sun", peakW: 300000000, initialAgeYears: 5 },
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
            text="The supply line must stay at or above the demand line. If demand rises above supply, the chart marks a blackout."
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
          <TutorialPrompt concepts={["play"]} text="Tap 1× to start time." />
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
        hint: "Reserve is unused capacity that could supply the grid right now. Positive reserve means available capacity is greater than demand.",
        capstone: {
          success: (s: AppStateType) =>
            s.game.date.minute >= 1440 && !hasBlackout(s),
          failure: hasBlackout,
          successMessage:
            "You kept electricity supply above demand for the full day.",
          failureMessage:
            "Demand exceeded available supply. Check the reserve and forecast before you retry.",
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
    facilities: [
      { fuel: "Natural Gas", peakW: 500000000, initialAgeYears: 15 },
    ],
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
          />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".build-list-item",
        content: (
          <TutorialPrompt
            concepts={["money", "time", "fuel"]}
            text="Compare cost and build time. Open Show details for fuel and operations and maintenance (O&M)."
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
            text="Choose a generator and decide whether to pay with cash or a loan."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <TutorialPrompt
            concepts={["construction", "time"]}
            text="Construction has started. The generator cannot supply the grid until it is complete."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt concepts={["play"]} text="Tap 1× to run the year." />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["build", "generator", "fuel"]}
            text="Your turn: build one more generator of a different type."
          />
        ),
        hint: "Open the generator shop and choose a different fuel or technology from the generator you just bought.",
        capstone: {
          preserveProgress: true,
          success: generatorCapstoneSucceeded,
          successMessage:
            "Final challenge complete—you built two different types of generator.",
          failureMessage:
            "Build another generator with a different fuel or technology from your first purchase.",
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
        target: ".button-buildStorage",
        advanceOn: (s: AppStateType) => s.card.name === "BUILD_STORAGE",
        content: (
          <TutorialPrompt
            concepts={["build", "storage"]}
            text="Store spare power for when you need it - open the storage shop."
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
            text="Choose a storage system and decide whether to pay with cash or a loan."
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
            text="Drag facilities to change their dispatch order. Generators higher in the list run first; storage charges when they make more electricity than customers need."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt concepts={["play"]} text="Tap 1× to run it." />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["storage", "supply", "time"]}
            text="Your turn: store extra energy when demand is low, then use it during the evening peak within two days without a blackout."
          />
        ),
        hint: "Run the clock and watch how full the storage is. It should fill when demand is low, then empty while helping meet the evening peak.",
        capstone: {
          checkpoint: {
            facilities: [
              {
                name: "Pumped Hydro",
                peakWh: 500000000,
                initialAgeYears: 35,
              },
              { fuel: "Coal", peakW: 370000000, initialAgeYears: 25 },
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
    dollarsPerkWh: 0.07,
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
        advanceOn: (s: AppStateType) => s.card.name === "INSIGHTS",
        content: (
          <TutorialPrompt
            concepts={["finances", "money"]}
            text="Insights shows your revenue, expenses, cash, and profit over time."
          />
        ),
        desktop: {
          target: "#insightsPane",
          content: (
            <TutorialPrompt
              concepts={["finances", "money"]}
              text="The Insights pane shows your revenue, expenses, cash, and profit over time."
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
            text="Choose a financial measure and time period to see how it changes."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: ".insightsLayerControls",
        content: (
          <TutorialPrompt
            concepts={["finances"]}
            text="Choose a preset question, or use Layers to select the information you want to compare."
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
          />
        ),
      },
      {
        card: "INSIGHTS",
        content: (
          <TutorialPrompt
            concepts={["finances", "rate", "money"]}
            text="Your turn: turn the forecast monthly loss into a profit without causing a blackout."
          />
        ),
        hint: "Compare revenue with fuel and operations and maintenance expenses. The rate control changes revenue for each unit sold; choose a rate that makes the next month profitable.",
        capstone: {
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
            text="Lower the rate below the market price so more customers choose your utility."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartInsightsCustomers",
        content: (
          <TutorialPrompt
            concepts={["customers", "forecast"]}
            text="The Customers layer shows how customer growth changes demand, revenue, and profit."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt concepts={["play"]} text="Tap 1× to run the year." />
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
            (s.game.date.monthsElapsed >= 6 && !pricingCapstoneSucceeded(s)),
          successMessage:
            "Final challenge complete—the lower rate grew the customer base by 5% while monthly revenue covered costs and supply met demand.",
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
    facilities: [{ fuel: "Coal", peakW: 450000000, initialAgeYears: 20 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".facility",
        advanceOnAction: "game/togglePauseFacility",
        content: (
          <TutorialPrompt
            concepts={["pause", "generator"]}
            text="Pause your only plant and watch how the supply forecast changes."
          />
        ),
      },
      {
        card: "INSIGHTS",
        target: "#chartForecastSupplyDemand",
        content: (
          <TutorialPrompt
            concepts={["forecast", "blackout"]}
            text="A blackout is predicted. Forecasts show what may happen during the coming year."
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
            text="Tap 1× and let the predicted blackout begin."
          />
        ),
      },
      {
        card: "EVENTS",
        target: ".eventLogItem",
        content: (
          <TutorialPrompt
            concepts={["time", "blackout"]}
            text="This dated event explains what changed. Events also report the first time one fuel becomes more expensive than another."
          />
        ),
        desktop: {
          target: "#eventsPane",
          content: (
            <TutorialPrompt
              concepts={["time", "blackout"]}
              text="This pane keeps dated explanations of important changes. It also reports the first time one fuel becomes more expensive than another."
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
          />
        ),
      },
      {
        card: "FACILITIES",
        content: (
          <TutorialPrompt
            concepts={["forecast", "build", "blackout"]}
            text="Your turn: finish building enough generation before the predicted summer shortage, then reach month seven without a blackout."
          />
        ),
        hint: "Inspect the supply-and-demand forecast, then choose any generator with enough capacity and a construction time shorter than the shortage deadline.",
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
    themes: ["Island grids"],
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
    themes: ["Extreme weather", "Island grids"],
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
        "Build enough dependable generation and storage before data-center demand arrives.",
      threat: "New demand will overwhelm the grid if you build too late.",
    },
    ownership: "Public",
    startingYear: 2020,
    durationMonths: 16 * 12,
    startingCustomers: 16500,
    // Calibrates the customer-driven model to a 45-52 MW municipal average without inventing
    // hundreds of thousands of accounts. The authored data-center schedule is separate below.
    startingDemandScale: 7.5,
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
      threat: "Extreme cold will cut supplies just as demand surges.",
    },
    ownership: "Public",
    seed: 268107,
    startingYear: 2017,
    durationMonths: 7 * 12,
    startingCustomers: 472701,
    // Reconciles the customer model to Austin Energy's FY2017 13.010 TWh / 2.654 GW system.
    startingDemandScale: 7.61,
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
      threat:
        "Water flowing into hydro reservoirs and nuclear output will decline as the heat intensifies.",
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
      { fuel: "Hydro", peakW: 171570000, initialAgeYears: 30 },
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
    id: 109,
    name: "Solar Eclipse",
    icon: "solar-eclipse",
    locationId: "Beijing",
    location: {
      id: "Beijing",
      name: "Beijing, China",
      country: "China",
      region: "East Asia",
      lat: 39.9042,
      long: 116.4074,
      timeZone: "Asia/Shanghai",
      resources: { hydro: true },
    },
    summary: "Prepare China's solar-heavy grid for a total eclipse.",
    themes: ["Energy transition"],
    briefing: {
      tone: "innovation",
      fantasy:
        "Turn a rare celestial event into a demonstration of preparation.",
      objective:
        "Charge storage or add generators that can run when solar output drops.",
      threat:
        "Storage needs enough energy to last (MWh) and enough power to discharge quickly (MW).",
    },
    ownership: "Public",
    startingYear: 2033,
    // January 2033 through China's total eclipse on September 2, 2035.
    // https://eclipse.gsfc.nasa.gov/SEdecade/SEdecade2031.html
    durationMonths: 33,
    startingCustomers: 1800000,
    // Calibrates the account model to the demand served by this solar-heavy balancing area.
    startingDemandScale: 1.11,
    // Beijing's first-tier residential rate is CNY0.4883/kWh, about US$0.07/kWh.
    // https://www.beijing.gov.cn/fwcj/jiage/ggfw1/65b8999311a82834a863952a.html
    dollarsPerkWh: 0.07,
    cash: 150000000,
    // China's national ETS closed 2024 at CNY97.49/tCO2, about US$14/tCO2.
    // https://www.mee.gov.cn/ywgz/ydqhbh/syqhbh/202501/t20250105_1099975.shtml
    feePerKgCO2e: 14 / 1000,
    reliabilityObjective: {
      year: 2035,
      month: 9,
      minimumDemandServed: 1,
      label: "September 2035 total eclipse in China",
    },
    // Renewable capacity is a 0.1%-scale model of China's 2024 national fleet. This solar-heavy
    // balancing area groups the sub-5% nuclear share into coal for a simpler 685.83MW thermal
    // fleet; the 240MWh battery represents 0.1% of China's 60GW new-storage fleet at four-hour
    // duration.
    // https://www.nea.gov.cn/20250121/097bfd7c1cd3498897639857d86d5dac/c.html
    // https://www.nea.gov.cn/20241220/39938141b6e74baaa4601e940d12b022/c.html
    facilities: [
      { fuel: "Sun", peakW: 886660000, initialAgeYears: 4 },
      { fuel: "Wind", peakW: 520680000, initialAgeYears: 6 },
      { fuel: "Hydro", peakW: 435950000, initialAgeYears: 20 },
      { fuel: "Coal", peakW: 685830000, initialAgeYears: 15 },
      { name: "Battery", peakWh: 240000000, initialAgeYears: 3 },
    ],
    endTitle: "Sunlight returns",
    endMessage:
      "The eclipse showed whether advance warning became real power and energy reserves.",
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
