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
  description = "A bounded data-only object; unsupported fields are rejected.",
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
  description: `${unit}; ${integer ? "whole numbers" : "finite numbers"} ${minimum}–${maximum}. Resolved only in the declared scope.`,
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
  description: `${description} At most ${maxLength} UTF-16 code units; the parser also enforces UTF-8 byte ceilings.`,
});
const list = (
  items,
  maxItems,
  minItems = 0,
  description = "Bounded list; referenced identities must be unique and valid in this package.",
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
            "Complete difficulty table; every named difficulty is required and independently validated.",
          ),
        },
        ["byDifficulty"],
      ),
    ],
    description: `${scalar.description} A scalar or one complete byDifficulty table; no nesting or expressions.`,
  };
};
const month = () =>
  numeric(
    1,
    1200,
    "One-based playable month (month 1 opens at monthsElapsed 0); must lie within the resolved term",
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
    "Active only after this choice selects any one listed option. Same-month choice resolves before effects; dependencies must form an acyclic reachable forest.",
  );
const selector = () => ({
  oneOf: [
    object(
      { selector: { const: "largestOperating" }, fuel: fuel() },
      ["selector"],
      "Largest operating generator at onset; optional fuel restricts the candidates. Stable identity persists after sale.",
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
      "Seeded operating capacity-share targets bind original facility identities once; replacements never inherit targets.",
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
    "One whitelisted target selector, resolved at event onset. Ties use stable facility IDs; targets are persisted for save/replay.",
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
      "Engine-generated observation from completed recorded facts only. Inclusive windows must be ordered and within term; missing facts report unavailable.",
    );
  }),
  description:
    "Whitelisted engine report; no authored formulas. At most one onset and one expiry report per event; at most 16 debrief reports.",
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
      peakMW: numeric(
        0.001,
        100000,
        "Peak MW; 100 means 100 MW, converted once to watts",
      ),
      peakShareOfStartingPeak: numeric(
        0.000001,
        1,
        "Share of the real engine's resolved starting peak; 100 MW on 500 MW is 0.2",
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
      `${key} by bundled fuel. Multipliers compose with simultaneous timed and static factors; owned costs are not rewritten.`,
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
    [
      "operatingExpenseDollarsPerMonth",
      0,
      1e12,
      "Dollars per active month in the resolved starting year's price level",
    ],
    [
      "carbonFeeDollarsPerTonneCO2e",
      0,
      100000,
      "Absolute dollars/tonne CO₂e in starting-year dollars; overlapping co-reachable overrides are rejected",
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
          "Output factor for bound target identities",
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
          "One-time company accounting transaction at event opening.",
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
    "Timed whitelisted effects only. Numeric quantities convert once during compilation. No scripts, property paths or expressions.",
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
      preview: text(
        200,
        "Future-tense preview required for announced mechanical events/loads.",
      ),
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
    {
      if: {
        allOf: [
          {
            anyOf: [
              { required: ["effects"] },
              { properties: { loads: { minItems: 1 } }, required: ["loads"] },
            ],
          },
          {
            not: {
              properties: { visibility: { const: "surprise" } },
              required: ["visibility"],
            },
          },
        ],
      },
      then: { required: ["preview"] },
    },
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
        "Immediate cost in starting-year dollars; zero is a free option",
      ),
      grantDollars: magnitude(
        0,
        1e12,
        "Immediate grant in starting-year dollars",
      ),
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
  oneOf: [
    { required: ["costDollars"], not: { required: ["grantDollars"] } },
    { required: ["grantDollars"], not: { required: ["costDollars"] } },
  ],
});
const objective = () => ({
  oneOf: Object.entries(OBJECTIVE_DEFINITIONS).map(([metric, definition]) => {
    const props = {
      id: id(),
      label: text(100),
      metric: { const: metric, description: definition },
      required: boolean(
        "Defaulttrue. Required failure may end the company run; optional goals never end/fail it.",
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
      monthlyReliability: {
        minDemandServedShare: numeric(
          0,
          1,
          "Completed-month demand served share; every month",
        ),
      },
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
          "TonnesCO₂e summed once over inclusive completed-month window",
        ),
      },
      emissionsPerDeliveredMWh: {
        maxKgCO2ePerMWh: numeric(
          0,
          1e6,
          "kgCO₂e per delivered customerMWh; ratio of sums",
        ),
      },
      localFuelShare: {
        fuels: fuels(),
        minShare: numeric(
          0,
          1,
          "Share of local fuel-deliveredWh; imports/storage excluded",
        ),
      },
      fuelRetirement: { fuel: fuel() },
      monthlyBilledRate: {
        maxDollarsPerKWh: numeric(
          0,
          100,
          "Starting-year dollars per deliveredkWh; monthly billed customer revenue excludes grants/exports",
        ),
      },
      monthEndDebt: {
        maxDebtDollars: numeric(
          0,
          1e12,
          "Month-close loan principal ceiling in starting-year dollars; not interest",
        ),
      },
    }[metric];
    Object.assign(props, targets);
    required.push(...Object.keys(targets));
    return object(
      props,
      required,
      `${definition} Exactly one observation per required completed month; no empty-window or zero-denominator success.`,
    );
  }),
  description:
    "One of eight measured goals. Inclusive one-based windows/deadlines must lie inside the resolved term. No rewards, Boolean expressions or triggered actions.",
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
          "Offline editor schema reference, normally ./scenario.schema.json; ignored by simulation and digests.",
      },
      schemaVersion: {
        const: 1,
        description: "First-release JSON shape version; authors set exactly 1.",
      },
      gameApi: {
        const: 1,
        description:
          "First-release game contract version; authors set exactly 1. Runtime versions/digests are computed, never authored.",
      },
      id: id(),
      title: text(
        100,
        "Scenario title, also limited to 128 UTF-8 bytes for Steam.",
      ),
      creator: text(100),
      version: text(40, "Creator's label, with no compatibility meaning."),
      description: text(
        2000,
        "Author description only. Publishing appends a generated Rules section; never paste that section here.",
      ),
      seed: numeric(0, 4294967295, "Deterministic run seed", true),
      baseScenarioId: enumeration(
        [999, ...RULE_SCENARIO_IDS],
        "Bundled setup to inherit; 999 is Custom Game. Community runs always launch as 999 and stay unranked.",
      ),
      scenario: object(
        {
          cash: numeric(
            0,
            1e12,
            "Cash in dollars of the resolved starting year",
          ),
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
          dollarsPerkWh: numeric(
            0,
            100,
            "Billed dollars/kWh of resolved starting year",
          ),
          durationMonths: numeric(6, 1200, "Playable months", true),
          feePerKgCO2e: numeric(
            0,
            100,
            "Initial dollars/kgCO₂e in starting-year dollars; timed fees use dollars/tonne",
          ),
          ownership: enumeration(
            ["Investor", "Public"],
            "Bundled ownership model.",
          ),
          endTitle: text(500),
          endMessage: text(500),
        },
        [],
        "Allowed setup overrides only; location and starting fleet come from the bundled base.",
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
              "True prompts each company;false automatically selects each adapted free option at due month.",
            ),
          },
          ["scenarioId", "includeChoices"],
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
        oneOf: [
          object(
            {
              mode: {
                const: "inherit",
                description: "Keep base goals, relocated with the term.",
              },
              add: objectives,
            },
            ["mode"],
          ),
          object(
            {
              mode: {
                const: "replace",
                description:
                  "Replace all base goals with items;--explain prints replace-ready inheritedJSON.",
              },
              items: objectives,
            },
            ["mode", "items"],
          ),
          object(
            {
              mode: {
                const: "none",
                description:
                  "No scenario goals; survive to finalmonth, while ordinary game failures still apply.",
              },
            },
            ["mode"],
          ),
        ],
        description:
          "Required explicit goal intent; arcs never add goals implicitly.",
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
      "seed",
      "baseScenarioId",
      "objectives",
    ],
    "Electrify data-only scenario package. 256 KiB UTF-8 maximum; 32 installs. Units, bounds and scope are stated per field. The production compiler additionally checks term windows, references, reachability, composed factors, starting assets and byte ceilings.",
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
        value.description = `Field ${key}; ${value.const === undefined ? "bounded by this rule variant" : `must be ${JSON.stringify(value.const)}`}. No unit; applies only to the enclosing declared operation.`;
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
