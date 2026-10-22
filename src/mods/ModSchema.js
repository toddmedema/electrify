/* Shared by the renderer and Electron main. Keep this parser dependency-free. */

/**
 * The game contract a package targets: which facility names, base scenarios, event arcs and
 * modifier meanings it may rely on. Bump it deliberately, and only when a change would make an
 * existing package mean something different or stop working (a facility or scenario removed or
 * renamed, a modifier's meaning changed). Additive changes keep the same version. Ordinary
 * releases never invalidate installed mods; ModSchema.test.ts pins the version 1 catalog.
 */
const MOD_API_VERSION = 1;
const MOD_SCENARIO_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];
const MAX_MOD_BYTES = 256 * 1024;
// Steam Workshop titles are limited to 128 bytes of UTF-8.
const MAX_TITLE_BYTES = 128;
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
  "Pumped Hydro",
];
const PACKAGE_KEYS = [
  "schemaVersion",
  "gameApi",
  "id",
  "title",
  "creator",
  "version",
  "seed",
  "baseScenarioId",
  "scenario",
  "facilities",
  "programs",
  "notifications",
];
const SCENARIO_OVERRIDE_KEYS = [
  "cash",
  "startingYear",
  "startingCustomers",
  "startingDemandScale",
  "dollarsPerkWh",
  "durationMonths",
  "feePerKgCO2e",
  "eventScenarioIds",
  "ownership",
  "endTitle",
  "endMessage",
];
const FACILITY_MODIFIER_KEYS = [
  "buildCost",
  "annualOperatingCost",
  "yearsToBuild",
];
const PROGRAM_KEYS = ["efficiency", "solar"];
const NOTIFICATION_KEYS = ["month", "title", "message"];
// Control characters, zero-width marks and bidirectional overrides can disguise text.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]/;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

class ModValidationError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map((item) => item.message).join("\n"));
    this.name = "ModValidationError";
    this.diagnostics = diagnostics;
  }
}
function diagnostic(code, path, reason) {
  return { code, path, severity: "error", message: `${path} ${reason}` };
}
function fail(path, reason) {
  throw new ModValidationError([diagnostic("invalid-package", path, reason)]);
}
function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const formatNumber = (value) => value.toLocaleString("en-US");

/** Collect independent failures without traversing malformed parent values. */
function modDiagnostics(p) {
  const diagnostics = [];
  const add = (code, path, reason) =>
    diagnostics.push(diagnostic(code, path, reason));
  const object = (value, path, keys, noun = "field") => {
    if (!plainObject(value)) {
      add("invalid-object", path || "Package", "must be an object.");
      return false;
    }
    for (const key of Object.keys(value))
      if (!keys.includes(key))
        add(
          "unknown-field",
          path ? `${path}.${key}` : key,
          `is not a supported ${noun}. Use one of: ${keys.join(", ")}.`,
        );
    return true;
  };
  const text = (value, path, max) => {
    if (value === undefined) {
      add("missing-field", path, "is required.");
      return;
    }
    if (typeof value !== "string" || !value.trim()) {
      add("invalid-text", path, "must be non-empty text.");
      return;
    }
    if (value.length > max)
      add("text-limit", path, `must be at most ${max} characters.`);
    if (UNSAFE_TEXT.test(value))
      add(
        "unsafe-text",
        path,
        "must not contain control or text-direction characters.",
      );
  };
  const number = (value, path, min, max, integer = false) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      add(
        "number-bounds",
        path,
        `must be ${integer ? "a whole number" : "a number"} from ${formatNumber(min)} to ${formatNumber(max)}.`,
      );
  };
  if (!object(p, "", PACKAGE_KEYS)) return diagnostics;
  if (p.schemaVersion !== 1)
    add(
      "schema-version",
      "schemaVersion",
      "must be 1. Export a new authoring template.",
    );
  number(p.gameApi, "gameApi", 1, 1000, true);
  if (typeof p.id !== "string" || !ID_PATTERN.test(p.id))
    add(
      "invalid-id",
      "id",
      "must be 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
    );
  text(p.title, "title", 100);
  if (
    typeof p.title === "string" &&
    new TextEncoder().encode(p.title).length > MAX_TITLE_BYTES
  )
    add(
      "title-bytes",
      "title",
      `must fit Steam's ${MAX_TITLE_BYTES}-byte title limit.`,
    );
  text(p.creator, "creator", 100);
  text(p.version, "version", 40);
  number(p.seed, "seed", 0, 4294967295, true);
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
    const ids = p.scenario.eventScenarioIds;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length > 20)
        add(
          "list-limit",
          "scenario.eventScenarioIds",
          "must be a list of at most 20 IDs.",
        );
      if (Array.isArray(ids)) {
        if (new Set(ids).size !== ids.length)
          add(
            "duplicate-id",
            "scenario.eventScenarioIds",
            "must not repeat an ID.",
          );
        ids.forEach((id, index) => {
          if (!MOD_SCENARIO_IDS.includes(id))
            add(
              "unknown-arc",
              `scenario.eventScenarioIds[${index}]`,
              `is not a scenario. Use one of: ${MOD_SCENARIO_IDS.join(", ")}.`,
            );
        });
      }
    }
  }
  if (
    p.facilities !== undefined &&
    object(p.facilities, "facilities", FACILITY_NAMES, "facility")
  )
    for (const [name, value] of Object.entries(p.facilities)) {
      if (object(value, `facilities.${name}`, FACILITY_MODIFIER_KEYS))
        for (const [key, factor] of Object.entries(value))
          if (FACILITY_MODIFIER_KEYS.includes(key))
            number(factor, `facilities.${name}.${key}`, 0.1, 10);
    }
  if (
    p.programs !== undefined &&
    object(p.programs, "programs", PROGRAM_KEYS, "program")
  )
    for (const [key, factor] of Object.entries(p.programs))
      if (PROGRAM_KEYS.includes(key))
        number(factor, `programs.${key}`, 0.1, 10);
  if (p.notifications !== undefined) {
    if (!Array.isArray(p.notifications) || p.notifications.length > 100)
      add(
        "list-limit",
        "notifications",
        "must be a list of at most 100 notifications.",
      );
    if (Array.isArray(p.notifications))
      p.notifications.forEach((n, index) => {
        const path = `notifications[${index}]`;
        if (!object(n, path, NOTIFICATION_KEYS)) return;
        number(n.month, `${path}.month`, 1, 1200, true);
        text(n.title, `${path}.title`, 100);
        text(n.message, `${path}.message`, 500);
      });
  }
  return diagnostics;
}

/** Validates an already-decoded package and returns a detached copy. */
function validateMod(value) {
  let p;
  try {
    p = JSON.parse(JSON.stringify(value));
  } catch {
    fail("Package", "must be plain JSON data.");
  }
  const diagnostics = modDiagnostics(p);
  if (diagnostics.length) throw new ModValidationError(diagnostics);
  if (new TextEncoder().encode(JSON.stringify(p)).length > MAX_MOD_BYTES)
    fail("Package", "must be at most 256 KiB.");
  return p;
}

/** Decodes and validates one scenario.json. */
function parseMod(input) {
  if (typeof input !== "string") fail("scenario.json", "must be UTF-8 text.");
  if (new TextEncoder().encode(input).length > MAX_MOD_BYTES)
    fail("scenario.json", "must be at most 256 KiB.");
  let value;
  try {
    value = JSON.parse(input);
  } catch (error) {
    fail(
      "scenario.json",
      `is not valid JSON (${error instanceof Error ? error.message : "syntax error"}).`,
    );
  }
  return validateMod(value);
}

module.exports = {
  modDiagnostics,
  parseMod,
  validateMod,
  ModValidationError,
  MOD_API_VERSION,
  MAX_MOD_BYTES,
  MOD_SCENARIO_IDS,
  FACILITY_NAMES,
  SCENARIO_OVERRIDE_KEYS,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
};
