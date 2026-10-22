/* Package-only parsing; Electron main must never import the TypeScript catalog. */
const {
  ruleDiagnostics,
  isRuleJson,
  ID_PATTERN,
  UNSAFE_TEXT,
  UNSAFE_MARKUP,
  FACILITY_NAMES,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
} = require("../helpers/ScenarioRulesSchema");
const { ruleDigest, utf8Bytes } = require("../helpers/RuleIdentity");
const MOD_API_VERSION = 1;
const MOD_SCENARIO_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];
const MAX_MOD_BYTES = 256 * 1024;
const PACKAGE_KEYS = [
  "$schema",
  "schemaVersion",
  "gameApi",
  "id",
  "title",
  "creator",
  "version",
  "description",
  "seed",
  "baseScenarioId",
  "scenario",
  "facilities",
  "programs",
  "officialArcs",
  "events",
  "choices",
  "objectives",
  "debriefReports",
];
const SCENARIO_OVERRIDE_KEYS = [
  "cash",
  "startingYear",
  "startingCustomers",
  "startingDemandScale",
  "dollarsPerkWh",
  "durationMonths",
  "feePerKgCO2e",
  "ownership",
  "endTitle",
  "endMessage",
];
const COMPUTED_KEYS = [
  "runtimeVersion",
  "packageDigest",
  "setupDigest",
  "runtimeDigest",
  "modRuntimeId",
  "multiplayerCompatibilityId",
  "compatibilityId",
];
class ModValidationError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map((d) => d.message).join("\n"));
    this.name = "ModValidationError";
    this.diagnostics = diagnostics;
  }
}
function modDiagnostics(p) {
  const diagnostics = [];
  const add = (code, path, message) =>
    diagnostics.push({
      code,
      path,
      severity: "error",
      message: `${path} ${message}`,
    });
  if (!isRuleJson(p)) {
    add(
      "invalid-json",
      "Package",
      "must contain only finite plain JSON data, without functions, accessors or cycles.",
    );
    return diagnostics;
  }
  const object = (v, path, keys) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      add("invalid-object", path, "must be an object.");
      return false;
    }
    Object.keys(v).forEach((key) => {
      if (!keys.includes(key))
        add(
          COMPUTED_KEYS.includes(key) ? "computed-field" : "unknown-field",
          path ? `${path}.${key}` : key,
          COMPUTED_KEYS.includes(key)
            ? "is computed by the game and must not be authored."
            : `is not a supported field. Use one of: ${keys.join(", ")}.`,
        );
    });
    return true;
  };
  const text = (v, path, max) => {
    if (typeof v !== "string" || !v.trim()) {
      add("invalid-text", path, "must be non-empty text.");
      return;
    }
    if (v.length > max)
      add("text-limit", path, `must be at most ${max} characters.`);
    if (UNSAFE_TEXT.test(v) || UNSAFE_MARKUP.test(v))
      add(
        "unsafe-text",
        path,
        "must be plain text without control characters, HTML or URLs.",
      );
  };
  const number = (v, path, min, max, integer = false) => {
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      add(
        "number-bounds",
        path,
        `must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`,
      );
  };
  if (!object(p, "", PACKAGE_KEYS)) return diagnostics;
  if (p.schemaVersion !== 1)
    add(
      "schema-version",
      "schemaVersion",
      "must be 1. Export a new authoring template.",
    );
  if (p.gameApi !== 1)
    add(
      "game-api",
      "gameApi",
      "must be 1. This package targets an unsupported game contract.",
    );
  if (typeof p.id !== "string" || !ID_PATTERN.test(p.id))
    add(
      "invalid-id",
      "id",
      "must be 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
    );
  text(p.title, "title", 100);
  if (typeof p.title === "string" && utf8Bytes(p.title).length > 128)
    add("title-bytes", "title", "must fit Steam's 128-byte title limit.");
  text(p.creator, "creator", 100);
  text(p.version, "version", 40);
  text(p.description, "description", 2000);
  number(p.seed, "seed", 0, 4294967295, true);
  if (
    p.$schema !== undefined &&
    (typeof p.$schema !== "string" ||
      p.$schema.length > 2048 ||
      UNSAFE_TEXT.test(p.$schema))
  )
    add(
      "editor-schema",
      "$schema",
      "must be an editor schema string of at most 2048 safe characters.",
    );
  if (p.baseScenarioId !== 999 && !MOD_SCENARIO_IDS.includes(p.baseScenarioId))
    add(
      "unknown-base",
      "baseScenarioId",
      `is not a scenario. Use 999 or one of: ${MOD_SCENARIO_IDS.join(", ")}.`,
    );
  if (
    p.scenario !== undefined &&
    object(p.scenario, "scenario", SCENARIO_OVERRIDE_KEYS)
  ) {
    const bounds = {
      cash: [0, 1e12],
      startingYear: [1980, 2100, true],
      startingCustomers: [1, 1e8, true],
      startingDemandScale: [0.01, 100],
      dollarsPerkWh: [0, 100],
      durationMonths: [6, 1200, true],
      feePerKgCO2e: [0, 100],
    };
    for (const [key, range] of Object.entries(bounds))
      if (p.scenario[key] !== undefined)
        number(p.scenario[key], `scenario.${key}`, ...range);
    if (
      p.scenario.ownership !== undefined &&
      !["Investor", "Public"].includes(p.scenario.ownership)
    )
      add(
        "invalid-ownership",
        "scenario.ownership",
        "must be Investor or Public.",
      );
    for (const key of ["endTitle", "endMessage"])
      if (p.scenario[key] !== undefined)
        text(p.scenario[key], `scenario.${key}`, 500);
  }
  if (
    p.facilities !== undefined &&
    object(p.facilities, "facilities", FACILITY_NAMES)
  )
    for (const [name, v] of Object.entries(p.facilities))
      if (object(v, `facilities.${name}`, FACILITY_MODIFIER_KEYS))
        for (const [key, n] of Object.entries(v))
          if (FACILITY_MODIFIER_KEYS.includes(key))
            number(n, `facilities.${name}.${key}`, 0.1, 10);
  if (p.programs !== undefined && object(p.programs, "programs", PROGRAM_KEYS))
    for (const [key, n] of Object.entries(p.programs))
      if (PROGRAM_KEYS.includes(key)) number(n, `programs.${key}`, 0.1, 10);
  let objectives = [];
  if (
    object(p.objectives, "objectives", [
      "mode",
      ...(p.objectives?.mode === "inherit"
        ? ["add"]
        : p.objectives?.mode === "replace"
          ? ["items"]
          : []),
    ])
  ) {
    if (!["inherit", "replace", "none"].includes(p.objectives.mode))
      add(
        "objective-intent",
        "objectives.mode",
        "must explicitly be inherit, replace or none.",
      );
    if (p.objectives.mode === "replace" || p.objectives.add !== undefined) {
      objectives =
        p.objectives.mode === "replace" ? p.objectives.items : p.objectives.add;
      if (!Array.isArray(objectives)) {
        add(
          "invalid-list",
          `objectives.${p.objectives.mode === "replace" ? "items" : "add"}`,
          "must be a list.",
        );
        objectives = [];
      }
    }
  }
  const definitions = { objectives };
  for (const key of ["events", "choices", "debriefReports", "officialArcs"])
    if (p[key] !== undefined) definitions[key] = p[key];
  diagnostics.push(...ruleDiagnostics(definitions));
  if (Array.isArray(p.officialArcs)) {
    const seen = new Set();
    p.officialArcs.forEach((arc, i) => {
      if (!arc || !MOD_SCENARIO_IDS.includes(arc.scenarioId))
        add(
          "unknown-arc",
          `officialArcs[${i}].scenarioId`,
          "must name an importable non-tutorial scenario.",
        );
      else if (seen.has(arc.scenarioId))
        add(
          "duplicate-id",
          `officialArcs[${i}].scenarioId`,
          "must not repeat an arc.",
        );
      else seen.add(arc.scenarioId);
    });
  }
  return diagnostics;
}
function validateMod(value) {
  const diagnostics = modDiagnostics(value);
  if (diagnostics.length) throw new ModValidationError(diagnostics);
  const json = JSON.stringify(value);
  if (utf8Bytes(json).length > MAX_MOD_BYTES)
    throw new ModValidationError([
      {
        code: "package-bytes",
        path: "Package",
        severity: "error",
        message: "Package must be at most 256 KiB.",
      },
    ]);
  return JSON.parse(json);
}
function parseMod(input) {
  if (typeof input !== "string" || utf8Bytes(input).length > MAX_MOD_BYTES)
    throw new ModValidationError([
      {
        code: "package-bytes",
        path: "scenario.json",
        severity: "error",
        message: "Choose scenario.json UTF-8 text under 256 KiB.",
      },
    ]);
  let value;
  try {
    value = JSON.parse(input);
  } catch (error) {
    throw new ModValidationError([
      {
        code: "invalid-json",
        path: "scenario.json",
        severity: "error",
        message: `scenario.json is not valid JSON (${error.message}).`,
      },
    ]);
  }
  return validateMod(value);
}
function packageDigest(value) {
  const { $schema: _schema, ...content } = validateMod(value);
  return ruleDigest(content);
}
module.exports = {
  modDiagnostics,
  validateMod,
  parseMod,
  packageDigest,
  ModValidationError,
  MOD_API_VERSION,
  MOD_SCENARIO_IDS,
  MAX_MOD_BYTES,
  FACILITY_NAMES,
  SCENARIO_OVERRIDE_KEYS,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
};
