import * as React from "react";
import { useStore } from "react-redux";
import type { RootState } from "../../Store";
import type { GameType, TerritoryTileId } from "../../Types";
import { useAppDispatch, useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import { tilePurchaseQuote } from "../../helpers/Territories";
import { ownsTerritoryTile } from "../../helpers/TerritoryTiles";
import { acquireTile } from "../../reducers/GameActions";
import { multiplayerRuntime } from "../../multiplayer/Registry";
import { useMoney } from "./CurrencyContext";

interface Purchases {
  pendingIds: ReadonlySet<TerritoryTileId>;
  pendingCost: number;
  availableCash: number;
  message: string;
  purchase: (
    tileId: TerritoryTileId,
    expectedQuoteKey?: string,
  ) => Promise<void>;
}
interface PendingPurchase {
  price: number;
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
      `${accepted.length === 1 ? "Tile purchased" : `${accepted.length} tiles purchased`}. ${money(currentTick(game)?.cash ?? 0)} cash remaining.`,
    );
    refresh();
  }, [game, money]);
  const pendingCost = [...pending.current].reduce(
    (sum, [id, entry]) => sum + (ownsTerritoryTile(game, id) ? 0 : entry.price),
    0,
  );
  const purchase = async (
    tileId: TerritoryTileId,
    expectedQuoteKey?: string,
  ) => {
    if (pending.current.has(tileId)) return;
    const latest = currentGame.current;
    const quote = tilePurchaseQuote(latest, tileId);
    if (!quote) {
      setMessage("This tile is no longer available. Select it to inspect.");
      return;
    }
    if (expectedQuoteKey && quote.quoteKey !== expectedQuoteKey) {
      setMessage(
        "The tile price changed. Review its price and activate again.",
      );
      return;
    }
    const committed = [...pending.current].reduce(
      (sum, [id, entry]) =>
        sum + (ownsTerritoryTile(latest, id) ? 0 : entry.price),
      0,
    );
    if ((currentTick(latest)?.cash ?? 0) - committed < quote.price) {
      setMessage("Not enough available cash to buy this tile.");
      return;
    }
    const entry = { price: quote.price };
    const operationSession = session.current;
    pending.current.set(tileId, entry);
    setMessage(`Buying tile · ${money(quote.price)}…`);
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
            "Tile purchase unavailable. Review the tile and try again.",
          );
      }
      // A receipt may precede the host's projected state. Only ownership confirms success.
    } catch (cause) {
      if (
        operationSession !== session.current ||
        pending.current.get(tileId) !== entry
      )
        return;
      pending.current.delete(tileId);
      setMessage(
        cause instanceof Error ? cause.message : "Tile purchase unavailable.",
      );
      refresh();
    }
  };
  return (
    <PurchaseContext.Provider
      value={{
        pendingIds: new Set(pending.current.keys()),
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
