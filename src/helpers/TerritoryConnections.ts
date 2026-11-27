import type { DifficultyType, GameType, TerritoryTileId } from "../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

const connectionMonths: Record<DifficultyType, number> = {
  Intern: 1,
  Employee: 2,
  Manager: 3,
  VP: 4,
  CEO: 6,
};

export const tileConnectionDuration = (difficulty: DifficultyType) =>
  connectionMonths[difficulty] * MINUTES_PER_MONTH;

export type TileConnection = {
  startedMinute: number;
  towerMinute: number;
  connectionMinute: number;
};

export function pendingTileConnections(
  game: Pick<GameType, "date" | "difficulty" | "territoryNetwork">,
): ReadonlyMap<TerritoryTileId, TileConnection> {
  const result = new Map<TerritoryTileId, TileConnection>();
  for (const { tileId, minute, connectionMinute } of game.territoryNetwork
    ?.tilePurchases ?? []) {
    if (connectionMinute !== undefined && connectionMinute > game.date.minute)
      result.set(tileId, {
        startedMinute: minute,
        towerMinute: minute + tileConnectionDuration(game.difficulty),
        connectionMinute,
      });
  }
  return result;
}

export function tileConnectionProgress(
  { startedMinute, connectionMinute }: TileConnection,
  minute: number,
): number {
  const duration = connectionMinute - startedMinute;
  return duration > 0
    ? Math.max(0, Math.min(1, (minute - startedMinute) / duration))
    : 1;
}

export function tileConnectionLabel(
  connection: TileConnection,
  minute: number,
) {
  return minute >= connection.towerMinute
    ? "Waiting for upstream connection"
    : "Connection under construction";
}

export function tileConnectionStatus(
  connection: TileConnection,
  game: Pick<GameType, "date" | "startingYear">,
) {
  const ready = getDateFromMinute(
    connection.connectionMinute,
    game.startingYear,
  );
  return `${tileConnectionLabel(connection, game.date.minute)} · Connects ${ready.month} ${ready.year}`;
}

export function formatConnectionDuration(months: number) {
  return `${months} ${months === 1 ? "month" : "months"}`;
}
