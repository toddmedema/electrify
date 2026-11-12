import type { Command, RoomView } from "../multiplayer/Types";
import {
  COMMAND_RESEND_MS,
  CONTROL_HEARTBEAT_TIMEOUT_MS,
  MAX_QUEUED_COMMANDS,
  SESSION_PUMP_MS,
} from "../multiplayer/Timing";
import type { SeatEvent, SeatMessage } from "./Protocol";

interface Queued {
  command: Command;
  resolve: () => void;
  reject: (error: Error) => void;
}
export interface CouchClientState {
  view?: RoomView;
  error?: string;
  pending: boolean;
  connected: boolean;
  closing: boolean;
}

/** A seat owns UI state and commands, never the worker, account services or persistence. */
export class CouchClient {
  private state: CouchClientState = {
    pending: false,
    connected: false,
    closing: false,
  };
  private listeners = new Set<() => void>();
  private queue: Queued[] = [];
  private pending?: Queued & {
    message: Extract<SeatMessage, { kind: "command" }>;
  };
  private activityReason: string | null = null;
  private sequence = 0;
  private lastMessage = Date.now();
  private lastSend = 0;
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private leaves = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  constructor(
    readonly seatId: string,
    readonly generation: number,
    private send: (message: SeatMessage) => void,
  ) {
    this.timer = setInterval(() => this.pump(), SESSION_PUMP_MS);
    this.send({ kind: "heartbeat" });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(update: Partial<CouchClientState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  /** Apply only this renderer generation's session events and acknowledge received views.
   * Match/epoch changes discard old commands; authoritative receipts settle the current queue. */
  receive(input: unknown) {
    if (this.disposed || !input || typeof input !== "object") return;
    const event = input as SeatEvent;
    if (event.generation !== this.generation) return;
    this.lastMessage = Date.now();
    if (event.kind === "pulse") {
      if (!this.state.connected) this.update({ connected: true });
      return;
    }
    if (event.kind === "error") {
      this.update({ error: event.message });
      return;
    }
    if (event.kind === "shell-command") {
      const view = this.state.view;
      if (
        view &&
        view.matchId === event.matchId &&
        view.epoch === event.epoch &&
        event.command?.kind === "speed"
      )
        this.command(event.command);
      return;
    }
    if (event.kind === "rejected") {
      const pending = this.pending;
      if (
        !pending ||
        pending.message.sequence !== event.sequence ||
        pending.message.matchId !== event.matchId ||
        pending.message.epoch !== event.epoch
      )
        return;
      this.pending = undefined;
      this.sequence = event.lastSequence;
      this.update({ pending: false, error: event.message });
      pending.reject(new Error(event.message));
      this.queue
        .splice(0)
        .forEach((queued) => queued.reject(new Error(event.message)));
      return;
    }
    if (event.kind === "leave-result") {
      const leave = this.leaves.get(event.requestId);
      this.leaves.delete(event.requestId);
      if (event.error) leave?.reject(new Error(event.error));
      else leave?.resolve();
      return;
    }
    if (event.kind === "closing") {
      this.update({ closing: event.closing });
      if (event.closing) {
        // These actions never reached the coordinator and cannot be represented as saved.
        this.queue
          .splice(0)
          .forEach((queued) =>
            queued.reject(
              new Error(
                "Save & Quit started. This unsent action was not saved.",
              ),
            ),
          );
      } else this.flush();
      return;
    }
    if (
      event.kind !== "view" ||
      !event.view ||
      !Number.isSafeInteger(event.delivery)
    )
      return;
    const view = event.view;
    const previous = this.state.view;
    if (!view.game || view.game.multiplayer?.seat !== this.seatId) return;
    if (
      previous &&
      previous.epoch === view.epoch &&
      previous.matchId === view.matchId &&
      view.revision < previous.revision
    ) {
      this.send({ kind: "ack", delivery: event.delivery });
      return;
    }
    if (
      previous &&
      (previous.epoch !== view.epoch || previous.matchId !== view.matchId)
    ) {
      this.rejectPending(
        "The local session changed. Old actions were discarded.",
      );
      this.sequence = 0;
    }
    this.sequence = Math.max(this.sequence, view.lastSequence);
    let completed: typeof this.pending;
    if (
      this.pending &&
      (view.lastSequence >= this.pending.message.sequence ||
        view.receipt?.sequence === this.pending.message.sequence)
    ) {
      completed = this.pending;
      this.pending = undefined;
    }
    this.update({
      view,
      connected: true,
      pending: !!this.pending,
      error: completed ? view.receipt?.error : this.state.error,
    });
    // Acknowledgment is sent after the owning store has synchronously observed this baseline.
    this.send({ kind: "ack", delivery: event.delivery });
    if (completed) {
      if (view.receipt?.error) completed.reject(new Error(view.receipt.error));
      else completed.resolve();
    }
    this.flushActivity();
    this.flush();
  }
  command = (command: Command) => {
    void this.submit(command).catch((error: Error) =>
      this.update({ error: error.message }),
    );
  };
  submit = (command: Command): Promise<void> => {
    if (this.disposed || this.state.closing || !this.state.view)
      return Promise.reject(
        new Error("The local seat is not accepting actions"),
      );
    if (this.queue.length >= MAX_QUEUED_COMMANDS)
      return Promise.reject(
        new Error("Wait for your previous actions to finish"),
      );
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.flush();
    });
  };
  activity = (reason: string | null) => {
    this.activityReason = reason;
    this.flushActivity();
  };
  private flushActivity() {
    const own = this.state.view?.grids.find(
      (grid) => grid.seat.id === this.seatId,
    );
    if (
      !own ||
      this.pending ||
      this.state.closing ||
      this.queue.some((queued) => queued.command.kind === "activity")
    )
      return;
    if ((own.pauseReason ?? null) !== this.activityReason)
      this.command({ kind: "activity", reason: this.activityReason });
  }
  /** Assign a sequence only when one queued action can enter the current match.
   * Keeping a single pending envelope makes retries identical and preserves command order. */
  private flush() {
    const view = this.state.view;
    if (
      !view ||
      this.pending ||
      this.state.closing ||
      !this.state.connected ||
      !this.queue.length ||
      this.disposed
    )
      return;
    const queued = this.queue.shift()!;
    this.pending = {
      ...queued,
      message: {
        kind: "command",
        matchId: view.matchId,
        epoch: view.epoch,
        sequence: ++this.sequence,
        command: queued.command,
      },
    };
    this.update({ pending: true });
    this.transmit();
  }
  private transmit() {
    if (!this.pending) return;
    this.lastSend = Date.now();
    this.send(this.pending.message);
  }
  settings = () => {
    if (!this.disposed)
      this.send({ kind: "global-settings", requestId: crypto.randomUUID() });
  };
  menu = () => {
    if (!this.disposed)
      this.send({ kind: "global-menu", requestId: crypto.randomUUID() });
  };
  leave = (options?: { skipSave?: boolean }): Promise<void> => {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      this.leaves.set(requestId, { resolve, reject });
      this.send({ kind: "leave", requestId, skipSave: options?.skipSave });
    });
  };
  /** Continue heartbeats while paused and resend the same pending envelope after packet loss.
   * A missing coordinator stops queue progress without pretending the action was applied. */
  private pump() {
    if (this.disposed) return;
    this.send({ kind: "heartbeat" });
    if (Date.now() - this.lastMessage > CONTROL_HEARTBEAT_TIMEOUT_MS) {
      this.update({
        connected: false,
        error:
          "The shared session stopped responding. Recover through the TV session screen.",
      });
      return;
    }
    if (
      this.pending &&
      !this.state.closing &&
      Date.now() - this.lastSend >= COMMAND_RESEND_MS
    )
      this.transmit();
    this.flush();
  }
  private rejectPending(message: string) {
    this.pending?.reject(new Error(message));
    this.pending = undefined;
    this.queue.splice(0).forEach((queued) => queued.reject(new Error(message)));
    this.update({ pending: false });
  }
  dismissError() {
    this.update({ error: undefined });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.rejectPending("The local seat closed");
    this.leaves.forEach((leave) =>
      leave.reject(new Error("The local seat closed")),
    );
    this.leaves.clear();
    this.listeners.clear();
  }
}
