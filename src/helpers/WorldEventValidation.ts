function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate persisted occurrences before simulation or story presentation dereferences them. */
export function validWorldEvent(value: unknown): boolean {
  if (!record(value)) return false;
  if (
    typeof value.key !== "string" ||
    !value.key.length ||
    typeof value.definitionId !== "string" ||
    !value.definitionId.length ||
    !finite(value.startsMinute) ||
    value.startsMinute < 0 ||
    !finite(value.endsMinute) ||
    value.endsMinute < value.startsMinute ||
    !record(value.attributes) ||
    !record(value.effects)
  )
    return false;
  if (
    !Object.values(value.attributes).every(
      (attribute) =>
        typeof attribute === "string" ||
        typeof attribute === "boolean" ||
        finite(attribute) ||
        (Array.isArray(attribute) &&
          (attribute.every((entry) => typeof entry === "string") ||
            attribute.every(finite))),
    )
  )
    return false;
  const scalarEffects = [
    "temperatureOffsetC",
    "demandMultiplier",
    "hydroRunoffMultiplier",
    "carbonFeePerKgCO2e",
    "operatingExpensePerMonth",
  ];
  const mapEffects = [
    "fuelPriceMultipliers",
    "buildCostMultipliersByFuel",
    "operatingCostMultipliersByFuel",
    "facilityOutputMultipliersByFuel",
    "facilityOutputMultipliersById",
  ];
  if (
    !Object.entries(value.effects).every(([key, effect]) =>
      scalarEffects.includes(key)
        ? finite(effect) && (key === "temperatureOffsetC" || effect >= 0)
        : mapEffects.includes(key) &&
          record(effect) &&
          Object.values(effect).every(
            (amount) => finite(amount) && amount >= 0,
          ),
    )
  )
    return false;
  if (
    ["title", "message", "concept", "importance"].some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    ) ||
    (value.forecastable !== undefined &&
      typeof value.forecastable !== "boolean")
  )
    return false;
  if (value.actionTarget !== undefined) {
    if (
      !record(value.actionTarget) ||
      !["FACILITIES", "INSIGHTS", "EVENTS"].includes(
        value.actionTarget.card as string,
      ) ||
      ["view", "fuel", "layer"].some(
        (key) =>
          value.actionTarget &&
          record(value.actionTarget) &&
          value.actionTarget[key] !== undefined &&
          typeof value.actionTarget[key] !== "string",
      )
    )
      return false;
  }
  return true;
}
