import type { BuyingRuleType, SellingRuleType } from "./Types";
import { validUpgradeInProgress } from "./helpers/BuildValidation";

type DecodedSave = Record<string, unknown>;
type Migration = (save: DecodedSave) => DecodedSave | null;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Earlier development schemas need retired simulation behavior and are not guessed at. */
export const FIRST_SUPPORTED_SAVE_SCHEMA = 6;

// Append one step for each structural change. Keep existing steps unchanged so every supported
// input follows the same ordered path, then let parseSave validate the complete upgraded state.
const migrations: readonly Migration[] = [
  // 6 -> 7: replay recording was removed; the played grid and its history are unchanged.
  (save) => {
    if (!object(save.game)) return null;
    const { replayLog: _log, replayPlayback: _playback, ...game } = save.game;
    return { ...save, game };
  },
  // 7 -> 8: split trading permission into independent buying and selling rules. The old engine
  // imported only for shortages and exported only surplus; neither new optional behavior is on.
  (save) => {
    if (!object(save.game)) return null;
    if (save.game.transmission === undefined) return save;
    const transmission = save.game.transmission;
    if (
      !object(transmission) ||
      "buyingRule" in transmission ||
      "sellingRule" in transmission
    )
      return null;
    const rules: Record<string, readonly [BuyingRuleType, SellingRuleType]> = {
      BALANCED: ["SHORTAGES", "SURPLUS"],
      RELIABILITY_FIRST: ["SHORTAGES", "NONE"],
      SURPLUS_ONLY: ["NONE", "SURPLUS"],
      CLOSED: ["NONE", "NONE"],
    };
    const { tradingPolicy, ...rest } = transmission;
    if (
      typeof tradingPolicy !== "string" ||
      !Object.hasOwn(rules, tradingPolicy)
    )
      return null;
    const [buyingRule, sellingRule] = rules[tradingPolicy];
    return {
      ...save,
      game: {
        ...save.game,
        transmission: { ...rest, buyingRule, sellingRule },
      },
    };
  },
  // 8 -> 9: continued runs need future-only forecast refresh after data loads. Older apps do not
  // implement that continuation behavior and must not load these saves.
  (save) => save,
  // 9 -> 10: retain the supported solar options and discard retired installations. Financial
  // history stays intact; an obsolete installation no longer holds its facility offline.
  (save) => {
    if (!object(save.game) || !Array.isArray(save.game.facilities)) return null;
    const facilities: DecodedSave[] = [];
    for (const raw of save.game.facilities) {
      if (!object(raw)) return null;
      const facility = { ...raw };
      if (facility.fuel === "Sun") {
        if (facility.resilience !== undefined) {
          if (!object(facility.resilience)) return null;
          const retained: DecodedSave = {};
          for (const [key, value] of Object.entries(facility.resilience)) {
            if (["solarTrackers", "trackerHailDamageFactor"].includes(key))
              retained[key] = value;
            else if (value !== undefined && typeof value !== "boolean")
              return null;
          }
          facility.resilience = retained;
        }
        const pending = facility.upgradeInProgress;
        if (
          object(pending) &&
          typeof pending.upgrade === "string" &&
          !["coldWeatherPackage", "solarTrackers", "combinedCycle"].includes(
            pending.upgrade,
          )
        ) {
          if (
            !validUpgradeInProgress({
              ...pending,
              upgrade: "coldWeatherPackage",
            })
          )
            return null;
          delete facility.upgradeInProgress;
        }
      }
      facilities.push(facility);
    }
    return { ...save, game: { ...save.game, facilities } };
  },
];

/** Structure versions are independent of app releases and simulation compatibility. */
export const SAVE_SCHEMA_VERSION =
  FIRST_SUPPORTED_SAVE_SCHEMA + migrations.length;

/** Receives decoded data; copy each changed branch and never overwrite the stored original. */
export function upgradeSave(raw: unknown): DecodedSave | null {
  if (!object(raw)) return null;
  const version = raw.schemaVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < FIRST_SUPPORTED_SAVE_SCHEMA ||
    version > SAVE_SCHEMA_VERSION
  )
    return null;
  let save: DecodedSave = { ...raw };
  for (let from = version; from < SAVE_SCHEMA_VERSION; from++) {
    const upgraded = migrations[from - FIRST_SUPPORTED_SAVE_SCHEMA](save);
    if (!upgraded) return null;
    save = { ...upgraded, schemaVersion: from + 1 };
  }
  return save;
}
