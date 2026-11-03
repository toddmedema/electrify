/* Executable authoring recipes. Tests compile and simulate every package through the real reducer. */
const base = (id, title) => ({
  $schema: "../scenario.schema.json",
  schemaVersion: 1,
  gameApi: 1,
  id,
  title,
  creator: "Electrify examples",
  version: "1",
  description:
    "Edit one bounded planning rule at a time, then validate and simulate it.",
  scenario: {
    startingYear: 2020,
    durationMonths: 6,
    startingCustomers: 10000,
    cash: 1e9,
  },
});
function createModRecipes() {
  const effects = {
    ...base("effect-recipes", "Timed effect recipes"),
    events: [
      {
        id: "planning-window",
        title: "Planning window",
        message: "Your grid faces new operating conditions.",
        preview:
          "Operating conditions will change from {{event}} to {{event+2 months}}.",
        startMonth: 2,
        durationMonths: 2,
        effects: {
          transmissionCapacityLimitsMWByCorridor: { "california-north": 4 },
          fuelPriceMultipliers: { "Natural Gas": 1.1 },
          outputMultipliersByFuel: { "Natural Gas": 0.95 },
          demandMultiplier: 1.05,
          temperatureOffsetC: 1,
          hydroInflowMultiplier: 1,
          constructionCostMultipliersByFuel: { "Natural Gas": 0.9 },
          operatingCostMultipliersByFuel: { "Natural Gas": 1.1 },
          operatingExpenseDollarsPerMonth: 1000,
          transactions: [
            { kind: "grant", amountDollars: 10000 },
            { kind: "charge", amountDollars: 1000 },
          ],
          carbonFeeDollarsPerTonneCO2e: 25,
          outputMultipliersBySelector: [
            {
              target: { selector: "largestOperating" },
              outputMultiplier: 0.99,
            },
          ],
        },
      },
    ],
  };
  const choices = {
    ...base("choice-recipes", "Connection choice recipe"),
    events: [
      {
        id: "campus",
        title: "Campus connection",
        message: "A permanent campus connects to your grid.",
        preview: "A 0.1 MW campus will connect in {{event}}.",
        startMonth: 3,
        loads: [
          {
            id: "campus-load",
            startMonth: 3,
            peakMW: 0.1,
            loadFactor: 0.8,
            demandType: "Data Centers",
          },
        ],
      },
      {
        id: "prepared-support",
        title: "Connection support",
        message: "Your grid receives the committed contribution.",
        preview: "Accepting funding will provide a contribution in {{event}}.",
        startMonth: 2,
        durationMonths: "untilEnd",
        requiresChoice: { choiceId: "funding", optionIds: ["accept"] },
        effects: { transactions: [{ kind: "grant", amountDollars: 1000 }] },
      },
    ],
    choices: [
      {
        id: "funding",
        title: "Connection funding",
        prompt: "Choose the funding and connection schedule for your grid.",
        dueMonth: 2,
        options: [
          {
            id: "accept",
            label: "Accept funding",
            description:
              "Receive 100,000 dollars and connect a 0.1 MW load in {{start+2 months}}.",
            message: "Your grid accepted the funding and connection.",
            grantDollars: 100000,
            replaceLoad: {
              loadId: "campus-load",
              with: [
                {
                  id: "funded-campus",
                  startMonth: 3,
                  peakMW: 0.1,
                  loadFactor: 0.8,
                  demandType: "Data Centers",
                },
              ],
            },
          },
          {
            id: "decline",
            label: "Keep the current grid",
            description: "Forgo funding and cancel the future campus load.",
            message: "Your grid declined funding and the future load.",
            replaceLoad: { loadId: "campus-load", with: [] },
          },
        ],
      },
    ],
  };
  const objectives = {
    ...base("objective-recipes", "Measured objective recipes"),
    objectives: [
      {
        id: "retention",
        label: "Retain customers",
        metric: "customerRetention",
        deadlineMonth: 6,
        minRetainedShare: 0.5,
        required: false,
      },
      {
        id: "budget",
        label: "Observe total emissions",
        metric: "emissionsBudget",
        fromMonth: 1,
        throughMonth: 6,
        budgetTonnesCO2e: 1e9,
        required: false,
      },
      {
        id: "intensity",
        label: "Observe the footprint",
        metric: "emissionsPerDeliveredMWh",
        fromMonth: 1,
        throughMonth: 6,
        maxKgCO2ePerMWh: 1e6,
        required: false,
      },
      {
        id: "local-gas",
        label: "Track local fuel delivery",
        metric: "localFuelShare",
        fromMonth: 1,
        throughMonth: 6,
        fuels: ["Natural Gas"],
        minShare: 0.5,
        required: false,
      },
      {
        id: "coal-retirement",
        label: "Keep coal retired",
        metric: "fuelRetirement",
        deadlineMonth: 3,
        fuel: "Coal",
        required: false,
      },
      {
        id: "bills",
        label: "Limit billed rates",
        metric: "monthlyBilledRate",
        fromMonth: 1,
        throughMonth: 6,
        maxDollarsPerKWh: 1,
        required: false,
      },
      {
        id: "debt",
        label: "Limit closing principal",
        metric: "monthEndDebt",
        fromMonth: 1,
        throughMonth: 6,
        maxDebtDollars: 1e12,
        required: false,
      },
    ],
  };
  const selectors = {
    ...base("selector-recipes", "Original asset target recipes"),
    events: [
      {
        id: "target-window",
        title: "Target window",
        message: "Output falls at the selected original generators.",
        preview: "Selected generator output will fall in {{event}}.",
        startMonth: 2,
        durationMonths: 1,
        effects: {
          outputMultipliersBySelector: [
            {
              target: { selector: "largestOperating", fuel: "Natural Gas" },
              outputMultiplier: 0.99,
            },
            {
              target: {
                selector: "oldestOperating",
                fuel: "Natural Gas",
                count: 1,
              },
              outputMultiplier: 0.99,
            },
            {
              target: {
                selector: "seededOperatingCapacityShare",
                targetCapacityShare: 0.5,
              },
              outputMultiplier: 0.99,
            },
            {
              target: {
                selector: "operatingAtLeastAge",
                fuel: "Natural Gas",
                minAgeYears: 0,
              },
              outputMultiplier: 0.99,
            },
            {
              target: {
                selector: "startingAsset",
                assetId: "scenario-999-natural-gas-peaker",
              },
              outputMultiplier: 0.99,
            },
          ],
        },
      },
    ],
  };
  return { effects, choices, objectives, selectors };
}
function createAuthoringTemplate() {
  const pack = createModRecipes().choices;
  return {
    ...pack,
    $schema: "./scenario.schema.json",
    id: "my-grid",
    title: "My Grid",
    creator: "Your name",
    description: "Choose a connection schedule and funding for your grid.",
  };
}
module.exports = { createModRecipes, createAuthoringTemplate };
