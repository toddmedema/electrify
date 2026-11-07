import type {
  Command,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "../multiplayer/Types";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../multiplayer/WorkerProtocol";
import {
  CONTROL_HEARTBEAT_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
  SESSION_PUMP_MS,
} from "../multiplayer/Timing";
import { isLocalRoster, isSeatMessage } from "./Protocol";
import type { CouchSummary, SeatEvent, SeatMessage } from "./Protocol";

interface Route {
  generation: number;
  send: (event: SeatEvent) => void;
  seen: number;
  delivery: number;
  outstanding?: number;
  latest?: RoomView;
  failed?: boolean;
  pendingSequence?: number;
}
export interface CouchState {
  phase: "setup" | "starting" | "playing" | "faulted" | "closed";
  blockers: readonly string[];
  summary?: CouchSummary;
  saving: boolean;
  closing: boolean;
  lastSavedAt?: number;
  error?: string;
}
export interface CouchCoordinatorOptions {
  /** Only worker checkpoints reach persistence, never partial renderer grids. */
  persist: (world: World) => Promise<unknown>;
  onLeave?: (
    seatId: string,
    generation: number,
    request: Extract<SeatMessage, { kind: "leave" }>,
  ) => void;
  onSettings?: (seatId: string, generation: number, requestId: string) => void;
  onMenu?: (seatId: string, generation: number, requestId: string) => void;
  onSeatLost?: (seatId: string, generation: number, reason: string) => void;
  onSummary?: (summary: CouchSummary) => void;
  /** Account publication must not wait for a stalled seat renderer to acknowledge a view. */
  onAccountView?: (view: RoomView) => void;
  /** Common event/calendar presentation follows a company still playing, independently of P1. */
  onSharedView?: (view: RoomView) => void;
  onError?: (message: string) => void;
  now?: () => number;
}

/** One shell owns this coordinator and worker. Every incoming route was bound by main. */
export class CouchCoordinator {
  private state: CouchState = {
    phase: "setup",
    blockers: [],
    saving: false,
    closing: false,
  };
  private listeners = new Set<() => void>();
  private routes = new Map<string, Route>();
  private roster: Seat[] = [];
  private views = new Map<string, RoomView>();
  private sharedView?: RoomView;
  private blockers = new Map<string, string>();
  private inputGates = new Set<string>();
  private saving: Promise<unknown> = Promise.resolve();
  private lifecycle = 0;
  private saveNumber = 0;
  private closingRequestId?: string;
  private savesPending = 0;
  private requests = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private timer: ReturnType<typeof setInterval>;
  private lastWorker = 0;
  private now: () => number;
  constructor(
    private worker: Worker,
    private options: CouchCoordinatorOptions,
  ) {
    this.now = options.now || Date.now;
    this.lastWorker = this.now();
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) =>
      this.response(data);
    worker.onerror = () =>
      this.fault(
        "The simulation stopped. Resume the last complete local save; recent progress may be lost.",
      );
    this.timer = setInterval(() => this.pump(), SESSION_PUMP_MS);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(update: Partial<CouchState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private post(message: WorkerRequest) {
    this.worker.postMessage(message);
  }
  private fault(message: string) {
    if (this.state.phase === "closed") return;
    this.update({ phase: "faulted", error: message });
    this.options.onError?.(message);
    this.broadcast((generation) => ({ kind: "error", generation, message }));
  }
  /** Commit the immutable logical roster once, before creating or restoring a world.
   * Native routes outside that roster lose authority before startup publications begin. */
  private prepare(seats: Seat[]) {
    if (this.state.phase !== "setup")
      throw new Error("This local session already started");
    if (!isLocalRoster(seats))
      throw new Error("A local match needs two to four named logical seats");
    this.roster = seats.map((seat) => ({ ...seat }));
    for (const id of this.routes.keys())
      if (!this.roster.some((seat) => seat.id === id)) this.routes.delete(id);
    this.update({ phase: "starting", error: undefined });
    this.lastWorker = this.now();
  }
  start(
    spec: MatchSpec,
    seats: Seat[],
    matchId: string = crypto.randomUUID(),
    epoch: string = crypto.randomUUID(),
  ) {
    this.prepare(seats);
    this.post({
      kind: "create",
      local: true,
      spec,
      seats: this.roster,
      matchId,
      epoch,
    });
  }
  restore(world: World, epoch: string = crypto.randomUUID()) {
    this.prepare(world.seats);
    this.post({ kind: "restore", local: true, world, epoch });
  }
  /** Replacing a renderer revokes its old generation before the baseline is delivered. */
  attachSeat(
    seatId: string,
    generation: number,
    send: (event: SeatEvent) => void,
  ) {
    if (
      !/^local-p[1-4]$/.test(seatId) ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      (this.roster.length > 0 &&
        !this.roster.some((seat) => seat.id === seatId))
    )
      throw new Error("Invalid local seat route");
    const previous = this.routes.get(seatId);
    if (previous && generation <= previous.generation) return false;
    this.routes.set(seatId, {
      generation,
      send,
      seen: this.now(),
      delivery: 0,
    });
    if (previous && this.state.phase === "playing")
      this.requireReady(`${seatId} reconnected`);
    this.setBlocker(`seat:${seatId}`, null);
    const view = this.views.get(seatId);
    if (view) this.publish(seatId, view);
    return true;
  }
  /** Revoke only the matching renderer generation and pause an active company for recovery.
   * Retired companies no longer impose connection or readiness requirements on the match. */
  detachSeat(
    seatId: string,
    generation: number,
    reason = "Controller or renderer disconnected",
  ) {
    const route = this.routes.get(seatId);
    if (!route || route.generation !== generation || route.failed) return;
    route.failed = true;
    route.latest = undefined;
    if (this.active(seatId)) {
      this.setBlocker(
        `seat:${seatId}`,
        `${this.name(seatId)}: ${reason}`,
        true,
      );
      this.post({ kind: "disconnect", sender: seatId });
      this.options.onSeatLost?.(seatId, generation, reason);
    }
  }
  private name(id: string) {
    return this.roster.find((seat) => seat.id === id)?.name || id;
  }
  private active(id: string) {
    return (
      this.roster.some((seat) => seat.id === id) &&
      !this.state.summary?.players.find((seat) => seat.id === id)?.retired
    );
  }
  private everyoneConnected() {
    return this.roster.every(
      (seat) =>
        !this.active(seat.id) ||
        (this.routes.has(seat.id) && !this.routes.get(seat.id)!.failed),
    );
  }
  /** Current blockers compose. Removing a menu cannot erase a disconnect/background blocker. */
  setBlocker(key: string, reason: string | null, requireReady = false) {
    const previous = this.blockers.get(key);
    if (reason === null) this.blockers.delete(key);
    else this.blockers.set(key, reason);
    if (previous === (reason ?? undefined)) return;
    this.update({ blockers: [...this.blockers.values()] });
    if (this.state.phase === "playing")
      this.post({
        kind: "blockers",
        reasons: [...this.blockers.values()],
        requireReady,
      });
  }
  /** Unlike clock pauses, global dialogs/foreground loss gate new gameplay operations. */
  setInputGate(key: string, blocked: boolean) {
    if (blocked) this.inputGates.add(key);
    else this.inputGates.delete(key);
  }
  requireReady(reason: string) {
    if (this.state.phase === "playing")
      this.post({
        kind: "blockers",
        reasons: [...this.blockers.values()],
        requireReady: true,
        readyReason: reason,
      });
    this.update({ error: undefined });
  }
  /** The shell's labelled speed buttons use the same seat queue and receipts as controllers. */
  commandForSeat(seatId: string, command: Extract<Command, { kind: "speed" }>) {
    const route = this.routes.get(seatId);
    const view = this.views.get(seatId);
    if (
      this.state.phase !== "playing" ||
      this.state.closing ||
      this.inputGates.size > 0 ||
      !route ||
      route.failed ||
      !view ||
      !this.active(seatId)
    )
      return false;
    route.send({
      kind: "shell-command",
      generation: route.generation,
      matchId: view.matchId,
      epoch: view.epoch,
      command,
    });
    return true;
  }
  /** Accept authority from the native seat route, never from renderer-supplied identity.
   * Global barriers reject new commands while allowing submitted retries to settle receipts. */
  receive(seatId: string, generation: number, input: unknown) {
    const route = this.routes.get(seatId);
    if (
      !route ||
      route.generation !== generation ||
      route.failed ||
      !isSeatMessage(input)
    )
      return false;
    route.seen = this.now();
    if (input.kind === "heartbeat") return true;
    if (input.kind === "ack") {
      if (input.delivery !== route.outstanding) return false;
      route.outstanding = undefined;
      if (route.latest) {
        const latest = route.latest;
        route.latest = undefined;
        this.publish(seatId, latest);
      }
      return true;
    }
    if (input.kind === "global-settings") {
      this.options.onSettings?.(seatId, generation, input.requestId);
      return true;
    }
    if (input.kind === "global-menu") {
      if (this.state.phase !== "playing" || this.state.closing) return false;
      this.options.onMenu?.(seatId, generation, input.requestId);
      return true;
    }
    if (input.kind === "leave") {
      this.options.onLeave?.(seatId, generation, input);
      return true;
    }
    const view = this.views.get(seatId);
    if (!view || input.matchId !== view.matchId || input.epoch !== view.epoch)
      return false;
    // A retry of already submitted work may settle its receipt across a barrier, but no new
    // company operation can enter while a global surface owns input.
    const submitted =
      input.sequence <= view.lastSequence ||
      input.sequence === route.pendingSequence;
    if (
      this.state.phase !== "playing" ||
      ((this.state.closing || this.inputGates.size > 0) && !submitted)
    ) {
      route.send({
        kind: "rejected",
        generation,
        sequence: input.sequence,
        lastSequence: view.lastSequence,
        matchId: view.matchId,
        epoch: view.epoch,
        message: this.state.closing
          ? "Save & Quit has started. This action was not saved."
          : "A global dialog or application interruption is active. This action was not applied.",
      });
      return false;
    }
    route.pendingSequence = input.sequence;
    this.post({
      kind: "command",
      sender: seatId,
      envelope: {
        matchId: input.matchId,
        epoch: input.epoch,
        sequence: input.sequence,
        command: input.command,
      },
      allowReady: this.everyoneConnected() && !this.blockers.size,
    });
    return true;
  }
  resolveLeave(
    seatId: string,
    generation: number,
    requestId: string,
    error?: string,
  ) {
    const route = this.routes.get(seatId);
    if (!route || route.generation !== generation || route.failed) return false;
    route.send({ kind: "leave-result", generation, requestId, error });
    return true;
  }
  private publish(id: string, view: RoomView) {
    const route = this.routes.get(id);
    if (!route || route.failed) return;
    // At most one posted view and one replacement. Receipt state lives in the authoritative view.
    if (route.outstanding !== undefined) {
      route.latest = view;
      return;
    }
    const delivery = ++route.delivery;
    route.outstanding = delivery;
    route.send({ kind: "view", generation: route.generation, delivery, view });
  }
  private broadcast(build: (generation: number) => SeatEvent) {
    this.routes.forEach((route) => {
      if (!route.failed) route.send(build(route.generation));
    });
  }
  /** Merge authoritative worker output before selecting a stable shared company view.
   * Whole-world checkpoints persist in order, and lifecycle checks reject late save results. */
  private response(data: WorkerResponse) {
    if (this.state.phase === "closed") return;
    this.lastWorker = this.now();
    if (data.kind === "error") return this.fault(data.message);
    if (data.kind === "keepalive") return;
    if (data.kind === "summary") {
      this.update({ summary: data.summary });
      this.options.onSummary?.(data.summary);
      // A retired company no longer contributes a controller/liveness blocker.
      data.summary.players
        .filter((seat) => seat.retired)
        .forEach((seat) => this.setBlocker(`seat:${seat.id}`, null));
      return;
    }
    if (data.kind === "views") {
      if (this.state.phase === "starting") {
        this.update({ phase: "playing" });
        this.roster.forEach((seat) => {
          if (!this.routes.has(seat.id))
            this.setBlocker(
              `seat:${seat.id}`,
              `${seat.name}: Assign a controller`,
              true,
            );
        });
        if (this.blockers.size)
          this.post({ kind: "blockers", reasons: [...this.blockers.values()] });
      }
      for (const [id, input] of Object.entries(data.views)) {
        if (!this.roster.some((seat) => seat.id === id)) continue;
        const view = {
          ...input,
          disconnected: this.roster
            .filter(
              (seat) =>
                this.active(seat.id) &&
                (!this.routes.has(seat.id) || this.routes.get(seat.id)!.failed),
            )
            .map((seat) => seat.id),
        };
        this.views.set(id, view);
        if (id === "local-p1") this.options.onAccountView?.(view);
        const route = this.routes.get(id);
        if (
          route?.pendingSequence &&
          view.lastSequence >= route.pendingSequence
        )
          route.pendingSequence = undefined;
        this.publish(id, view);
      }
      // A partial worker reply cannot change which active company's view owns
      // shared presentation. Update the stored views before selecting in roster order.
      const published = this.roster.flatMap((seat) => {
        const view = this.views.get(seat.id);
        return view?.game ? [{ seat, view }] : [];
      });
      const common =
        published.find(({ seat, view }) =>
          view.grids.some((grid) => grid.seat.id === seat.id && !grid.retired),
        ) ??
        published.find(
          ({ view }) =>
            view.grids.length > 0 && view.grids.every((grid) => grid.retired),
        );
      if (common && common.view !== this.sharedView) {
        this.sharedView = common.view;
        this.options.onSharedView?.(common.view);
      }
      return;
    }
    const generation = this.lifecycle;
    const request = data.requestId
      ? this.requests.get(data.requestId)
      : undefined;
    this.savesPending++;
    this.update({ saving: true });
    // Serialize both periodic and explicit saves; older completions cannot replace newer writes.
    this.saving = this.saving
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.lifecycle)
          throw new Error("The local session changed");
        await this.options.persist(data.world);
        if (generation !== this.lifecycle)
          throw new Error("The local session changed");
        this.update({ lastSavedAt: this.now(), error: undefined });
      });
    void this.saving.then(
      () => {
        if (data.requestId) this.requests.delete(data.requestId);
        if (request) {
          clearTimeout(request.timer);
          request.resolve();
        }
        if (generation === this.lifecycle) {
          this.savesPending--;
          this.update({ saving: this.savesPending > 0 });
        }
      },
      (error: Error) => {
        if (data.requestId) this.requests.delete(data.requestId);
        if (request) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        if (generation === this.lifecycle) {
          this.savesPending--;
          // An earlier autosave failure cannot reopen a newer explicit checkpoint barrier.
          const unlock =
            !!data.requestId && data.requestId === this.closingRequestId;
          if (unlock) this.closingRequestId = undefined;
          this.update({
            saving: this.savesPending > 0,
            ...(unlock && { closing: false }),
            error: `Local save failed: ${error.message}`,
          });
          this.options.onError?.(`Local save failed: ${error.message}`);
          if (unlock)
            this.broadcast((generation) => ({
              kind: "closing",
              generation,
              closing: false,
            }));
        }
      },
    );
  }
  /** FIFO worker messages put every already accepted command before this whole-world barrier. */
  save(pause = false): Promise<void> {
    if (this.state.phase !== "playing")
      return Promise.reject(new Error("No live local match to save"));
    if (pause && this.closingRequestId)
      return Promise.reject(new Error("Save & Quit is already in progress"));
    const requestId = `local-save-${++this.saveNumber}`;
    if (pause) {
      this.closingRequestId = requestId;
      this.update({ closing: true });
      this.broadcast((generation) => ({
        kind: "closing",
        generation,
        closing: true,
      }));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        const unlock = this.closingRequestId === requestId;
        if (unlock) this.closingRequestId = undefined;
        this.update({
          ...(unlock && { closing: false }),
          error: "The local save did not finish. Retry before quitting.",
        });
        if (unlock)
          this.broadcast((generation) => ({
            kind: "closing",
            generation,
            closing: false,
          }));
        reject(new Error("The local save did not finish"));
      }, SAVE_TIMEOUT_MS);
      this.requests.set(requestId, { resolve, reject, timer });
      this.post({ kind: "checkpoint", requestId, pause });
    });
  }
  /** Keep worker and renderer liveness independent from the simulation's paused clock.
   * A stalled worker faults the session; a stalled active seat enters recoverable pause. */
  private pump() {
    if (this.state.phase !== "playing" && this.state.phase !== "starting")
      return;
    this.post({ kind: "heartbeat" });
    const timeout =
      this.state.phase === "starting" ? 60000 : CONTROL_HEARTBEAT_TIMEOUT_MS;
    if (this.now() - this.lastWorker > timeout) {
      this.fault(
        "The shared simulation stopped responding. Resume the last complete local save.",
      );
      return;
    }
    for (const [id, route] of this.routes) {
      if (
        !route.failed &&
        this.now() - route.seen > CONTROL_HEARTBEAT_TIMEOUT_MS
      )
        this.detachSeat(
          id,
          route.generation,
          "Controller or renderer stopped responding",
        );
      else if (!route.failed)
        route.send({ kind: "pulse", generation: route.generation });
    }
  }
  dispose() {
    this.lifecycle++;
    clearInterval(this.timer);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.requests.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error("The local session ended"));
    });
    this.requests.clear();
    this.routes.clear();
    this.views.clear();
    this.sharedView = undefined;
    this.update({ phase: "closed" });
    this.listeners.clear();
  }
}
