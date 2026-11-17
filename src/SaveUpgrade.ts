import {
  legacyTerritoryTiles,
  assignTerritoryTiles,
  getTerritoryTile,
} from "./helpers/TerritoryTiles";
import type { BuyingRuleType, SellingRuleType, GameType } from "./Types";
import { inheritedConnection } from "./helpers/PowerAgreements";
import { facilityTerritoryId } from "./helpers/Territories";

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
    if (
      game.transmission.lines.some(
        (line) =>
          !object(line) ||
          typeof line.id !== "number" ||
          !Number.isSafeInteger(line.id) ||
          line.id < 1,
      )
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
  // 12 -> 13: locate existing scenario116 assets without rewriting recorded history or accounts.
  (save) => {
    if (!object(save.game)) return null;
    const game = save.game;
    const custom = game.customScenario;
    const base116 =
      (game.scenarioId === 116 && custom === undefined) ||
      (game.scenarioId === 999 &&
        object(custom) &&
        custom.id === 999 &&
        object(custom.mod) &&
        object(custom.mod.parameters) &&
        custom.mod.parameters.baseScenarioId === 116);
    if (!base116) return save;
    if (
      game.territoryNetwork !== undefined ||
      !Array.isArray(game.facilities) ||
      game.facilities.some(
        (facility) => !object(facility) || facility.territoryId !== undefined,
      )
    )
      return null;
    return {
      ...save,
      game: {
        ...game,
        territoryNetwork: { version: 1 },
        facilities: game.facilities.map((facility) => ({
          ...facility,
          territoryId: facilityTerritoryId(facility),
        })),
      },
    };
  },
  // 13 -> 14: pool company power and convert every paid land project to immediate rights.
  // Freeze retired project terms/capital/debt; refund nothing and preserve recorded history.
  (save) => {
    if (!object(save.game)) return null;
    const game = save.game;
    if (game.territoryNetwork === undefined) return save;
    if (
      !object(game.territoryNetwork) ||
      game.territoryNetwork.version !== 1 ||
      Object.keys(game.territoryNetwork).length !== 1 ||
      !object(game.transmission) ||
      !Array.isArray(game.transmission.lines) ||
      !object(game.date)
    )
      return null;
    const lines = game.transmission.lines;
    if (lines.some((line) => !object(line))) return null;
    const uplands = lines.find(
      (line) => line.corridorId === "vt-champlain-uplands",
    );
    const legacyConnections = lines.filter(
      (line) =>
        typeof line.corridorId === "string" &&
        !line.corridorId.startsWith("peer:"),
    );
    return {
      ...save,
      game: {
        ...game,
        territoryNetwork: {
          version: 2,
          landPurchases: uplands
            ? [
                {
                  territoryId: "green-uplands",
                  minute: uplands.minuteCreated,
                  price: uplands.buildCost,
                  legacy: true,
                },
              ]
            : [],
          legacyConnections,
        },
        transmission: {
          ...game.transmission,
          lines: lines.filter((line) => !legacyConnections.includes(line)),
        },
      },
    };
  },
  // 14 -> 15: retain paid rights and their exact capital while allowing independent parcels.
  (save) => {
    if (!object(save.game)) return null;
    const game = save.game;
    if (game.territoryNetwork === undefined) return save;
    if (
      !object(game.territoryNetwork) ||
      game.territoryNetwork.version !== 2 ||
      Object.keys(game.territoryNetwork).length !== 3
    )
      return null;
    if (
      !Array.isArray(game.territoryNetwork.landPurchases) ||
      game.territoryNetwork.landPurchases.length > 1 ||
      game.territoryNetwork.landPurchases.some(
        (receipt) =>
          !object(receipt) || receipt.territoryId !== "green-uplands",
      )
    )
      return null;
    const multiplayer = object(game.multiplayer) ? game.multiplayer : undefined;
    const { landOwner, ...retainedMultiplayer } = multiplayer ?? {};
    return {
      ...save,
      game: {
        ...game,
        territoryNetwork: { ...game.territoryNetwork, version: 3 },
        ...(multiplayer
          ? {
              multiplayer: {
                ...retainedMultiplayer,
                ...(landOwner !== undefined
                  ? { landOwners: { "green-uplands": landOwner } }
                  : {}),
              },
            }
          : {}),
      },
    };
  },
  // 15 -> 16: split retained territory budgets into one city or one facility per hex.
  (save) => {
    if (!object(save.game)) return null;
    if (save.game.territoryNetwork === undefined) return save;
    if (
      !object(save.game.territoryNetwork) ||
      save.game.territoryNetwork.version !== 3 ||
      !Array.isArray(save.game.facilities) ||
      save.game.facilities.some(
        (facility) =>
          !object(facility) ||
          !Number.isSafeInteger(facility.id) ||
          (typeof facility.fuel !== "string" &&
            typeof facility.peakWh !== "number") ||
          typeof facility.peakW !== "number",
      )
    )
      return null;
    const game = {
      ...save.game,
      facilities: save.game.facilities.map((facility) => ({ ...facility })),
    } as unknown as GameType;
    if (!assignTerritoryTiles(game)) return null;
    return { ...save, game };
  },
  // 16 -> 17: paid region receipts retain every original tile and exact finances.
  // Freeze retained overflow footprints; new purchases record one cell in a separate ledger.
  (save) => {
    if (!object(save.game)) return null;
    if (save.game.territoryNetwork === undefined) return save;
    const state = save.game.territoryNetwork;
    if (
      !object(state) ||
      state.version !== 3 ||
      Object.keys(state).some(
        (key) =>
          ![
            "version",
            "landPurchases",
            "legacyConnections",
            "tilePurchases",
          ].includes(key),
      ) ||
      !Array.isArray(state.landPurchases) ||
      !Array.isArray(state.legacyConnections) ||
      (state.tilePurchases !== undefined &&
        (!Array.isArray(state.tilePurchases) || state.tilePurchases.length > 0))
    )
      return null;
    return {
      ...save,
      game: {
        ...save.game,
        territoryNetwork: {
          ...state,
          tilePurchases: [],
          legacyTiles: legacyTerritoryTiles({
            facilities: (save.game as unknown as GameType).facilities,
          }),
        },
      },
    };
  },
  // 17 -> 18: purchases now require owned physical adjacency. Retain prior paid rights and
  // installed offshore plants when the landlocked authored water is corrected to a lake.
  (save) => {
    if (!object(save.game)) return null;
    if (save.game.territoryNetwork === undefined) return save;
    const state = save.game.territoryNetwork;
    if (
      !object(state) ||
      state.version !== 3 ||
      Object.keys(state).length !== 5 ||
      !Array.isArray(state.tilePurchases) ||
      !Array.isArray(state.legacyTiles) ||
      !Array.isArray(save.game.facilities) ||
      state.tilePurchases.some(
        (entry) =>
          !object(entry) ||
          Object.keys(entry).length !== 3 ||
          !("tileId" in entry) ||
          !("minute" in entry) ||
          !("price" in entry),
      ) ||
      state.legacyTiles.some((entry) => !object(entry)) ||
      save.game.facilities.some((entry) => !object(entry))
    )
      return null;
    const game = save.game as unknown as GameType;
    const legacyLakeOffshore = game.facilities.flatMap((facility) => {
      const tile = getTerritoryTile(facility.tileId, game);
      return facility.fuel === "Offshore Wind" &&
        tile &&
        (tile.id === "champlain:site-14" || tile.terrain === "ocean")
        ? [{ facilityId: facility.id, tileId: tile.id }]
        : [];
    });
    return {
      ...save,
      game: {
        ...save.game,
        territoryNetwork: {
          ...state,
          tilePurchases: state.tilePurchases.map((receipt) => ({
            ...receipt,
            legacy: true,
          })),
          legacyTiles: state.legacyTiles.map((tile) =>
            tile.terrain === "ocean" ? { ...tile, terrain: "lake" } : tile,
          ),
          ...(legacyLakeOffshore.length ? { legacyLakeOffshore } : {}),
        },
      },
    };
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
