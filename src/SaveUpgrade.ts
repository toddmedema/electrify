import type { BuyingRuleType, SellingRuleType, GameType } from "./Types";
import { inheritedConnection } from "./helpers/PowerAgreements";

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
  // 9 -> 10: make already-owned inherited interfaces visible without inventing past purchases.
  (save) => {
    if (!object(save.game)) return null;
    const game = save.game;
    if (!game.utilityExpansion) return save;
    if (
      !object(game.utilityExpansion) ||
      !Array.isArray(game.utilityExpansion.acquisitions) ||
      !object(game.transmission) ||
      !Array.isArray(game.transmission.lines)
    )
      return null;
    const lines = [...game.transmission.lines] as NonNullable<
      GameType["transmission"]
    >["lines"];
    let nextId = Math.max(0, ...lines.map((line) => line?.id || 0)) + 1;
    const additions = [inheritedConnection("champlain", nextId++)];
    for (const receipt of game.utilityExpansion.acquisitions) {
      if (
        !object(receipt) ||
        (receipt.targetId !== "valley-electric" &&
          receipt.targetId !== "ridge-electric") ||
        typeof receipt.minute !== "number"
      )
        return null;
      additions.push(
        inheritedConnection(receipt.targetId, nextId++, receipt.minute),
      );
    }
    return {
      ...save,
      game: {
        ...game,
        transmission: {
          ...game.transmission,
          lines: [...lines, ...additions],
          acceptedAgreements: [],
        },
      },
    };
  },
  // 10 -> 11: preserve the pay-as-delivered promises already accepted or inherited.
  (save) => {
    if (!object(save.game)) return null;
    const game = save.game;
    if (!game.utilityExpansion) return save;
    if (!object(game.transmission)) return null;
    const receipts = game.transmission.acceptedAgreements ?? [];
    if (
      !Array.isArray(receipts) ||
      receipts.some((receipt) => !object(receipt) || "termsVersion" in receipt)
    )
      return null;
    return {
      ...save,
      game: {
        ...game,
        transmission: {
          ...game.transmission,
          inheritedAgreementTerms: 1,
          acceptedAgreements: receipts.map((receipt) => ({
            ...receipt,
            termsVersion: 1,
          })),
        },
      },
    };
  },
  // 11 -> 12: variable-duration monthly-energy terms are opt-in new promises only.
  // Preserve every existing v1/v2 receipt, inherited term, meter and recorded dollar.
  (save) => save,
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
