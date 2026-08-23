import { Typography } from "@mui/material";
import * as React from "react";

import { setSpeed } from "../reducers/Game";
import { ScenarioType } from "../Types";

export const SCENARIOS = [
  {
    id: 0, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "101: Electricity",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Tutorial complete!",
    endMessage: "Just a few tutorials to go",
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
          <Typography variant="body1">
            Welcome! You're the new CEO of a regional power generation company.
            <br />
            <br />
            Your goal: Make as much money as possible. You lose if you run out
            of cash or cause too many blackouts.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".VictoryContainer",
        content: (
          <Typography variant="body1">
            Make money by supplying demand for electricity, measured in
            Megawatts (MW).
            <br />
            <br />
            This graph represents an <strong>average day</strong> for the month.
            <br />
            <br />
            Demand is driven by a variety of factors, including the weather and
            how many customers you have.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".VictoryContainer",
        content: (
          <Typography variant="body1">
            Your generators automatically spin up to meet demand as best they
            can.
            <br />
            <br />
            If you don't supply enough power, you'll cause blackouts that cost
            you customers.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <Typography variant="body1">
            Your facilities indicate how much power they're currently
            producting.
            <br />
            <br />
            For example, your solar plant isn't producing because it's night
            time, so your natural gas is picking up the slack.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        onNext: () => setSpeed("SLOW"),
        content: (
          <Typography variant="body1">
            This tutorial will run for 1 month. See how demand and your supply
            changes over that time!
          </Typography>
        ),
      },
    ],
  },
  {
    id: 1, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "102: Generators",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Tutorial complete!",
    endMessage:
      "You now know enough to run a company on Intern difficulty - or, continue tutorials to build your skills",
    facilities: [{ fuel: "Natural Gas", peakW: 500000000 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".button-buildGenerator",
        content: (
          <Typography variant="body1">
            Build generators to produce additional electricity when you're
            having blackouts - or in anticipation of future growth.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: "#peak-output",
        content: (
          <Typography variant="body1">
            Slide to change the size of generator you want to build.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: "#sort",
        content: (
          <Typography variant="body1">Sort by different properties.</Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".action-seconday-text",
        content: (
          <Typography variant="body1">
            See how long it will take to build, the total cost of electricity
            across its lifetime, and how much greenhouse gas it releases per
            unit generated.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".build-list-item",
        content: (
          <Typography variant="body1">
            Click on a generator to see more detailed information.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: ".buy-button",
        content: (
          <Typography variant="body1">
            Click on the price to buy it, either in cash or with a loan.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_GENERATORS", dontRemember: true },
        target: "#close-button",
        content: (
          <Typography variant="body1">
            Tap X to close the buy screen.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: "#speedChangeButtons",
        content: (
          <Typography variant="body1">
            Start the game by unpausing it. Hotkeys are in a row: `/1/2/3. Space
            and 0 also pause.
            <br />
            <br />
            This tutorial will run for 1 year. Try building different types of
            generators!
          </Typography>
        ),
      },
    ],
  },
  {
    id: 2, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "103: Storage",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 6,
    endTitle: "Tutorial complete!",
    endMessage:
      "You now know enough to run a company on Employee difficulty - or, continue tutorials to build your skills",
    facilities: [
      { name: "Pumped Hydro", peakWh: 500000000 },
      { fuel: "Coal", peakW: 480000000 },
    ],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: ".button-buildStorage",
        content: (
          <Typography variant="body1">
            When you're getting blackouts, generators aren't your only option.
            <br />
            <br />
            If you have power at other times of day, it's often cheaper to store
            that energy than build more generators.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_STORAGE", dontRemember: true },
        target: ".build-list-item",
        content: (
          <Typography variant="body1">
            Moving the slider changes their capacity and peak output.
          </Typography>
        ),
      },
      {
        card: { name: "BUILD_STORAGE", dontRemember: true },
        target: "#close-button",
        content: (
          <Typography variant="body1">
            Tap X to close the build screen.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".capacityProgressBar",
        content: (
          <Typography variant="body1">
            Like generators, the horizontal bar indicates how much electricity
            it's outputting.
            <br />
            <br />
            In addition, storage units have a vertical bar indicating how much
            energy is stored.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        content: (
          <Typography variant="body1">
            Hold and drag to re-order your generators and storage.
            <br />
            <br />
            Generators at the top produce first and only charge storage below
            them.
          </Typography>
        ),
      },
      {
        card: "FACILITIES",
        target: ".facility",
        onNext: () => setSpeed("SLOW"),
        content: (
          <Typography variant="body1">
            This tutorial will run for 6 months. Try changing the order of
            storage and generators to see how it affects their output!
          </Typography>
        ),
      },
    ],
  },
  {
    id: 4, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "104: Finances",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 1,
    endTitle: "Tutorial complete!",
    endMessage:
      "You now know enough to run a company on Manager difficulty - or, continue tutorials to build your skills",
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
          <Typography variant="body1">
            To run a profitable business, you'll need to understand the Finances
            tab. (Hotkey: W)
          </Typography>
        ),
        desktop: {
          target: "#financesPane",
          content: (
            <Typography variant="body1">
              To run a profitable business, you'll need to understand the
              Finances pane.
            </Typography>
          ),
        },
      },
      {
        card: "FINANCES",
        target: ".VictoryContainer",
        // Unqualified, this matches the Facilities pane's chart first once all three panes
        // are on screen
        desktop: { target: "#financesPane .VictoryContainer" },
        content: (
          <Typography variant="body1">
            You can plot a variety of metrics by changing the dropdowns above
            the chart. You can also plot previous years to analyze long term
            strategies.
          </Typography>
        ),
      },
      {
        card: "FINANCES",
        target: ".MuiTable-root",
        content: (
          <Typography variant="body1">
            The table shows you the high level numbers for your business for the
            selected year. Click on the table to get a more detailed breakdown
            of the numbers, and click it again to collapse it.
          </Typography>
        ),
      },
      {
        card: "FINANCES",
        target: "#speedChangeButtons",
        onNext: () => setSpeed("SLOW"),
        content: (
          <Typography variant="body1">
            This tutorial will run for 1 month - try playing around with the
            chart.
          </Typography>
        ),
      },
    ],
  },
  {
    id: 3, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "105: Marketing",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2019,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Tutorial complete!",
    endMessage:
      "You now know enough to run a company on VP difficulty - or, continue tutorials to build your skills",
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
          <Typography variant="body1">
            When you have spare capacity, you can use marketing to grow your
            business by heading to the "Finances" tab. (Hotkey: W)
          </Typography>
        ),
        desktop: {
          target: "#financesPane",
          content: (
            <Typography variant="body1">
              When you have spare capacity, you can use marketing to grow your
              business - look for it in the Finances pane.
            </Typography>
          ),
        },
      },
      {
        card: "FINANCES",
        target: "#marketingSlider",
        content: (
          <Typography variant="body1">
            Slide to increase your marketing budget, growing your customer base
            and demand.
          </Typography>
        ),
      },
      {
        card: "FINANCES",
        target: "#plotMetric",
        content: (
          <Typography variant="body1">
            Change the graph to plot Customers to see how they change over time.
            <br />
            <br />
            Beware, marketing too much too quickly may actually cost you
            customers through chronic blackouts!
          </Typography>
        ),
      },
      {
        card: "FINANCES",
        target: "#speedChangeButtons",
        onNext: () => setSpeed("SLOW"),
        content: (
          <Typography variant="body1">
            This tutorial will run for 1 year - see how changing your marketing
            budget changes your demand.
          </Typography>
        ),
      },
    ],
  },

  {
    id: 5, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: "106: Forecasting",
    locationId: "SF",
    ownership: "Investor",
    startingYear: 2020,
    cash: 200000000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.07,
    durationMonths: 12,
    endTitle: "Tutorial complete!",
    endMessage: `That's all we can teach you - the rest you'll have to learn by doing!`,
    facilities: [{ fuel: "Coal", peakW: 450000000 }],
    tutorialSteps: [
      {
        skipBeacon: true, // causes tutorial to auto-start
        card: "FACILITIES",
        target: "#forecastsNav",
        content: (
          <Typography variant="body1">
            To truly succeed, you'll need to plan ahead - let's check out the
            Forecasts tab. (Hotkey: E)
          </Typography>
        ),
        desktop: {
          target: "#forecastsPane",
          content: (
            <Typography variant="body1">
              To truly succeed, you'll need to plan ahead - let's check out the
              Forecasts pane.
            </Typography>
          ),
        },
      },
      {
        card: "FORECASTS",
        target: "#chartForecastSupplyDemand",
        content: (
          <Typography variant="body1">
            This chart shows forecasted supply and demand over the next year -
            including any upcoming blackouts. Try pausing a generator to see how
            it affects your ability to meet demand.
          </Typography>
        ),
      },
      {
        card: "FORECASTS",
        target: "#chartForecastSupplyByFuel",
        content: (
          <Typography variant="body1">
            This chart shows what fuels are supplying your electricity. Try
            dragging to re-order your facilities to see how it affects your fuel
            consumption.
          </Typography>
        ),
      },
      {
        card: "FORECASTS",
        target: "#chartForecastFuelPrices",
        content: (
          <Typography variant="body1">
            This chart shows forecasted fuel prices, based on real data. Fuel
            prices can change suddenly and significantly, affecting the
            profitability of your fuel-based generators.
          </Typography>
        ),
      },
      {
        card: "FORECASTS",
        target: "#chartForecastWeather",
        content: (
          <Typography variant="body1">
            This chart shows forecasted weather, which affects demand (such as
            heating and air conditioning) - and the output of solar and wind
            generators.
          </Typography>
        ),
      },
      {
        card: "FORECASTS",
        target: "#speedChangeButtons",
        onNext: () => setSpeed("FAST"),
        content: (
          <Typography variant="body1">
            To learn more about concepts, select "Manual" from the top left
            menu.
            <br />
            <br />
            This tutorial will run for 1 year so that you can see how the
            forecasts change over time.
          </Typography>
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
    cash: 300000000,
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
    cash: 200000000,
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
    cash: 250000000,
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
    cash: 200000000,
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
    cash: 200000000,
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
    cash: 180000000,
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

// The numbered 101-106 walkthroughs, in the order a new player should work through them
export const TUTORIALS = SCENARIOS.filter((s) => s.tutorialSteps);

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
