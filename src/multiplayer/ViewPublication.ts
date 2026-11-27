import { roomViewBuilder, type roomView } from "./World";
import type { RoomView, World } from "./Types";
import { CONTROL_VIEW_INTERVAL_MS, VIEW_INTERVAL_MS } from "./Timing";

interface PublicationRequest {
  urgent?: boolean;
  force?: boolean;
  receipt?: { sender: string; sequence: number; error?: string };
}

/** Coalesce before cloning grids. Revisions cover commands/ticks; safety stops also change
 * clock state without advancing the simulation revision. No game-state deep comparison. */
export class ViewPublication {
  private published?: string;
  private lastSent = -Infinity;
  private nextOrdinaryView = -Infinity;
  private urgent = false;
  private force = false;
  private receipts = new Map<string, NonNullable<RoomView["receipt"]>>();
  constructor(private build?: typeof roomView) {}

  private key(world: World) {
    return JSON.stringify([
      world.epoch,
      world.revision,
      world.speed,
      world.paused,
      world.readyRequired,
      world.reason,
      world.ready,
    ]);
  }

  /** Leave the renderer time for input after consuming a costly grid. A stalled or hidden
   * renderer can add at most one ordinary interval once it resumes. */
  consumed(now: number) {
    this.nextOrdinaryView =
      now + Math.min(now - this.lastSent, VIEW_INTERVAL_MS);
  }

  /** Undefined means nothing changed. Otherwise return the delay before the latest state
   * should be cloned, with prompt command receipts and immediate recovery baselines. */
  request(world: World, now: number, request: PublicationRequest = {}) {
    this.urgent ||= !!request.urgent;
    this.force ||= !!request.force;
    if (request.receipt) {
      const { sender, ...receipt } = request.receipt;
      if (world.seats.some((seat) => seat.id === sender))
        this.receipts.set(sender, receipt);
    }
    if (
      !this.force &&
      !this.receipts.size &&
      this.key(world) === this.published
    ) {
      this.urgent = false;
      return;
    }
    if (this.force) return 0;
    const due = this.urgent
      ? this.lastSent + CONTROL_VIEW_INTERVAL_MS
      : Math.max(this.lastSent + VIEW_INTERVAL_MS, this.nextOrdinaryView);
    return Math.max(0, due - now);
  }

  take(world: World, now: number, seatIds?: readonly string[]) {
    const key = this.key(world);
    const all = this.force || this.published !== key;
    const seats = world.seats.filter(
      (seat) =>
        (!seatIds || seatIds.includes(seat.id)) &&
        (all || this.receipts.has(seat.id)),
    );
    const build = this.build;
    const project = build
      ? (seatId: string) => build(world, seatId)
      : roomViewBuilder(world);
    const views = Object.fromEntries(
      seats.map((seat) => {
        const view = project(seat.id);
        const receipt = this.receipts.get(seat.id);
        if (receipt) view.receipt = receipt;
        return [seat.id, view];
      }),
    );
    if (seats.length) {
      this.published = key;
      this.lastSent = now;
    }
    this.force = this.urgent = false;
    this.receipts.clear();
    return views;
  }
}
