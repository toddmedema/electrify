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

class ModValidationError extends Error {}
function fail(path, reason) {
  throw new ModValidationError(`${path} ${reason}`);
}
function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function object(value, path, keys, noun = "field") {
  if (!plainObject(value)) fail(path, "must be an object.");
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      fail(
        path ? `${path}.${key}` : key,
        `is not a supported ${noun}. Use one of: ${keys.join(", ")}.`,
      );
}
function text(value, path, max) {
  if (typeof value !== "string" || !value.trim())
    fail(path, "must be non-empty text.");
  if (value.length > max) fail(path, `must be at most ${max} characters.`);
  if (UNSAFE_TEXT.test(value))
    fail(path, "must not contain control or text-direction characters.");
}
const formatNumber = (value) => value.toLocaleString("en-US");
function number(value, path, min, max, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(
      path,
      `must be ${integer ? "a whole number" : "a number"} from ${formatNumber(min)} to ${formatNumber(max)}.`,
    );
}
function required(value, key, path = key) {
  if (value[key] === undefined) fail(path, "is required.");
}

/** Validates an already-decoded package and returns a detached copy. */
function validateMod(value) {
  let p;
  try {
    p = JSON.parse(JSON.stringify(value));
  } catch {
    fail("Package", "must be plain JSON data.");
  }
  if (!plainObject(p)) fail("Package", "must be a JSON object.");
  if (p.schemaVersion !== 1)
    fail("schemaVersion", "must be 1. Export a new authoring template.");
  object(p, "", PACKAGE_KEYS);
  for (const key of [
    "schemaVersion",
    "gameApi",
    "id",
    "title",
    "creator",
    "version",
    "seed",
    "baseScenarioId",
  ])
    required(p, key);
  number(p.gameApi, "gameApi", 1, 1000, true);
  if (typeof p.id !== "string" || !ID_PATTERN.test(p.id))
    fail(
      "id",
      "must be 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
    );
  text(p.title, "title", 100);
  if (new TextEncoder().encode(p.title).length > MAX_TITLE_BYTES)
    fail("title", `must fit Steam's ${MAX_TITLE_BYTES}-byte title limit.`);
  text(p.creator, "creator", 100);
  text(p.version, "version", 40);
  number(p.seed, "seed", 0, 4294967295, true);
  if (p.baseScenarioId !== 999 && !MOD_SCENARIO_IDS.includes(p.baseScenarioId))
    fail(
      "baseScenarioId",
      `is not a scenario. Use 999 or one of: ${MOD_SCENARIO_IDS.join(", ")}.`,
    );
  if (p.scenario !== undefined) {
    object(p.scenario, "scenario", SCENARIO_OVERRIDE_KEYS);
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
      fail("scenario.ownership", "must be Investor or Public.");
    for (const key of ["endTitle", "endMessage"])
      if (p.scenario[key] !== undefined)
        text(p.scenario[key], `scenario.${key}`, 500);
    const ids = p.scenario.eventScenarioIds;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length > 20)
        fail("scenario.eventScenarioIds", "must be a list of at most 20 IDs.");
      if (new Set(ids).size !== ids.length)
        fail("scenario.eventScenarioIds", "must not repeat an ID.");
      ids.forEach((id, index) => {
        if (!MOD_SCENARIO_IDS.includes(id))
          fail(
            `scenario.eventScenarioIds[${index}]`,
            `is not a scenario. Use one of: ${MOD_SCENARIO_IDS.join(", ")}.`,
          );
      });
    }
  }
  if (p.facilities !== undefined) {
    object(p.facilities, "facilities", FACILITY_NAMES, "facility");
    for (const [name, value] of Object.entries(p.facilities)) {
      object(value, `facilities.${name}`, FACILITY_MODIFIER_KEYS);
      for (const [key, factor] of Object.entries(value))
        number(factor, `facilities.${name}.${key}`, 0.1, 10);
    }
  }
  if (p.programs !== undefined) {
    object(p.programs, "programs", PROGRAM_KEYS, "program");
    for (const [key, factor] of Object.entries(p.programs))
      number(factor, `programs.${key}`, 0.1, 10);
  }
  if (p.notifications !== undefined) {
    if (!Array.isArray(p.notifications) || p.notifications.length > 100)
      fail("notifications", "must be a list of at most 100 notifications.");
    p.notifications.forEach((n, index) => {
      const path = `notifications[${index}]`;
      object(n, path, NOTIFICATION_KEYS);
      for (const key of NOTIFICATION_KEYS) required(n, key, `${path}.${key}`);
      number(n.month, `${path}.month`, 1, 1200, true);
      text(n.title, `${path}.title`, 100);
      text(n.message, `${path}.message`, 500);
    });
  }
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
