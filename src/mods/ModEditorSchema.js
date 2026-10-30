/* Editor schema is checked mechanically against the production structural parser. */
const {
  RULE_FUELS,
  RULE_DIFFICULTIES,
  RULE_SCENARIO_IDS,
  FACILITY_NAMES,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
  REPORT_KINDS,
  ID_PATTERN,
  RULE_LIMITS,
} = require("../helpers/ScenarioRulesSchema");
const {
  OBJECTIVE_DEFINITIONS,
} = require("../helpers/ScenarioObjectiveDefinitions");
const object = (
  properties,
  required = [],
  description = "Only listed fields are allowed.",
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  description,
});
const enumeration = (values, description) => ({ enum: values, description });
const numeric = (
  minimum,
  maximum,
  unit = "dimensionless",
  integer = false,
) => ({
  type: integer ? "integer" : "number",
  minimum,
  maximum,
  description: `${unit}; ${integer ? "integer" : "number"} ${minimum}–${maximum}.`,
});
const boolean = (description) => ({ type: "boolean", description });
const id = () => ({
  type: "string",
  pattern: ID_PATTERN.source,
  description:
    "Stable author ID: 1–64 lowercase ASCII letters, digits or hyphens, starting and ending alphanumeric. Event, choice, objective, report and load IDs share one package namespace; options are scoped to their choice.",
});
const safeTextPattern =
  "^(?![\\s\\S]*[\\x00-\\x1f\\x7f-\\x9f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069])(?![\\s\\S]*(?:<\\/?[a-zA-Z!][^>]*>|\\b[hH][tT][tT][pP][sS]?:\\/\\/|\\b[jJ][aA][vV][aA][sS][cC][rR][iI][pP][tT]:|\\b[dD][aA][tT][aA]:[^,\\s]*[,;]))[\\s\\S]*\\S[\\s\\S]*$";
const text = (
  maxLength,
  description = "Plain text; no HTML, URLs, control characters or expressions.",
) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: safeTextPattern,
  description: `${description} Up to ${maxLength} UTF-16 code units.`,
});
const list = (
  items,
  maxItems,
  minItems = 0,
  description = "References must be unique and valid in this package.",
) => ({ type: "array", items, minItems, maxItems, description });
const magnitude = (
  min,
  max,
  unit = "multiplier (1 = unchanged)",
  integer = false,
) => {
  const scalar = numeric(min, max, unit, integer);
  return {
    oneOf: [
      scalar,
      object(
        {
          byDifficulty: object(
            Object.fromEntries(RULE_DIFFICULTIES.map((d) => [d, scalar])),
            RULE_DIFFICULTIES,
            "Supply a value for every difficulty.",
          ),
        },
        ["byDifficulty"],
      ),
    ],
    description: `${scalar.description} Use a number or a complete byDifficulty table.`,
  };
};
const month = () =>
  numeric(
    1,
    1200,
    "Playable month, starting at 1 and within the scenario term",
    true,
  );
const fuel = () =>
  enumeration(
    RULE_FUELS,
    "Bundled generator fuel; imports and storage discharge have no fuel provenance.",
  );
const fuels = () => ({
  ...list(fuel(), RULE_FUELS.length, 1),
  uniqueItems: true,
});
const condition = () =>
  object(
    {
      arc: numeric(
        100,
        999,
        "Imported official arc ID; omit for an authored choice",
        true,
      ),
      choiceId: id(),
      optionIds: { ...list(id(), 8, 1), uniqueItems: true },
    },
    ["choiceId", "optionIds"],
    "Active when the choice selects any listed option. Same-month choices resolve before effects; dependencies cannot contain cycles.",
  );
const selector = () => ({
  oneOf: [
    object(
      { selector: { const: "largestOperating" }, fuel: fuel() },
      ["selector"],
      "Largest operating generator at onset, optionally restricted by fuel. Replacements never inherit its target.",
    ),
    object(
      {
        selector: { const: "oldestOperating" },
        fuel: fuel(),
        count: numeric(
          1,
          10,
          "Number of oldest operating generators at onset",
          true,
        ),
      },
      ["selector", "fuel", "count"],
    ),
    object(
      {
        selector: { const: "seededOperatingCapacityShare" },
        fuel: fuel(),
        targetCapacityShare: magnitude(
          0,
          1,
          "Share of operating generator capacity at onset",
        ),
      },
      ["selector", "targetCapacityShare"],
      "Select generators once at onset using the seed and capacity share. Replacements never inherit targets.",
    ),
    object(
      {
        selector: { const: "operatingAtLeastAge" },
        fuel: fuel(),
        minAgeYears: numeric(0, 200, "Minimum generator age in years at onset"),
      },
      ["selector", "fuel", "minAgeYears"],
    ),
    object(
      { selector: { const: "startingAsset" }, assetId: id() },
      ["selector", "assetId"],
      "Original bundled starting-asset ID from the resolved base; sold or replaced units do not transfer identity.",
    ),
  ],
  description:
    "Select targets at event onset. Ties use facility IDs; targets stay fixed for the event.",
});
const report = () => ({
  oneOf: REPORT_KINDS.map((kind) => {
    const props = { id: id(), kind: { const: kind }, label: text(100) };
    const required = ["id", "kind"];
    if (kind === "affectedFacilities") {
      props.eventId = id();
      required.push("eventId");
    } else {
      props.fromMonth = month();
      props.throughMonth = month();
      required.push("fromMonth", "throughMonth");
    }
    if (kind === "fuelMix") {
      props.fuels = fuels();
      props.basis = enumeration(
        ["localGeneration", "customerDemand"],
        "Denominator for recorded fuel-delivered Wh; localGeneration is default.",
      );
      required.push("fuels");
    }
    if (kind === "reliability")
      props.minDemandServedShare = numeric(
        0,
        1,
        "Minimum completed-month customer demand served share",
      );
    return object(
      props,
      required,
      "Report on completed months in an inclusive window within the term. Missing observations are unavailable.",
    );
  }),
  description:
    "Choose a built-in report: one at onset and one at expiry per event, plus up to 16 debrief reports.",
});
const load = () => ({
  ...object(
    {
      id: id(),
      startMonth: month(),
      demandType: enumeration(
        ["Data Centers", "Mining"],
        "Permanent customer load category.",
      ),
      loadFactor: numeric(0.01, 1, "Annual average / peak load factor"),
      supplementsBackground: boolean(
        "Whether this permanent load supplements the ordinary background load.",
      ),
      peakMW: numeric(0.001, 100000, "Peak capacity in MW"),
      peakShareOfStartingPeak: numeric(
        0.000001,
        1,
        "Share of starting peak demand; 0.2 means 100 MW on a 500 MW grid",
      ),
    },
    ["id", "startMonth", "demandType", "loadFactor"],
    "Permanent load. Choose exactly one peak size; replacement is allowed only before the original load starts.",
  ),
  oneOf: [
    { required: ["peakMW"], not: { required: ["peakShareOfStartingPeak"] } },
    { required: ["peakShareOfStartingPeak"], not: { required: ["peakMW"] } },
  ],
});
const effects = () => {
  const props = {};
  props.transmissionCapacityLimitsMWByCorridor = {
    type: "object",
    minProperties: 1,
    maxProperties: 64,
    propertyNames: { type: "string", pattern: ID_PATTERN.source },
    additionalProperties: magnitude(0, 1e6, "Capacity cap in MW"),
    description:
      "Corridor capacity cap in MW, including upgrades. Zero closes both directions; overlapping caps use the smallest value.",
  };
  for (const [key, min, max, names] of [
    [
      "fuelPriceMultipliers",
      0.1,
      10,
      ["Coal", "Uranium", "Natural Gas", "Oil", "Biomass"],
    ],
    ["outputMultipliersByFuel", 0, 1, RULE_FUELS],
    ["constructionCostMultipliersByFuel", 0.1, 10, RULE_FUELS],
    ["operatingCostMultipliersByFuel", 0.1, 10, RULE_FUELS],
  ])
    props[key] = object(
      Object.fromEntries(names.map((name) => [name, magnitude(min, max)])),
      [],
      `${key} by fuel. Simultaneous factors multiply; committed purchase costs stay fixed.`,
    );
  for (const [key, min, max, unit] of [
    ["demandMultiplier", 0.1, 10, "Demand factor"],
    [
      "temperatureOffsetC",
      -30,
      30,
      "Temperature offset in °C; simultaneous offsets add",
    ],
    [
      "hydroInflowMultiplier",
      0,
      10,
      "Hydro inflow factor; zero is meaningful, and composed positive factors must stay 0.1–10",
    ],
    ["operatingExpenseDollarsPerMonth", 0, 1e12, "Dollars per active month"],
    [
      "carbonFeeDollarsPerTonneCO2e",
      0,
      100000,
      "Absolute dollars/tonne CO₂e; overlapping co-reachable overrides are rejected",
    ],
  ])
    props[key] = magnitude(min, max, unit);
  props.outputMultipliersBySelector = list(
    object(
      {
        target: selector(),
        outputMultiplier: magnitude(
          0,
          1,
          "Output factor for selected facilities",
        ),
      },
      ["target", "outputMultiplier"],
    ),
    10,
    1,
  );
  props.transactions = list(
    object(
      {
        kind: enumeration(
          ["charge", "grant"],
          "One-time charge or grant at event onset.",
        ),
        amountDollars: magnitude(
          0,
          1e12,
          "One-time dollars in the resolved starting year's price level; books once per company",
        ),
      },
      ["kind", "amountDollars"],
    ),
    2,
    1,
  );
  return object(
    props,
    [],
    "Built-in timed effects. Scripts and expressions are unsupported.",
  );
};
const event = () => ({
  ...object(
    {
      id: id(),
      title: text(100),
      message: text(
        500,
        "Live event text, addressed to one company as you/your grid.",
      ),
      startMonth: {
        oneOf: [
          month(),
          object(
            { from: month(), to: month() },
            ["from", "to"],
            "Inclusive seeded onset range; every possible month is validated.",
          ),
        ],
        description:
          "Opening of one-based month, before its first tick. Seeded range must be ordered.",
      },
      durationMonths: {
        oneOf: [
          magnitude(1, 1200, "Active months including onset", true),
          { const: "untilEnd", description: "Explicit rest-of-run duration." },
        ],
        description:
          "Required for mechanical effects; numeric durations past term produce truncation warnings.",
      },
      visibility: enumeration(
        ["forecast", "surprise"],
        "Forecast is default. Surprise events stay out of player previews and Workshop Rules; author reports include them.",
      ),
      preview: text(200, "Optional preview; defaults to the event message."),
      endMessage: text(500),
      requiresChoice: condition(),
      effects: effects(),
      loads: list(load(), RULE_LIMITS.loadsPerEvent, 1),
      report: report(),
      endReport: report(),
    },
    ["id", "title", "message", "startMonth"],
  ),
  allOf: [
    { if: { required: ["effects"] }, then: { required: ["durationMonths"] } },
  ],
});
const option = () => ({
  ...object(
    {
      id: id(),
      label: text(100),
      description: text(
        500,
        "Declared consequences before the company chooses.",
      ),
      message: text(500, "Recorded outcome addressed to one company."),
      costDollars: magnitude(
        0,
        1e12,
        "Immediate cost in dollars; zero is a free option",
      ),
      grantDollars: magnitude(0, 1e12, "Immediate grant in dollars"),
      replaceLoad: object(
        {
          arc: numeric(
            100,
            999,
            "Imported official arc ID; omit for authored load",
            true,
          ),
          loadId: id(),
          with: list(load(), 4),
        },
        ["loadId", "with"],
        "Replaces only this not-yet-started permanent load; an empty list cancels it.",
      ),
      eventIds: list(id(), 100),
    },
    ["id", "label", "description", "message"],
  ),
  not: { required: ["costDollars", "grantDollars"] },
});
const objective = () => ({
  oneOf: Object.entries(OBJECTIVE_DEFINITIONS).map(([metric, definition]) => {
    const props = {
      id: id(),
      label: text(100),
      metric: { const: metric, description: definition },
      required: boolean(
        "Defaults to true. Set false for an optional goal that cannot end the run.",
      ),
    };
    const required = ["id", "label", "metric"];
    if (["customerRetention", "fuelRetirement"].includes(metric)) {
      props.deadlineMonth = month();
      required.push("deadlineMonth");
    } else {
      props.fromMonth = month();
      props.throughMonth = month();
      required.push("fromMonth", "throughMonth");
    }
    const targets = {
      customerRetention: {
        minRetainedShare: numeric(
          0,
          1,
          "Share of recorded starting customers at deadline",
        ),
      },
      emissionsBudget: {
        budgetTonnesCO2e: numeric(
          0,
          1e12,
          "Total tonnes CO₂e over the inclusive window",
        ),
      },
      emissionsPerDeliveredMWh: {
        maxKgCO2ePerMWh: numeric(
          0,
          1e6,
          "Total kg CO₂e per delivered customer MWh over the window",
        ),
      },
      localFuelShare: {
        fuels: fuels(),
        minShare: numeric(
          0,
          1,
          "Share of local fuel-delivered Wh; imports and storage excluded",
        ),
      },
      fuelRetirement: { fuel: fuel() },
      monthlyBilledRate: {
        maxDollarsPerKWh: numeric(
          0,
          100,
          "Billed dollars per delivered kWh; excludes grants and exports",
        ),
      },
      monthEndDebt: {
        maxDebtDollars: numeric(
          0,
          1e12,
          "Month-end loan principal limit in dollars; excludes interest",
        ),
      },
    }[metric];
    Object.assign(props, targets);
    required.push(...Object.keys(targets));
    return object(
      props,
      required,
      `${definition} Requires completed-month observations.`,
    );
  }),
  description:
    "Choose a goal metric and an inclusive window or deadline within the term. Goals cannot trigger rewards or actions.",
});
function createModEditorSchema() {
  const objectives = list(objective(), RULE_LIMITS.objectives);
  const schema = object(
    {
      $schema: {
        type: "string",
        maxLength: 2048,
        pattern:
          "^[^\\x00-\\x1f\\x7f-\\x9f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]*$",
        description:
          "Editor schema path, usually ./scenario.schema.json. Does not affect gameplay.",
      },
      schemaVersion: {
        const: 1,
        description: "Package format version. Set to 1.",
      },
      gameApi: {
        const: 1,
        description: "Game API version. Set to 1.",
      },
      id: id(),
      title: text(
        100,
        "Scenario title, also limited to 128 UTF-8 bytes for Steam.",
      ),
      creator: text(100),
      version: text(40, "Your package version label."),
      description: text(
        2000,
        "Author description only. Publishing appends a generated Rules section; never paste that section here.",
      ),
      seed: numeric(
        0,
        4294967295,
        "Optional fixed seed for reproducing weather and random event timing; defaults to 0",
        true,
      ),
      baseScenarioId: enumeration(
        [999, ...RULE_SCENARIO_IDS],
        "Optional built-in starting grid. Omit for a custom scenario.",
      ),
      scenario: object(
        {
          location: object(
            {
              id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" },
              name: text(100),
              lat: numeric(-90, 90, "Latitude"),
              long: numeric(-180, 180, "Longitude"),
              admin: text(100),
              timeZone: text(100),
              region: text(100),
              country: text(100),
              elevation: numeric(-500, 10000, "Metres above sea level"),
              watershedId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,32}$" },
              watershedName: text(100),
              offshore: boolean(),
              resources: object({ hydro: boolean(), geothermal: boolean() }),
            },
            ["id", "name", "lat", "long"],
            "Location; defaults to San Francisco without a base scenario.",
          ),
          startingFleet: list(
            {
              ...object(
                {
                  id: id(),
                  name: enumeration(FACILITY_NAMES),
                  peakMW: numeric(0.001, 100000, "Generator power in MW"),
                  peakMWh: numeric(0.001, 1000000, "Storage energy in MWh"),
                  ageYears: numeric(0, 200, "Age at start; defaults to 0"),
                  hydroSiteId: text(64),
                  reservoirFraction: numeric(0, 1, "Starting reservoir share"),
                },
                ["name"],
              ),
              allOf: [
                {
                  if: {
                    properties: {
                      name: {
                        enum: ["Battery", "Iron-Air Battery", "Pumped Hydro"],
                      },
                    },
                  },
                  then: { required: ["peakMWh"] },
                  else: {
                    required: ["peakMW"],
                    not: { required: ["peakMWh"] },
                  },
                },
                {
                  if: { properties: { name: { not: { const: "Hydro" } } } },
                  then: {
                    not: {
                      anyOf: [
                        { required: ["hydroSiteId"] },
                        { required: ["reservoirFraction"] },
                      ],
                    },
                  },
                },
              ],
            },
            100,
          ),
          cash: numeric(0, 1e12, "Starting cash in dollars"),
          startingYear: numeric(
            1980,
            2100,
            "Calendar starting year; all inherited assets must exist then",
            true,
          ),
          startingCustomers: numeric(1, 1e8, "Customer count", true),
          startingDemandScale: numeric(
            0.01,
            100,
            "Bundled demand calibration factor",
          ),
          dollarsPerkWh: numeric(0, 100, "Billed dollars per kWh"),
          durationMonths: numeric(6, 1200, "Playable months", true),
          feePerKgCO2e: numeric(
            0,
            100,
            "Initial dollars/kgCO₂e; timed fees use dollars/tonne",
          ),
          ownership: enumeration(
            ["Investor", "Public"],
            "Bundled ownership model.",
          ),
          endTitle: text(500),
          endMessage: text(500),
        },
        [],
        "Starting conditions. Omitted values use the custom-game defaults or the chosen base.",
      ),
      facilities: object(
        Object.fromEntries(
          FACILITY_NAMES.map((name) => [
            name,
            object(
              Object.fromEntries(
                FACILITY_MODIFIER_KEYS.map((key) => [
                  key,
                  numeric(
                    0.1,
                    10,
                    "Static quote multiplier; owned costs remain fixed",
                  ),
                ]),
              ),
            ),
          ]),
        ),
        [],
        "Static modifiers by exact facility name; multiply timed fuel-cost factors for new quotes only.",
      ),
      programs: object(
        Object.fromEntries(
          PROGRAM_KEYS.map((key) => [
            key,
            numeric(0.1, 10, "Static build-out program cost multiplier"),
          ]),
        ),
      ),
      officialArcs: list(
        object(
          {
            scenarioId: enumeration(
              RULE_SCENARIO_IDS,
              "Importable bundled challenge arc; never grants official status or objectives.",
            ),
            includeChoices: boolean(
              "Defaults to true: ask each company. False selects the free option automatically.",
            ),
          },
          ["scenarioId"],
        ),
        14,
      ),
      events: list(event(), RULE_LIMITS.events),
      choices: list(
        object(
          {
            id: id(),
            dueMonth: month(),
            title: text(100),
            prompt: text(500),
            requiresChoice: condition(),
            options: list(option(), RULE_LIMITS.options, 2),
          },
          ["id", "dueMonth", "title", "prompt", "options"],
        ),
        RULE_LIMITS.choices,
      ),
      objectives: {
        ...objectives,
        description:
          "Goals to meet. Omit to keep the base goals; a list replaces them, including an empty list for a survival-only run.",
      },
      debriefReports: list(report(), RULE_LIMITS.debriefReports),
    },
    [
      "schemaVersion",
      "gameApi",
      "id",
      "title",
      "creator",
      "version",
      "description",
    ],
    "Electrify scenario package, at most 256 KiB of UTF-8 JSON. Run mods:validate to check timing, references, combined effects, assets and byte limits.",
  );
  const document = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Electrify scenario package",
    ...schema,
  };
  const documentFields = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      if (!value.description)
        value.description = `${value.const === undefined ? `Values for ${key}` : `Must be ${JSON.stringify(value.const)}`}.`;
    }
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(documentFields);
      else if (value && typeof value === "object") documentFields(value);
    });
  };
  documentFields(document);
  return document;
}
module.exports = { createModEditorSchema };
