import * as React from "react";
import { useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import type { GameType } from "../../Types";
import { signature } from "./DeferredProjection";
import type { BuildForecast } from "./OutlookForecast";
import { useOutlookWorker } from "./useOutlookWorker";
import { useGameWorkspaceLayout } from "./GameWorkspaceContext";
import { formatWatts } from "../../helpers/Format";
import ChartSupplyDemand from "./ChartSupplyDemand";

const BuildForecastContext = React.createContext<
  | { forecast: BuildForecast | undefined; gridEvidence: React.ReactNode }
  | undefined
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
  const workspace = useGameWorkspaceLayout();
  const showGridEvidence = workspace?.fleetVisible === false;
  const gridEvidence = React.useMemo(
    () => (showGridEvidence ? <BuildGridEvidence game={game} /> : null),
    [showGridEvidence, game],
  );
  const value = React.useMemo(
    () => ({ forecast, gridEvidence }),
    [forecast, gridEvidence],
  );
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

/** Reuse the live grid's forecast and accessible chart when Fleet is outside the active view. */
function BuildGridEvidence({ game }: { game: GameType }) {
  const now = currentTick(game);
  if (!now) return null;
  return (
    <details className="buildGridEvidence">
      <summary>
        Current grid · {formatWatts(now.supplyW)} supply ·{" "}
        {formatWatts(now.demandW)} demand
      </summary>
      <p>Supply and demand forecast</p>
      <ChartSupplyDemand
        timeline={game.timeline}
        currentMinute={game.date.minute}
        location={game.location}
        startingYear={game.startingYear}
        height={160}
        legend
      />
    </details>
  );
}
export function useBuildGridEvidence(): React.ReactNode {
  return React.useContext(BuildForecastContext)?.gridEvidence ?? null;
}
