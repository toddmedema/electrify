import type { Seat } from "../multiplayer/Types";

/** Choose a company only after an unused controller explicitly requests a seat. Roster order
 * is stable; the connected-device list supplies availability, never company ownership. */
export function nextControllerSeat(
  seats: readonly Seat[],
  bindings: Readonly<Record<string, string>>,
  connected: ReadonlySet<string>,
  retired: ReadonlySet<string>,
): Seat | undefined {
  const hasController = (seat: Seat) =>
    !!bindings[seat.id] && connected.has(bindings[seat.id]);
  const active = seats.filter((seat) => !retired.has(seat.id));
  if (active.length) return active.find((seat) => !hasController(seat));
  // Completed companies do not need controllers. With nobody left to operate results,
  // one explicit claim restores session controls without creating or replacing a company.
  return seats.some(hasController) ? undefined : seats[0];
}
