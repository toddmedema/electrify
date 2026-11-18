import * as React from "react";
import { useStore } from "react-redux";
import type { RootState } from "../../Store";
import type { GameType, TerritoryTileId } from "../../Types";
import { useAppDispatch, useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import { tilePurchaseQuote } from "../../helpers/Territories";
import { ownsTerritoryTile } from "../../helpers/TerritoryTiles";
import { acquireTile } from "../../reducers/GameActions";
import { waitForPurchase } from "../../helpers/WaitForPurchase";
import { multiplayerRuntime } from "../../multiplayer/Registry";
import { useMoney } from "./CurrencyContext";

export type TilePurchaseResult =
  | { status: "connected" }
  | { status: "rejected" | "cancelled"; message: string };

interface Purchases {
  pendingIds: ReadonlySet<TerritoryTileId>;
  pendingCost: number;
  availableCash: number;
  message: string;
  purchase: (
    tileId: TerritoryTileId,
    expectedQuoteKey?: string,
  ) => Promise<TilePurchaseResult>;
}
interface PendingPurchase {
  price: number;
  tileIds: TerritoryTileId[];
}
const PurchaseContext = React.createContext<Purchases | undefined>(undefined);

/** One local commitment ledger shared by the inspection surface and acquisition layer. */
export function TerritoryTilePurchasesProvider({
  game,
  children,
}: {
  game: GameType;
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const runId = useAppSelector((state) => state.ui?.evidenceRunId);
  const { formatMoneyConcise: money } = useMoney();
  const pending = React.useRef(new Map<TerritoryTileId, PendingPurchase>());
  const currentGame = React.useRef(game);
  currentGame.current = game;
  const session = React.useRef(0);
  const [, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    session.current += 1;
    pending.current.clear();
    setMessage("");
    refresh();
    return () => {
      session.current += 1;
    };
  }, [runId, game.seed, game.scenarioId]);
  React.useEffect(() => {
    const accepted = [...pending.current.keys()].filter((id) =>
      ownsTerritoryTile(game, id),
    );
    if (!accepted.length) return;
    accepted.forEach((id) => pending.current.delete(id));
    setMessage(
      `${accepted.length === 1 ? "Site connected" : `${accepted.length} sites connected`}. ${money(currentTick(game)?.cash ?? 0)} cash remaining.`,
    );
    refresh();
  }, [game, money]);
  const pendingCost = [...pending.current].reduce(
    (sum, [id, entry]) => sum + (ownsTerritoryTile(game, id) ? 0 : entry.price),
    0,
  );
  const pendingIds = new Set(
    [...pending.current.values()].flatMap(({ tileIds }) => tileIds),
  );
  const purchase = async (
    tileId: TerritoryTileId,
    expectedQuoteKey?: string,
  ): Promise<TilePurchaseResult> => {
    const latest = currentGame.current;
    const quote = tilePurchaseQuote(latest, tileId);
    if (!quote) {
      setMessage("This site is no longer available. Select it to inspect.");
      return {
        status: "rejected",
        message: "This site is no longer available.",
      };
    }
    const tileIds = quote.purchases.map(({ tileId }) => tileId);
    if (
      [...pending.current.values()].some((entry) =>
        entry.tileIds.some((id) => tileIds.includes(id)),
      )
    )
      return {
        status: "rejected",
        message: "This connection is already pending.",
      };
    if (expectedQuoteKey && quote.quoteKey !== expectedQuoteKey) {
      setMessage("The connection cost changed. Review it and activate again.");
      return {
        status: "rejected",
        message: "The connection cost changed. Review the updated details.",
      };
    }
    const committed = [...pending.current].reduce(
      (sum, [id, entry]) =>
        sum + (ownsTerritoryTile(latest, id) ? 0 : entry.price),
      0,
    );
    if ((currentTick(latest)?.cash ?? 0) - committed < quote.price) {
      setMessage("Not enough available cash to connect this site.");
      return {
        status: "rejected",
        message: "Not enough available cash to connect this site.",
      };
    }
    const entry = { price: quote.price, tileIds };
    const operationSession = session.current;
    pending.current.set(tileId, entry);
    setMessage(`Connecting · ${money(quote.price)}…`);
    refresh();
    try {
      const payload = { tileId, quoteKey: quote.quoteKey };
      const runtime = multiplayerRuntime();
      if (runtime)
        await runtime.submit({ kind: "action", name: "acquireTile", payload });
      else {
        dispatch(acquireTile(payload));
        if (!ownsTerritoryTile(store.getState().game, tileId))
          throw new Error(
            "Connection unavailable. Review the site and try again.",
          );
      }
      const connected = await waitForPurchase(
        () => store.getState(),
        (state) => (ownsTerritoryTile(state.game, tileId) ? true : undefined),
      );
      if (operationSession !== session.current)
        return { status: "cancelled", message: "The run changed." };
      if (!connected)
        throw new Error(
          "Connection is not confirmed. Review the site before trying again.",
        );
      if (pending.current.delete(tileId)) refresh();
      return { status: "connected" };
    } catch (cause) {
      if (operationSession !== session.current)
        return { status: "cancelled", message: "The run changed." };
      // Projected ownership is authoritative even if the receipt connection drops afterward.
      if (ownsTerritoryTile(store.getState().game, tileId))
        return { status: "connected" };
      pending.current.delete(tileId);
      setMessage(
        cause instanceof Error ? cause.message : "Connection unavailable.",
      );
      refresh();
      return {
        status: "rejected",
        message:
          cause instanceof Error ? cause.message : "Connection unavailable.",
      };
    }
  };
  return (
    <PurchaseContext.Provider
      value={{
        pendingIds,
        pendingCost,
        availableCash: (currentTick(game)?.cash ?? 0) - pendingCost,
        message,
        purchase,
      }}
    >
      {children}
    </PurchaseContext.Provider>
  );
}
export function useTerritoryTilePurchases(): Purchases {
  const context = React.useContext(PurchaseContext);
  if (!context)
    throw new Error("Tile purchases require their workspace provider");
  return context;
}
