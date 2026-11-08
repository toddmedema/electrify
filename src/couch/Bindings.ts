import type { Seat } from "../multiplayer/Types";

/** Choose a company only after an unused controller explicitly requests a seat. Roster order
 * is stable; a native owner retained after an incomplete bind limits its retry target.
 * The connected-device list supplies availability, never company ownership. */
export function nextControllerSeat(
  seats: readonly Seat[],
  bindings: Readonly<Record<string, string>>,
  connected: ReadonlySet<string>,
  retired: ReadonlySet<string>,
  nativeOwner?: string,
  pending: ReadonlySet<string> = new Set(),
): Seat | undefined {
  const hasController = (seat: Seat) =>
    !!bindings[seat.id] && connected.has(bindings[seat.id]);
  const active = seats.filter((seat) => !retired.has(seat.id));
  const eligible = (seat: Seat) =>
    !hasController(seat) && !pending.has(seat.id);
  if (nativeOwner !== undefined) {
    const owned = seats.find((seat) => seat.id === nativeOwner);
    if (!owned || !eligible(owned)) return;
    if (active.length) return retired.has(owned.id) ? undefined : owned;
    return seats.some(hasController) ? undefined : owned;
  }
  if (active.length) return active.find(eligible);
  // Completed companies do not need controllers. With nobody left to operate results,
  // one explicit claim restores session controls without creating or replacing a company.
  return seats.some(hasController)
    ? undefined
    : seats.find((seat) => !pending.has(seat.id));
}
