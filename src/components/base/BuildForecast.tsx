import * as React from "react";
import { useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import type { GameType } from "../../Types";
import { signature } from "./DeferredProjection";
import type { BuildForecast } from "./OutlookForecast";
import { useOutlookWorker } from "./useOutlookWorker";

const BuildForecastContext = React.createContext<
  { forecast: BuildForecast | undefined } | undefined
>(undefined);

function buildForecastKey(game: GameType): string | undefined {
  const now = currentTick(game);
  if (!now) return undefined;
  return (
    signature(game) +
    (game.speed === "PAUSED"
      ? `/${game.date.minute}/${now.cash}/${now.customers}`
      : "")
  );
}

/** Start after the game paints, and keep the worker/data alive when the catalog closes. */
export function BuildForecastProvider(props: { children: React.ReactNode }) {
  const game = useAppSelector((state) => state.game);
  const forecast = useOutlookWorker("build", buildForecastKey(game), game);
  const value = React.useMemo(() => ({ forecast }), [forecast]);
  return (
    <BuildForecastContext.Provider value={value}>
      {props.children}
    </BuildForecastContext.Provider>
  );
}

/** Standalone catalogs also work without a game workspace (including component previews). */
export function useBuildForecast(game: GameType): BuildForecast | undefined {
  const shared = React.useContext(BuildForecastContext);
  const local = useOutlookWorker(
    "build",
    shared ? undefined : buildForecastKey(game),
    game,
  );
  return shared ? shared.forecast : local;
}
