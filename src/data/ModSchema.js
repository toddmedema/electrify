/* Shared by the renderer and Electron main. Keep this parser dependency-free. */
const MOD_SCENARIO_IDS = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
];
const MAX_MOD_BYTES = 256 * 1024;
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
function fail() {
  throw new Error("Invalid mod package. Use the version 1 data-only schema.");
}
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail();
}
function text(value, max) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    fail();
}
function number(value, min, max, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail();
}
function parseMod(input) {
  if (
    typeof input !== "string" ||
    new TextEncoder().encode(input).length > MAX_MOD_BYTES
  )
    fail();
  let p;
  try {
    p = JSON.parse(input);
  } catch {
    fail();
  }
  object(p, [
    "schemaVersion",
    "id",
    "title",
    "creator",
    "version",
    "rules",
    "seed",
    "baseScenarioId",
    "scenario",
    "facilities",
    "programs",
    "notifications",
  ]);
  if (
    p.schemaVersion !== 1 ||
    typeof p.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id)
  )
    fail();
  text(p.title, 100);
  text(p.creator, 100);
  text(p.version, 40);
  text(p.rules, 100);
  if (!/^rules-[a-zA-Z0-9-]+$/.test(p.rules)) fail();
  number(p.seed, 0, 4294967295, true);
  if (p.baseScenarioId !== 999 && !MOD_SCENARIO_IDS.includes(p.baseScenarioId))
    fail();
  if (p.scenario !== undefined) {
    object(p.scenario, [
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
    ]);
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
      if (p.scenario[key] !== undefined) number(p.scenario[key], ...range);
    if (
      p.scenario.ownership !== undefined &&
      !["Investor", "Public"].includes(p.scenario.ownership)
    )
      fail();
    for (const key of ["endTitle", "endMessage"])
      if (p.scenario[key] !== undefined) text(p.scenario[key], 500);
    const ids = p.scenario.eventScenarioIds;
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.length > 20 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !MOD_SCENARIO_IDS.includes(id)))
    )
      fail();
  }
  if (p.facilities !== undefined) {
    object(p.facilities, FACILITY_NAMES);
    for (const value of Object.values(p.facilities)) {
      object(value, ["buildCost", "annualOperatingCost", "yearsToBuild"]);
      for (const factor of Object.values(value)) number(factor, 0.1, 10);
    }
  }
  if (p.programs !== undefined) {
    object(p.programs, ["efficiency", "solar"]);
    for (const factor of Object.values(p.programs)) number(factor, 0.1, 10);
  }
  if (p.notifications !== undefined) {
    if (!Array.isArray(p.notifications) || p.notifications.length > 100) fail();
    for (const n of p.notifications) {
      object(n, ["month", "title", "message"]);
      number(n.month, 1, 1200, true);
      text(n.title, 100);
      text(n.message, 500);
    }
  }
  return p;
}
module.exports = { parseMod, MAX_MOD_BYTES, MOD_SCENARIO_IDS };
