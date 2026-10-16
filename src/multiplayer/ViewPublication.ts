import { roomView } from "./World";
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
  private urgent = false;
  private force = false;
  private receipts = new Map<string, NonNullable<RoomView["receipt"]>>();
  constructor(private build: typeof roomView = roomView) {}

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
    return this.force
      ? 0
      : Math.max(
          0,
          this.lastSent +
            (this.urgent ? CONTROL_VIEW_INTERVAL_MS : VIEW_INTERVAL_MS) -
            now,
        );
  }

  take(world: World, now: number) {
    const key = this.key(world);
    const all = this.force || this.published !== key;
    const seats = all
      ? world.seats
      : world.seats.filter((seat) => this.receipts.has(seat.id));
    const views = Object.fromEntries(
      seats.map((seat) => {
        const view = this.build(world, seat.id);
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
