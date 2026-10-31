const { scenarioTextError, scenarioTextLength } = require("./ScenarioText");
/* Shared declarative contract. Dependency-free so Electron can structurally validate packages. */
const FACILITY_NAMES = [
  "Coal",
  "Nuclear",
  "Natural Gas Peaker",
  "Natural Gas CC",
  "Oil",
  "Biomass",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
  "Solar",
  "Hydro",
  "Geothermal",
  "Enhanced Geothermal",
  "Battery",
  "Iron-Air Battery",
  "Pumped Hydro",
];

const RULE_SCENARIO_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115, 116,
];
const FACILITY_MODIFIER_KEYS = [
  "buildCost",
  "annualOperatingCost",
  "yearsToBuild",
];
const PROGRAM_KEYS = ["efficiency", "solar"];
const RULE_DIFFICULTIES = ["Intern", "Employee", "Manager", "VP", "CEO"];
const RULE_FUELS = [
  "Coal",
  "Uranium",
  "Natural Gas",
  "Oil",
  "Biomass",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
  "Sun",
  "Hydro",
  "Geothermal",
];
const RULE_LIMITS = {
  events: 100,
  choices: 32,
  options: 8,
  objectives: 16,
  debriefReports: 16,
  loadsPerEvent: 4,
  compiledBytes: 512 * 1024,
};
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UNSAFE_TEXT =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;
const UNSAFE_MARKUP =
  /<\/?[a-z!][^>]*>|\b(?:https?:\/\/|javascript:)|\bdata:[^,\s]*[,;]/i;
const REPORT_KINDS = [
  "reliability",
  "affectedFacilities",
  "fuelMix",
  "firmCoverage",
  "storageCoverage",
  "profitLoss",
  "dataCenter",
  "deepFreeze",
];
const OBJECTIVE_METRICS = [
  "customerRetention",
  "emissionsBudget",
  "emissionsPerDeliveredMWh",
  "localFuelShare",
  "fuelRetirement",
  "monthlyBilledRate",
  "monthEndDebt",
  "utilityOwnership",
  "assetRetirement",
];
/** Reject functions, accessors, cycles and nonfinite values before detaching JSON data. */
function isRuleJson(value, ancestors = new Set(), depth = 0) {
  if (depth > 24) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || ancestors.has(value)) return false;
  if (
    Array.isArray(value)
      ? Object.getPrototypeOf(value) !== Array.prototype
      : ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string"))
    return false;
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const valid =
    Object.entries(descriptors).every(([key, descriptor]) => {
      if (Array.isArray(value) && key === "length") return true;
      return (
        descriptor.enumerable &&
        "value" in descriptor &&
        isRuleJson(descriptor.value, ancestors, depth + 1)
      );
    }) &&
    (!Array.isArray(value) || Object.keys(value).length === value.length);
  ancestors.delete(value);
  return valid;
}
function ruleDiagnostics(value, path = "") {
  if (!isRuleJson(value))
    return [
      {
        code: "invalid-json",
        path,
        severity: "error",
        message: `${path} must contain finite plain JSON data only.`,
      },
    ];
  const diagnostics = [];
  const at = (base, key) => (base ? `${base}.${key}` : key);
  const add = (code, path, message) =>
    diagnostics.push({
      code,
      path,
      severity: "error",
      message: `${path} ${message}`,
    });
  const object = (v, p, keys) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      add("invalid-object", p, "must be an object.");
      return false;
    }
    Object.keys(v).forEach((key) => {
      if (!keys.includes(key))
        add("unknown-field", at(p, key), "is not a supported rule field.");
    });
    return true;
  };
  const text = (v, p, max, optional = false) => {
    if (v === undefined && optional) return;
    if (typeof v !== "string" || !v.trim()) {
      add("invalid-text", p, "must be non-empty text.");
      return;
    }
    const templateError = scenarioTextError(v, /^(events|choices)\[/.test(p));
    if (templateError) add("date-template", p, templateError);
    if (scenarioTextLength(v, /^(events|choices)\[/.test(p)) > max)
      add(
        "text-limit",
        p,
        `must be at most ${max} characters after date substitution.`,
      );
    if (UNSAFE_TEXT.test(v) || UNSAFE_MARKUP.test(v))
      add(
        "unsafe-text",
        p,
        "must be plain text without control characters, HTML or URLs.",
      );
  };
  const number = (v, p, min, max, integer = false) => {
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      add(
        "number-bounds",
        p,
        `must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`,
      );
  };
  const magnitude = (v, p, min, max, integer = false) => {
    if (typeof v === "number") return number(v, p, min, max, integer);
    if (!object(v, p, ["byDifficulty"])) return;
    if (!object(v.byDifficulty, at(p, "byDifficulty"), RULE_DIFFICULTIES))
      return;
    RULE_DIFFICULTIES.forEach((d) =>
      number(
        v.byDifficulty[d],
        at(at(p, "byDifficulty"), d),
        min,
        max,
        integer,
      ),
    );
  };
  const id = (v, p) => {
    if (typeof v !== "string" || !ID_PATTERN.test(v))
      add(
        "invalid-id",
        p,
        "must be 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
      );
  };
  const list = (v, p, max, min = 0) => {
    if (!Array.isArray(v)) {
      add("invalid-list", p, "must be a list.");
      return false;
    }
    if (v.length > max || v.length < min)
      add("list-limit", p, `must contain ${min}–${max} items.`);
    return true;
  };
  const enumValue = (v, p, values) => {
    if (!values.includes(v))
      add("invalid-value", p, `must be one of: ${values.join(", ")}.`);
  };
  const month = (v, p) => number(v, p, 1, 1200, true);
  const window = (v, p) => {
    month(v.fromMonth, at(p, "fromMonth"));
    month(v.throughMonth, at(p, "throughMonth"));
    if (v.fromMonth > v.throughMonth)
      add("invalid-window", p, "must end on or after its first month.");
  };
  const fuel = (v, p) => enumValue(v, p, RULE_FUELS);
  const fuels = (v, p) => {
    if (list(v, p, RULE_FUELS.length, 1)) {
      v.forEach((f, i) => fuel(f, `${p}[${i}]`));
      if (new Set(v).size !== v.length)
        add("duplicate-reference", p, "must not repeat a fuel.");
    }
  };
  const condition = (v, p) => {
    if (!object(v, p, ["arc", "choiceId", "optionIds"])) return;
    if (v.arc !== undefined) number(v.arc, at(p, "arc"), 100, 999, true);
    id(v.choiceId, at(p, "choiceId"));
    if (list(v.optionIds, at(p, "optionIds"), 8, 1)) {
      v.optionIds.forEach((o, i) => id(o, `${p}.optionIds[${i}]`));
      if (new Set(v.optionIds).size !== v.optionIds.length)
        add(
          "duplicate-reference",
          at(p, "optionIds"),
          "must not repeat an option.",
        );
    }
  };
  const selector = (v, p) => {
    const keys = {
      largestOperating: ["selector", "fuel"],
      oldestOperating: ["selector", "fuel", "count"],
      seededOperatingCapacityShare: ["selector", "fuel", "targetCapacityShare"],
      operatingAtLeastAge: ["selector", "fuel", "minAgeYears"],
      startingAsset: ["selector", "assetId"],
    };
    if (
      !object(
        v,
        p,
        Object.prototype.hasOwnProperty.call(keys, v?.selector)
          ? keys[v.selector]
          : ["selector"],
      )
    )
      return;
    enumValue(v.selector, at(p, "selector"), Object.keys(keys));
    if (
      v.fuel !== undefined ||
      ["oldestOperating", "operatingAtLeastAge"].includes(v.selector)
    )
      fuel(v.fuel, at(p, "fuel"));
    if (v.selector === "oldestOperating")
      number(v.count, at(p, "count"), 1, 10, true);
    if (v.selector === "seededOperatingCapacityShare")
      magnitude(v.targetCapacityShare, at(p, "targetCapacityShare"), 0, 1);
    if (v.selector === "operatingAtLeastAge")
      number(v.minAgeYears, at(p, "minAgeYears"), 0, 200);
    if (v.selector === "startingAsset") id(v.assetId, at(p, "assetId"));
  };
  const report = (v, p) => {
    if (
      !object(v, p, [
        "id",
        "kind",
        "label",
        ...(v?.kind === "affectedFacilities"
          ? ["eventId"]
          : ["fromMonth", "throughMonth"]),
        ...(v?.kind === "fuelMix" ? ["fuels", "basis"] : []),
        ...(v?.kind === "reliability" ? ["minDemandServedShare"] : []),
      ])
    )
      return;
    id(v.id, at(p, "id"));
    enumValue(v.kind, at(p, "kind"), REPORT_KINDS);
    text(v.label, at(p, "label"), 100, true);
    if (v.kind === "affectedFacilities") id(v.eventId, at(p, "eventId"));
    else window(v, p);
    if (v.kind === "fuelMix") fuels(v.fuels, at(p, "fuels"));
    if (v.basis !== undefined)
      enumValue(v.basis, at(p, "basis"), ["localGeneration", "customerDemand"]);
    if (v.minDemandServedShare !== undefined)
      number(v.minDemandServedShare, at(p, "minDemandServedShare"), 0, 1);
  };
  const load = (v, p) => {
    if (
      !object(v, p, [
        "id",
        "startMonth",
        "demandType",
        "loadFactor",
        "supplementsBackground",
        "peakMW",
        "peakShareOfStartingPeak",
      ])
    )
      return;
    id(v.id, at(p, "id"));
    month(v.startMonth, at(p, "startMonth"));
    enumValue(v.demandType, at(p, "demandType"), ["Data Centers", "Mining"]);
    number(v.loadFactor, at(p, "loadFactor"), 0.01, 1);
    if (
      v.supplementsBackground !== undefined &&
      typeof v.supplementsBackground !== "boolean"
    )
      add(
        "invalid-value",
        at(p, "supplementsBackground"),
        "must be true or false.",
      );
    if ((v.peakMW === undefined) === (v.peakShareOfStartingPeak === undefined))
      add(
        "load-size",
        p,
        "must specify exactly one of peakMW or peakShareOfStartingPeak.",
      );
    if (v.peakMW !== undefined)
      number(v.peakMW, at(p, "peakMW"), 0.001, 100000);
    if (v.peakShareOfStartingPeak !== undefined)
      number(
        v.peakShareOfStartingPeak,
        at(p, "peakShareOfStartingPeak"),
        0.000001,
        1,
      );
  };
  const effects = (v, p) => {
    const maps = {
      fuelPriceMultipliers: [0.1, 10],
      outputMultipliersByFuel: [0, 1],
      constructionCostMultipliersByFuel: [0.1, 10],
      operatingCostMultipliersByFuel: [0.1, 10],
    };
    const scalars = {
      demandMultiplier: [0.1, 10],
      temperatureOffsetC: [-30, 30],
      hydroInflowMultiplier: [0, 10],
      operatingExpenseDollarsPerMonth: [0, 1e12],
      carbonFeeDollarsPerTonneCO2e: [0, 100000],
    };
    if (
      !object(v, p, [
        ...Object.keys(maps),
        ...Object.keys(scalars),
        "outputMultipliersBySelector",
        "transmissionCapacityLimitsMWByCorridor",
        "transactions",
      ])
    )
      return;
    const corridorLimits = v.transmissionCapacityLimitsMWByCorridor;
    if (
      corridorLimits !== undefined &&
      object(
        corridorLimits,
        at(p, "transmissionCapacityLimitsMWByCorridor"),
        Object.keys(corridorLimits ?? {}),
      )
    ) {
      const entries = Object.entries(corridorLimits);
      if (!entries.length || entries.length > 64)
        add(
          "count-limit",
          at(p, "transmissionCapacityLimitsMWByCorridor"),
          "must contain 1–64 corridor limits.",
        );
      for (const [corridor, value] of entries) {
        const path = at(
          at(p, "transmissionCapacityLimitsMWByCorridor"),
          corridor,
        );
        id(corridor, path);
        magnitude(value, path, 0, 1e6);
      }
    }
    for (const [key, bounds] of Object.entries(maps))
      if (
        v[key] !== undefined &&
        object(
          v[key],
          at(p, key),
          key === "fuelPriceMultipliers"
            ? ["Coal", "Uranium", "Natural Gas", "Oil", "Biomass"]
            : RULE_FUELS,
        )
      )
        for (const [name, n] of Object.entries(v[key]))
          magnitude(n, at(at(p, key), name), ...bounds);
    for (const [key, bounds] of Object.entries(scalars))
      if (v[key] !== undefined) magnitude(v[key], at(p, key), ...bounds);
    if (
      v.outputMultipliersBySelector !== undefined &&
      list(
        v.outputMultipliersBySelector,
        at(p, "outputMultipliersBySelector"),
        10,
        1,
      )
    )
      v.outputMultipliersBySelector.forEach((s, i) => {
        const q = `${p}.outputMultipliersBySelector[${i}]`;
        if (object(s, q, ["target", "outputMultiplier"])) {
          selector(s.target, at(q, "target"));
          magnitude(s.outputMultiplier, at(q, "outputMultiplier"), 0, 1);
        }
      });
    if (
      v.transactions !== undefined &&
      list(v.transactions, at(p, "transactions"), 2, 1)
    )
      v.transactions.forEach((t, i) => {
        const q = `${p}.transactions[${i}]`;
        if (object(t, q, ["kind", "amountDollars"])) {
          enumValue(t.kind, at(q, "kind"), ["charge", "grant"]);
          magnitude(t.amountDollars, at(q, "amountDollars"), 0, 1e12);
        }
      });
  };
  const event = (v, p) => {
    if (
      !object(v, p, [
        "id",
        "title",
        "message",
        "startMonth",
        "durationMonths",
        "visibility",
        "preview",
        "endMessage",
        "requiresChoice",
        "effects",
        "loads",
        "report",
        "endReport",
      ])
    )
      return;
    id(v.id, at(p, "id"));
    text(v.title, at(p, "title"), 100);
    text(v.message, at(p, "message"), 500);
    if (typeof v.startMonth === "number")
      month(v.startMonth, at(p, "startMonth"));
    else if (object(v.startMonth, at(p, "startMonth"), ["from", "to"])) {
      month(v.startMonth.from, `${p}.startMonth.from`);
      month(v.startMonth.to, `${p}.startMonth.to`);
      if (v.startMonth.from > v.startMonth.to)
        add(
          "invalid-window",
          at(p, "startMonth"),
          "must end on or after its first month.",
        );
    }
    if (v.durationMonths !== undefined && v.durationMonths !== "untilEnd")
      magnitude(v.durationMonths, at(p, "durationMonths"), 1, 1200, true);
    if (v.visibility !== undefined)
      enumValue(v.visibility, at(p, "visibility"), ["forecast", "surprise"]);
    text(v.preview, at(p, "preview"), 200, true);
    text(v.endMessage, at(p, "endMessage"), 500, true);
    if (v.effects !== undefined) {
      effects(v.effects, at(p, "effects"));
      if (v.durationMonths === undefined)
        add(
          "missing-duration",
          at(p, "durationMonths"),
          "is required for mechanical effects; use untilEnd for the rest of the run.",
        );
    }
    if (v.requiresChoice !== undefined)
      condition(v.requiresChoice, at(p, "requiresChoice"));
    if (
      v.loads !== undefined &&
      list(v.loads, at(p, "loads"), RULE_LIMITS.loadsPerEvent, 1)
    )
      v.loads.forEach((l, i) => load(l, `${p}.loads[${i}]`));
    if (v.report !== undefined) report(v.report, at(p, "report"));
    if (v.endReport !== undefined) report(v.endReport, at(p, "endReport"));
  };
  const choice = (v, p) => {
    if (
      !object(v, p, [
        "id",
        "dueMonth",
        "title",
        "prompt",
        "requiresChoice",
        "options",
      ])
    )
      return;
    id(v.id, at(p, "id"));
    month(v.dueMonth, at(p, "dueMonth"));
    text(v.title, at(p, "title"), 100);
    text(v.prompt, at(p, "prompt"), 500);
    if (v.requiresChoice !== undefined)
      condition(v.requiresChoice, at(p, "requiresChoice"));
    if (list(v.options, at(p, "options"), 8, 2))
      v.options.forEach((o, i) => {
        const q = `${p}.options[${i}]`;
        if (
          !object(o, q, [
            "id",
            "label",
            "description",
            "message",
            "costDollars",
            "grantDollars",
            "replaceLoad",
            "eventIds",
          ])
        )
          return;
        id(o.id, at(q, "id"));
        text(o.label, at(q, "label"), 100);
        text(o.description, at(q, "description"), 500);
        text(o.message, at(q, "message"), 500);
        if (o.costDollars !== undefined && o.grantDollars !== undefined)
          add(
            "option-money",
            q,
            "must not declare both costDollars and grantDollars; omit both for a free option.",
          );
        for (const key of ["costDollars", "grantDollars"])
          if (o[key] !== undefined) magnitude(o[key], at(q, key), 0, 1e12);
        if (
          o.replaceLoad !== undefined &&
          object(o.replaceLoad, at(q, "replaceLoad"), ["arc", "loadId", "with"])
        ) {
          id(o.replaceLoad.loadId, `${q}.replaceLoad.loadId`);
          if (o.replaceLoad.arc !== undefined)
            number(o.replaceLoad.arc, `${q}.replaceLoad.arc`, 100, 999, true);
          if (list(o.replaceLoad.with, `${q}.replaceLoad.with`, 4))
            o.replaceLoad.with.forEach((l, j) =>
              load(l, `${q}.replaceLoad.with[${j}]`),
            );
        }
        if (
          o.eventIds !== undefined &&
          list(o.eventIds, at(q, "eventIds"), 100)
        )
          o.eventIds.forEach((e, j) => id(e, `${q}.eventIds[${j}]`));
      });
  };
  const objective = (v, p) => {
    const fields = {
      customerRetention: ["minRetainedShare", "deadlineMonth"],
      emissionsBudget: ["budgetTonnesCO2e"],
      emissionsPerDeliveredMWh: ["maxKgCO2ePerMWh"],
      localFuelShare: ["fuels", "minShare"],
      fuelRetirement: ["fuel", "deadlineMonth"],
      utilityOwnership: ["targets", "deadlineMonth"],
      assetRetirement: ["assetIds", "deadlineMonth"],
      monthlyBilledRate: ["maxDollarsPerKWh"],
      monthEndDebt: ["maxDebtDollars"],
    };
    const metricFields = Object.prototype.hasOwnProperty.call(fields, v?.metric)
      ? fields[v.metric]
      : [];
    if (
      !object(v, p, [
        "id",
        "label",
        "metric",
        "required",
        ...([
          "customerRetention",
          "fuelRetirement",
          "utilityOwnership",
          "assetRetirement",
        ].includes(v?.metric)
          ? []
          : ["fromMonth", "throughMonth"]),
        ...metricFields,
      ])
    )
      return;
    id(v.id, at(p, "id"));
    text(v.label, at(p, "label"), 100);
    enumValue(v.metric, at(p, "metric"), OBJECTIVE_METRICS);
    if (v.required !== undefined && typeof v.required !== "boolean")
      add("invalid-value", at(p, "required"), "must be true or false.");
    if (
      [
        "customerRetention",
        "fuelRetirement",
        "utilityOwnership",
        "assetRetirement",
      ].includes(v.metric)
    )
      month(v.deadlineMonth, at(p, "deadlineMonth"));
    else window(v, p);
    for (const key of ["minDemandServedShare", "minRetainedShare", "minShare"])
      if (metricFields.includes(key)) number(v[key], at(p, key), 0, 1);
    for (const [key, max] of [
      ["budgetTonnesCO2e", 1e12],
      ["maxKgCO2ePerMWh", 1e6],
      ["maxDollarsPerKWh", 100],
      ["maxDebtDollars", 1e12],
    ])
      if (metricFields.includes(key)) number(v[key], at(p, key), 0, max);
    if (v.metric === "localFuelShare") fuels(v.fuels, at(p, "fuels"));
    if (v.metric === "fuelRetirement") fuel(v.fuel, at(p, "fuel"));
    for (const key of ["targets", "assetIds"]) {
      if (metricFields.includes(key) && list(v[key], at(p, key), 16)) {
        if (!v[key].length)
          add("invalid-value", at(p, key), "must not be empty.");
        v[key].forEach((value, i) => id(value, `${p}.${key}[${i}]`));
        if (new Set(v[key]).size !== v[key].length)
          add("invalid-value", at(p, key), "must contain unique identities.");
      }
    }
  };
  if (
    !object(value, path, [
      "events",
      "choices",
      "objectives",
      "debriefReports",
      "officialArcs",
    ])
  )
    return diagnostics;
  for (const [key, max, validate] of [
    ["events", 100, event],
    ["choices", 32, choice],
    ["objectives", 16, objective],
    ["debriefReports", 16, report],
  ])
    if (value[key] !== undefined && list(value[key], at(path, key), max))
      value[key].forEach((item, i) => validate(item, `${at(path, key)}[${i}]`));
  if (
    value.officialArcs !== undefined &&
    list(value.officialArcs, at(path, "officialArcs"), 14)
  )
    value.officialArcs.forEach((arc, i) => {
      const p = `${at(path, "officialArcs")}[${i}]`;
      if (object(arc, p, ["scenarioId", "includeChoices"])) {
        enumValue(arc.scenarioId, at(p, "scenarioId"), RULE_SCENARIO_IDS);
        if (
          arc.includeChoices !== undefined &&
          typeof arc.includeChoices !== "boolean"
        )
          add(
            "invalid-value",
            at(p, "includeChoices"),
            "must be true or false.",
          );
      }
    });
  return diagnostics;
}
module.exports = {
  FACILITY_NAMES,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
  RULE_SCENARIO_IDS,
  RULE_DIFFICULTIES,
  RULE_FUELS,
  RULE_LIMITS,
  ID_PATTERN,
  UNSAFE_TEXT,
  UNSAFE_MARKUP,
  REPORT_KINDS,
  OBJECTIVE_METRICS,
  isRuleJson,
  ruleDiagnostics,
};
