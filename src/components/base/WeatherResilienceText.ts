import { formatTemperature } from "../../helpers/Units";
import { ResilienceUpgradeType, UnitSystemType } from "../../Types";

/**
 * Copy shared by the build dialog, the facility details pane and the fleet row, so a weather
 * upgrade and its effect read the same wherever the player meets them.
 */

/** A design temperature in the player's unit, with a true minus sign: "−30°C". */
export function formatDesignTemperature(
  celsius: number,
  units: UnitSystemType,
): string {
  return formatTemperature(celsius, units).replace(/^-/, "−");
}

/** The upgrade's name mid-sentence, e.g. "cold-weather package". */
export function resilienceName(upgrade: ResilienceUpgradeType): string {
  switch (upgrade) {
    case "hailResistant":
      return "hail-resistant panels";
    case "solarTrackers":
      return "solar trackers";
    default:
      return "cold-weather package";
  }
}

/** The upgrade's name as an action, e.g. "Add hail-resistant panels". */
export function resilienceActionLabel(upgrade: ResilienceUpgradeType): string {
  return upgrade === "hailResistant"
    ? "Add hail-resistant panels"
    : "Add cold-weather package";
}

/** What a cold-weather package does to a plant's rating and its losses in deeper cold. */
export function coldPackageEffect(
  packagedMinTempC: number,
  standardMinTempC: number,
  units: UnitSystemType,
): string {
  return `Rated to ${formatDesignTemperature(packagedMinTempC, units)} instead of ${formatDesignTemperature(standardMinTempC, units)}; halves losses below that.`;
}

/** "9 days" or "1 day". */
export function dayCount(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}
