import type {
  FacilityModifierType,
  GameType,
  ModFacilityNameType,
  ScenarioModType,
  ScenarioType,
} from "../Types";
import {
  FACILITY_NAMES,
  FACILITY_MODIFIER_KEYS,
  PROGRAM_KEYS,
  RULE_LIMITS,
  RULE_SCENARIO_IDS,
  RULE_FUELS,
  isRuleJson,
  ID_PATTERN,
  UNSAFE_TEXT,
  UNSAFE_MARKUP,
} from "./ScenarioRulesSchema";
import { validCompiledScenarioRules } from "./ScenarioRules";
import { canonicalRuleJson, ruleDigest, utf8Bytes } from "./RuleIdentity";
import { getScenarioLocation, isValidLocation } from "./Locations";
import { validHydroInventorySource } from "../data/HydroSites";
import { validFrozenStartingIntertieScenario } from "./FrozenStartingInterties";

export function facilityModifier(
  game: Pick<GameType, "customScenario">,
  name: string,
): FacilityModifierType | undefined {
  const modifier =
    game.customScenario?.mod?.facilities?.[name as ModFacilityNameType];
  if (modifier && !Object.values(modifier).every(factor))
    throw new Error(
      `Invalid mod facility modifier for ${name}: factors must be from 0.1 to 10.`,
    );
  return modifier;
}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const factor = (v: unknown) =>
  v === undefined ||
  (typeof v === "number" && Number.isFinite(v) && v >= 0.1 && v <= 10);
export function modScaledValue(
  value: number,
  multiplier: number | undefined,
  path: string,
): number {
  if (!factor(multiplier))
    throw new Error(`${path} must be a factor from 0.1 to 10.`);
  const result = value * (multiplier ?? 1);
  if (!Number.isFinite(result))
    throw new Error(`${path} produces a nonfinite result.`);
  return result;
}
const safeText = (v: unknown, max: number) =>
  typeof v === "string" &&
  !!v.trim() &&
  v.length <= max &&
  !UNSAFE_TEXT.test(v) &&
  !UNSAFE_MARKUP.test(v);
const number = (v: unknown, min: number, max: number, integer = false) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= min &&
  v <= max &&
  (!integer || Number.isInteger(v));
/** The enclosing setup is frozen once, by digest, without duplicating it in mod.rules. */
export function modSetupDigest(scenario: ScenarioType): string {
  const { mod: _mod, rules: _rules, ...setup } = scenario;
  return ruleDigest(setup);
}
function validModSetup(scenario: ScenarioType): boolean {
  if (
    !isRuleJson(scenario) ||
    !keys(scenario as unknown as Record<string, unknown>, [
      "id",
      "name",
      "icon",
      "locationId",
      "location",
      "summary",
      "briefing",
      "themes",
      "recommendationOrder",
      "ownership",
      "intertiesEnabled",
      "startingInterties",
      "startingIntertieAccess",
      "seed",
      "startingYear",
      "cash",
      "startingCustomers",
      "startingDemandScale",
      "demandShapeExponent",
      "loadAdditions",
      "minimumCustomerRetention",
      "reliabilityObjective",
      "dollarsPerkWh",
      "durationMonths",
      "endTitle",
      "endMessage",
      "feePerKgCO2e",
      "facilities",
      "hydroInventoryKey",
      "eventScenarioIds",
      "mod",
    ])
  )
    return false;
  const location = getScenarioLocation(scenario);
  if (
    (scenario.startingInterties !== undefined ||
      scenario.startingIntertieAccess !== undefined) &&
    !validFrozenStartingIntertieScenario(scenario)
  )
    return false;
  if (
    !number(scenario.cash, 0, 1e12) ||
    !number(scenario.dollarsPerkWh, 0, 100) ||
    !number(scenario.feePerKgCO2e, 0, 100) ||
    !["Investor", "Public"].includes(scenario.ownership) ||
    !isValidLocation(location) ||
    !safeText(scenario.icon, 100) ||
    !/^[a-z0-9 +_-]+$/i.test(scenario.icon)
  )
    return false;
  if (
    !validHydroInventorySource({
      location,
      scenarioId: scenario.id,
      customScenario: scenario,
    })
  )
    return false;
  for (const key of ["summary", "endTitle", "endMessage"] as const)
    if (scenario[key] !== undefined && !safeText(scenario[key], 500))
      return false;
  if (
    !safeText(scenario.locationId, 100) ||
    (scenario.hydroInventoryKey !== undefined &&
      !safeText(scenario.hydroInventoryKey, 100)) ||
    (scenario.intertiesEnabled !== undefined &&
      typeof scenario.intertiesEnabled !== "boolean") ||
    (scenario.recommendationOrder !== undefined &&
      !number(scenario.recommendationOrder, 0, 1000))
  )
    return false;
  if (scenario.briefing !== undefined) {
    const b = scenario.briefing;
    if (
      !plain(b) ||
      !keys(b, ["tone", "fantasy", "objective", "threat"]) ||
      ![
        "transition",
        "boom",
        "island",
        "innovation",
        "storm",
        "legacy",
      ].includes(b.tone) ||
      ![b.fantasy, b.objective, b.threat].every((v) => safeText(v, 500))
    )
      return false;
  }
  if (
    scenario.themes !== undefined &&
    (!Array.isArray(scenario.themes) ||
      scenario.themes.length > 3 ||
      new Set(scenario.themes).size !== scenario.themes.length ||
      scenario.themes.some(
        (t) =>
          !["Extreme weather", "Energy transition", "Rapid growth"].includes(t),
      ))
  )
    return false;
  if (scenario.location !== undefined) {
    const l = scenario.location;
    if (
      !plain(l) ||
      !keys(l, [
        "id",
        "name",
        "lat",
        "long",
        "admin",
        "timeZone",
        "region",
        "country",
        "elevation",
        "watershedId",
        "watershedName",
        "offshore",
        "resources",
      ]) ||
      l.id !== scenario.locationId
    )
      return false;
    for (const key of [
      "name",
      "admin",
      "timeZone",
      "region",
      "country",
      "watershedName",
    ] as const)
      if (l[key] !== undefined && !safeText(l[key], 100)) return false;
    if (
      l.resources !== undefined &&
      (!plain(l.resources) || !keys(l.resources, ["hydro", "geothermal"]))
    )
      return false;
  }
  if (
    scenario.demandShapeExponent !== undefined &&
    !number(scenario.demandShapeExponent, 0.1, 10)
  )
    return false;
  if (
    scenario.minimumCustomerRetention !== undefined &&
    !number(scenario.minimumCustomerRetention, 0, 1)
  )
    return false;
  if (!Array.isArray(scenario.facilities) || scenario.facilities.length > 40)
    return false;
  for (const asset of scenario.facilities) {
    if (
      !plain(asset) ||
      !keys(asset, [
        "assetId",
        "name",
        "fuel",
        "peakW",
        "peakWh",
        "initialAgeYears",
        "initialReservoirFraction",
        "hydroSiteId",
        "label",
      ]) ||
      typeof asset.assetId !== "string" ||
      !ID_PATTERN.test(asset.assetId) ||
      (asset.name === undefined && asset.fuel === undefined) ||
      (asset.name !== undefined &&
        !FACILITY_NAMES.includes(asset.name as ModFacilityNameType)) ||
      (asset.fuel !== undefined && !RULE_FUELS.includes(asset.fuel)) ||
      (asset.peakW === undefined && asset.peakWh === undefined)
    )
      return false;
    for (const key of ["peakW", "peakWh"] as const)
      if (asset[key] !== undefined && !number(asset[key], 1, 1e15))
        return false;
    if (
      asset.initialAgeYears !== undefined &&
      !number(asset.initialAgeYears, 0, 200)
    )
      return false;
    if (
      asset.initialReservoirFraction !== undefined &&
      !number(asset.initialReservoirFraction, 0, 1)
    )
      return false;
    if (asset.label !== undefined && !safeText(asset.label, 100)) return false;
    if (
      asset.hydroSiteId !== undefined &&
      (typeof asset.hydroSiteId !== "string" ||
        !ID_PATTERN.test(asset.hydroSiteId))
    )
      return false;
  }
  if (
    new Set(scenario.facilities.map((a) => a.assetId)).size !==
    scenario.facilities.length
  )
    return false;
  if (scenario.loadAdditions !== undefined) {
    if (
      !Array.isArray(scenario.loadAdditions) ||
      scenario.loadAdditions.length > 512
    )
      return false;
    for (const load of scenario.loadAdditions) {
      if (
        !plain(load) ||
        !keys(load, [
          "id",
          "label",
          "demandType",
          "startsYear",
          "startsMonth",
          "peakW",
          "loadFactor",
          "supplementsBackground",
        ]) ||
        typeof load.id !== "string" ||
        !ID_PATTERN.test(load.id) ||
        !safeText(load.label, 100) ||
        !["Data Centers", "Mining"].includes(load.demandType) ||
        !number(load.startsYear, 1800, 2300, true) ||
        !number(load.startsMonth ?? 1, 1, 12, true) ||
        !number(load.peakW, 0, 1e15) ||
        !number(load.loadFactor, 0.01, 1) ||
        (load.supplementsBackground !== undefined &&
          typeof load.supplementsBackground !== "boolean")
      )
        return false;
    }
  }
  const objective = scenario.reliabilityObjective;
  if (
    objective &&
    (!plain(objective) ||
      !keys(objective, [
        "year",
        "month",
        "durationMonths",
        "minimumDemandServed",
        "label",
        "goal",
      ]) ||
      !number(objective.year, 1980, 2300, true) ||
      !number(objective.month, 1, 12, true) ||
      !number(objective.durationMonths ?? 1, 1, 1200, true) ||
      !number(objective.minimumDemandServed, 0, 1) ||
      !safeText(objective.label, 100) ||
      (objective.goal !== undefined && !safeText(objective.goal, 200)))
  )
    return false;
  if (scenario.reliabilityObjective === null) return false;
  return (
    canonicalRuleJson(
      [...(scenario.eventScenarioIds ?? [])].sort((a, b) => a - b),
    ) ===
    canonicalRuleJson(
      scenario
        .mod!.rules.officialArcs.map((a) => a.scenarioId)
        .sort((a, b) => a - b),
    )
  );
}

/** Workshop provenance is not simulation content and can be added after an offline run starts. */
export function modRuntimeDigest(
  value: Omit<ScenarioModType, "runtimeDigest"> | ScenarioModType,
): string {
  const { runtimeDigest: _digest, ...content } = value as ScenarioModType;
  const { workshopId: _workshop, ...source } = content.source;
  return ruleDigest({ ...content, source });
}
/** The single snapshot trust boundary. It validates normalized rules directly, never an installed
 * package, and checks the run's resolved setup when the enclosing scenario is available. */
export function validScenarioMod(
  value: unknown,
  scenario?: ScenarioType,
): value is ScenarioModType {
  try {
    if (
      !isRuleJson(value) ||
      !plain(value) ||
      !keys(value, [
        "runtimeVersion",
        "gameApi",
        "packageDigest",
        "setupDigest",
        "runtimeDigest",
        "modRuntimeId",
        "source",
        "parameters",
        "rules",
        "facilities",
        "programs",
      ]) ||
      utf8Bytes(JSON.stringify(value)).length > RULE_LIMITS.compiledBytes
    )
      return false;
    if (
      value.runtimeVersion !== 1 ||
      value.gameApi !== 1 ||
      typeof value.packageDigest !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(value.packageDigest) ||
      typeof value.setupDigest !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(value.setupDigest) ||
      typeof value.runtimeDigest !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(value.runtimeDigest) ||
      typeof value.modRuntimeId !== "string" ||
      !/^mod-1-[a-f0-9]{64}$/.test(value.modRuntimeId)
    )
      return false;
    const source = value.source,
      params = value.parameters;
    if (
      !plain(source) ||
      !keys(source, [
        "id",
        "title",
        "creator",
        "version",
        "description",
        "objectiveMode",
        "workshopId",
      ]) ||
      typeof source.id !== "string" ||
      !ID_PATTERN.test(source.id) ||
      !safeText(source.title, 100) ||
      utf8Bytes(source.title as string).length > 128 ||
      !safeText(source.creator, 100) ||
      !safeText(source.version, 40) ||
      !safeText(source.description, 2000) ||
      !["inherit", "replace", "none"].includes(
        source.objectiveMode as string,
      ) ||
      (source.workshopId !== undefined &&
        (typeof source.workshopId !== "string" ||
          !/^[1-9][0-9]{0,19}$/.test(source.workshopId)))
    )
      return false;
    if (
      !plain(params) ||
      !keys(params, [
        "baseScenarioId",
        "startingYear",
        "durationMonths",
        "seed",
        "difficulty",
        "startingCustomers",
        "startingDemandScale",
      ]) ||
      (params.baseScenarioId !== 999 &&
        !RULE_SCENARIO_IDS.includes(params.baseScenarioId as number)) ||
      !number(params.startingYear, 1980, 2100, true) ||
      !number(params.durationMonths, 6, 1200, true) ||
      !number(params.seed, 0, 4294967295, true) ||
      !number(params.startingCustomers, 1, 1e8, true) ||
      !number(params.startingDemandScale, 0.01, 100)
    )
      return false;
    if (!validCompiledScenarioRules(value.rules)) return false;
    const rules = value.rules;
    if (
      (source.objectiveMode === "none" && rules.objectives.length !== 0) ||
      (source.objectiveMode === "replace" &&
        rules.objectives.some((goal) => goal.inherited))
    )
      return false;
    if (
      rules.namespace.kind !== "mod" ||
      rules.namespace.id !== source.id ||
      rules.difficulty !== params.difficulty ||
      rules.seed !== params.seed ||
      rules.startingYear !== params.startingYear ||
      rules.durationMonths !== params.durationMonths
    )
      return false;
    if (value.facilities !== undefined) {
      if (!plain(value.facilities) || !keys(value.facilities, FACILITY_NAMES))
        return false;
      for (const modifier of Object.values(value.facilities))
        if (
          !plain(modifier) ||
          !keys(modifier, FACILITY_MODIFIER_KEYS) ||
          !Object.values(modifier).every(factor)
        )
          return false;
    }
    if (
      value.programs !== undefined &&
      (!plain(value.programs) ||
        !keys(value.programs, PROGRAM_KEYS) ||
        !Object.values(value.programs).every(factor))
    )
      return false;
    const mod = value as unknown as ScenarioModType;
    if (modRuntimeDigest(mod) !== mod.runtimeDigest) return false;
    if (
      scenario &&
      (!validModSetup(scenario) ||
        modSetupDigest(scenario) !== value.setupDigest ||
        utf8Bytes(JSON.stringify(scenario)).length >
          RULE_LIMITS.compiledBytes ||
        scenario.id !== 999 ||
        scenario.rules !== undefined ||
        scenario.name !== source.title ||
        scenario.startingYear !== params.startingYear ||
        scenario.durationMonths !== params.durationMonths ||
        scenario.seed !== params.seed ||
        scenario.startingCustomers !== params.startingCustomers ||
        (scenario.startingDemandScale ?? 1) !== params.startingDemandScale ||
        canonicalRuleJson(scenario.facilities.map((f) => f.assetId).sort()) !==
          canonicalRuleJson(rules.startingAssetIds))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
export function withoutMod(scenario: ScenarioType): ScenarioType {
  if (scenario.mod === undefined) return scenario;
  const { mod: _mod, ...setup } = scenario;
  return setup;
}
