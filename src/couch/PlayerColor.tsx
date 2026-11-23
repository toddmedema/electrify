import type { ReactNode } from "react";
import { useTheme } from "@mui/material/styles";

/** Colors follow the campaign seat, including after a controller is replaced. */
const playerPalette = new Map([
  ["local-p1", { light: "#6539a5", dark: "#c6a3ff" }], // violet
  ["local-p2", { light: "#973e14", dark: "#ff9e69" }], // copper
  ["local-p3", { light: "#92277a", dark: "#f094d8" }], // magenta
  ["local-p4", { light: "#705a00", dark: "#efd263" }], // gold
]);

export function couchPlayerColor(
  seatId: string | undefined,
  mode: "light" | "dark",
): string | undefined {
  return seatId === undefined ? undefined : playerPalette.get(seatId)?.[mode];
}

export function CouchPlayerText({
  seatId,
  children,
  className,
  useSeatColor = true,
}: {
  seatId?: string;
  children: ReactNode;
  className?: string;
  useSeatColor?: boolean;
}) {
  const color = couchPlayerColor(seatId, useTheme().palette.mode);
  return color || className ? (
    <span
      className={className}
      data-couch-player={color ? seatId : undefined}
      style={color && useSeatColor ? { color } : undefined}
    >
      {children}
    </span>
  ) : (
    <>{children}</>
  );
}
