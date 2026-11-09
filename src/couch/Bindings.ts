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

export interface BindingFailure {
  epoch: number;
  message: string;
  controllerId: string;
  nativeOwner?: string;
}

/** After native accepts `controllerId` for `seatId`, drop this epoch's failures for that
 * company or controller and return their messages. Native routes one controller per
 * company, so a different controller's retained ownership of `seatId` is now stale and
 * must stop pinning that controller's retry to an accepted company. */
export function settleBindingFailures(
  failures: Map<string, BindingFailure>,
  epoch: number,
  seatId: string,
  controllerId: string,
): string[] {
  const cleared: string[] = [];
  for (const [failedSeat, failure] of failures) {
    if (failure.epoch !== epoch) continue;
    if (failedSeat === seatId || failure.controllerId === controllerId) {
      cleared.push(failure.message);
      failures.delete(failedSeat);
    } else if (failure.nativeOwner === seatId)
      failures.set(failedSeat, { ...failure, nativeOwner: undefined });
  }
  return cleared;
}
