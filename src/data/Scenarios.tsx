import * as React from "react";

import TutorialPrompt from "../components/base/TutorialPrompt";
import { AppStateType, ScenarioType } from "../Types";

export const SCENARIOS = [
  {
    id: 0, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 1: Electricity",
    icon: "solar",
    summary: "Meet your grid",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Mission complete!",
    endMessage: "Just a few missions to go",
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
            text="Earn money - don't go broke or black out."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: "#chartSupplyDemand",
        content: (
          <TutorialPrompt
            concepts={["supply", "demand"]}
            text="Keep supply above demand - this is one average day."
          />
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <TutorialPrompt
            concepts={["generator"]}
            text="Your power plants - the bar shows what each is producing."
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
            text="Press play."
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
    ],
  },
  {
    id: 1, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 2: Generators",
    icon: "natural gas",
    summary: "Build a generator",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage:
      "You now know enough to run a company on Intern difficulty - or, continue missions to build your skills",
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
            action={["build"]}
          />
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".build-list-item",
        content: (
          <TutorialPrompt
            concepts={["money", "time", "fuel"]}
            text="Compare cost, build time and fuel."
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
            text="Run the year."
            action={["play"]}
          />
        ),
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
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 6,
    endTitle: "Mission complete!",
    endMessage:
      "You now know enough to run a company on Employee difficulty - or, continue missions to build your skills",
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
            action={["build"]}
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
            text="Run it."
            action={["play"]}
          />
        ),
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
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Mission complete!",
    endMessage:
      "You now know enough to run a company on Manager difficulty - or, continue missions to build your skills",
    facilities: [
      { name: "Pumped Hydro", peakWh: 1000000000 },
      { fuel: "Coal", peakW: 600000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#financesNav",
        content: (
          <TutorialPrompt
            concepts={["finances", "money"]}
            text="Your money lives in the Finances tab."
          />
        ),
        desktop: {
          target: "#financesPane",
          content: (
            <TutorialPrompt
              concepts={["finances", "money"]}
              text="Your money lives in the Finances pane."
            />
          ),
        },
      },
      {
        card: "FINANCES",
        target: "#chartFinances",
        content: (
          <TutorialPrompt
            concepts={["forecast", "money"]}
            text="Chart any metric, any year."
          />
        ),
      },
      {
        card: "FINANCES",
        target: ".MuiTable-root",
        content: (
          <TutorialPrompt
            concepts={["finances"]}
            text="Tap the table to expand it - including your loan interest rate."
          />
        ),
      },
      {
        card: "FINANCES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play", "money"]}
            text="Run a month - watch the numbers."
            action={["play"]}
          />
        ),
      },
    ],
  },
  {
    id: 3, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Mission 5: Marketing",
    icon: "wind",
    summary: "Grow your customers",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage:
      "You now know enough to run a company on VP difficulty - or, continue missions to build your skills",
    facilities: [
      { name: "Pumped Hydro", peakWh: 1000000000 },
      { fuel: "Coal", peakW: 600000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#financesNav",
        content: (
          <TutorialPrompt
            concepts={["marketing", "customers"]}
            text="Marketing lives in the Finances tab."
          />
        ),
        desktop: {
          target: "#financesPane",
          content: (
            <TutorialPrompt
              concepts={["marketing", "customers"]}
              text="Marketing lives in the Finances pane."
            />
          ),
        },
      },
      {
        card: "FINANCES",
        target: "#marketingSlider",
        advanceOn: (s: AppStateType) => s.game.monthlyMarketingSpend > 0,
        content: (
          <TutorialPrompt
            concepts={["marketing", "customers"]}
            text="Raise the marketing budget."
            action={["marketing"]}
          />
        ),
      },
      {
        card: "FINANCES",
        target: "#plotMetric",
        content: (
          <TutorialPrompt
            concepts={["customers", "forecast"]}
            text="Plot Customers to watch them grow - but grow too fast and blackouts will cost you them."
          />
        ),
        // Same control, different shape: on a wide screen the metrics are all drawn at once
        // rather than hidden behind a dropdown
        desktop: {
          target: "#plotMetric",
          content: (
            <TutorialPrompt
              concepts={["customers", "forecast"]}
              text="Click the Customers tile to watch them grow - but grow too fast and blackouts will cost you them."
            />
          ),
        },
      },
      {
        card: "FINANCES",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Run the year."
            action={["play"]}
          />
        ),
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
    startingYear: 2020,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Mission complete!",
    endMessage: `That's all we can teach you - the rest you'll have to learn by doing!`,
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
        card: "FORECASTS",
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
        card: "FORECASTS",
        target: "#chartForecastFuelPrices",
        content: (
          <TutorialPrompt
            concepts={["fuel", "money"]}
            text="Fuel prices move - and move your profits with them."
          />
        ),
      },
      {
        card: "FORECASTS",
        target: "#chartForecastWeather",
        content: (
          <TutorialPrompt
            concepts={["weather", "demand"]}
            text="Weather drives demand - and solar and wind output."
          />
        ),
      },
      {
        card: "FORECASTS",
        target: "#speedChangeButtons",
        advanceOn: (s: AppStateType) => s.game.speed !== "PAUSED",
        content: (
          <TutorialPrompt
            concepts={["play"]}
            text="Run the year - the Manual (top-left menu) has the deep dives."
            action={["play"]}
          />
        ),
      },
    ],
  },
  {
    id: 100, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Carbon Fee",
    icon: "solar",
    locationId: "SF",
    summary: `New limits have been placed on pollution - can you modernize the company?`,
    ownership: "Investor",
    startingYear: 2020,
    cash: 330000000,
    feePerKgCO2e: 50 / 1000,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Coal", peakW: 300000000 },
      { fuel: "Natural Gas", peakW: 200000000 },
    ],
  },
  {
    id: 103, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "The Shale Boom",
    icon: "natural gas",
    locationId: "PIT",
    summary: `Cheap natural gas has been discovered nearby - are you ready for the boom?`,
    ownership: "Investor",
    startingYear: 2006,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 20,
    facilities: [{ fuel: "Coal", peakW: 500000000 }],
  },
  {
    id: 105, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Paradise",
    icon: "wind",
    locationId: "HNL",
    summary: "A beautiful island - with a complex grid.",
    ownership: "Investor",
    startingYear: 2004,
    cash: 275000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Oil", peakW: 450000000 },
      { fuel: "Wind", peakW: 150000000 },
      { fuel: "Sun", peakW: 50000000 },
    ],
  },
  {
    id: 101, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Rise of Renewables",
    icon: "geothermal",
    locationId: "SF",
    summary: "Technology is advancing rapidly - can you keep up?",
    ownership: "Investor",
    startingYear: 2002,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 12,
    facilities: [
      { fuel: "Oil", peakW: 100000000 },
      { fuel: "Uranium", peakW: 400000000 },
    ],
  },
  {
    id: 104, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "Hurricane Season",
    icon: "wind",
    locationId: "SJU",
    summary: "A remote island, with expensive fuel and destructive weather.",
    ownership: "Public",
    startingYear: 2000,
    cash: 220000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 20,
    facilities: [
      { fuel: "Oil", peakW: 220000000 },
      { fuel: "Natural Gas", peakW: 200000000 },
      { fuel: "Coal", peakW: 100000000 },
    ],
  },
  {
    id: 102, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "The End of an Era",
    icon: "coal",
    locationId: "PIT",
    summary: "Your coal business faces new challenges - and opportunities.",
    ownership: "Investor",
    startingYear: 1980,
    cash: 198000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12 * 20,
    facilities: [
      { fuel: "Coal", peakW: 200000000 },
      { fuel: "Coal", peakW: 300000000 },
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
  dollarsPerkWh: 0.07,
  durationMonths: 12 * 20,
  feePerKgCO2e: 0,
  facilities: [{ name: "Natural Gas", peakW: 500000000 }],
} as ScenarioType;
