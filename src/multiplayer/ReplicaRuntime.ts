import type { ScenarioType } from "../Types";
import type { MatchSpec } from "./Types";
import {
  canonicalWorldBytes,
  Replica,
  ReplicaMismatch,
  worldDigest,
  type DigestFunction,
  type ReplicaBaseline,
} from "./Replication";
import type { ReplicaRequest, ReplicaResponse } from "./ReplicaProtocol";
import { savedMatchSpec } from "./World";
import { ViewPublication } from "./ViewPublication";

const MAX_BUFFERED_RECORDS = 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

interface VerifyBoundary {
  index: number;
  bytes: ReturnType<typeof canonicalWorldBytes>;
  generation: number;
}

/** Serial worker-owned replay, independent of transport and shell command state. */
export class ReplicaRuntime {
  private replica = new Replica();
  private state: "waiting" | "live" | "stopped" = "waiting";
  private matchId = "";
  private epoch = "";
  private seat = "";
  private queue = Promise.resolve();
  private installing = false;
  private generation = 0;
  private bufferedRecords = 0;
  private bufferedBytes = 0;
  private earlyRecords = 0;
  private earlyBytes = 0;
  private pendingDigests = 0;
  private skippedBoundary?: VerifyBoundary;
  private verified?: { index: number; hash: string };
  private lastResync = -Infinity;
  private publication = new ViewPublication();
  private viewPending = false;
  private viewTimer?: ReturnType<typeof setTimeout>;
  private viewDue = Infinity;
  constructor(
    private post: (response: ReplicaResponse) => void,
    private loadData: (spec: MatchSpec) => Promise<void>,
    private now = () => performance.now(),
    private digest?: DigestFunction,
  ) {}

  /** Messages received during asynchronous data loading remain bounded before entering the queue. */
  receive(request: ReplicaRequest): Promise<void> {
    if (request.kind === "records" && this.state === "stopped")
      return Promise.resolve();
    let records = 0,
      bytes = 0;
    if (request.kind === "baseline") {
      this.installing = true;
      this.state = "waiting";
      this.generation++;
      this.skippedBoundary = undefined;
      this.earlyRecords = this.earlyBytes = 0;
    }
    if (request.kind === "records" && this.state !== "live") {
      records = Array.isArray(request.records) ? request.records.length : 0;
      bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      if (
        this.bufferedRecords + this.earlyRecords + records >
          MAX_BUFFERED_RECORDS ||
        this.bufferedBytes + this.earlyBytes + bytes > MAX_BUFFERED_BYTES
      ) {
        this.fail("Replica loading buffer overflow", request);
        return Promise.resolve();
      }
      if (!this.installing) {
        this.earlyRecords += records;
        this.earlyBytes += bytes;
        return Promise.resolve();
      }
      this.bufferedRecords += records;
      this.bufferedBytes += bytes;
    }
    const generation = this.generation;
    const pending = this.queue.then(async () => {
      this.bufferedRecords -= records;
      this.bufferedBytes -= bytes;
      if (generation !== this.generation && request.kind !== "views-applied")
        return;
      try {
        if (request.kind === "baseline")
          await this.install(request, generation);
        else if (request.kind === "views-applied") {
          if (!this.viewPending) return;
          this.viewPending = false;
          this.publication.consumed(this.now());
          this.requestViews();
        } else if (this.state === "live") this.apply(request);
      } catch (error) {
        if (generation !== this.generation) return;
        this.fail(
          error instanceof Error ? error.message : "Replica failed",
          request,
        );
      }
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private checkScenario(baseline: ReplicaBaseline, pinned?: ScenarioType) {
    const selected = baseline.world.spec.customScenario;
    if (!selected?.mod && !pinned?.mod) return;
    const parameters = pinned?.mod?.parameters;
    if (
      !pinned?.mod ||
      !selected?.mod ||
      selected.mod.runtimeDigest !== pinned.mod.runtimeDigest ||
      baseline.world.spec.scenarioId !== 999 ||
      baseline.world.grids.some(
        (game) =>
          game.scenarioId !== 999 ||
          game.customScenario?.mod?.runtimeDigest !==
            pinned.mod!.runtimeDigest ||
          game.seed !== parameters!.seed ||
          game.difficulty !== parameters!.difficulty ||
          game.startingYear !== parameters!.startingYear,
      )
    )
      throw new ReplicaMismatch(
        "The host's game does not match the validated scenario.",
      );
  }

  private async install(
    request: Extract<ReplicaRequest, { kind: "baseline" }>,
    generation: number,
  ) {
    const { baseline } = request;
    this.state = "waiting";
    this.matchId = baseline.matchId;
    this.epoch = baseline.epoch;
    this.report();
    this.checkScenario(baseline, request.scenario);
    const spec = savedMatchSpec(baseline.world);
    await this.loadData(spec);
    if (generation !== this.generation) return;
    this.replica.install(baseline);
    if (!this.replica.world.seats.some((seat) => seat.id === request.seat))
      throw new ReplicaMismatch("This player has no company in the baseline");
    this.seat = request.seat;
    this.verified = undefined;
    this.installing = false;
    this.state = "live";
    this.publication = new ViewPublication();
    this.report();
    this.requestViews({ force: true });
  }

  private apply(request: Extract<ReplicaRequest, { kind: "records" }>) {
    if (!Array.isArray(request.records) || !request.records.length)
      throw new ReplicaMismatch("Invalid replica records");
    if (request.matchId !== this.matchId || request.epoch !== this.epoch)
      throw new ReplicaMismatch("Records belong to another session");
    let index = request.from;
    // Capture bytes at the verify boundary before later records mutate the world.
    for (const record of request.records) {
      this.replica.apply(index++, [record]);
      if (record.t === "verify") this.capture();
      if (record.t === "fault") {
        this.state = "stopped";
        this.skippedBoundary = undefined;
        this.report(record.message);
        break;
      }
    }
    this.requestViews({
      urgent: request.records.some(
        (record) => record.t !== "step" && record.t !== "verify",
      ),
    });
    if (this.state === "live") this.report();
  }

  private capture() {
    const boundary = {
      bytes: canonicalWorldBytes(this.replica.world),
      index: this.replica.applied,
      generation: this.generation,
    };
    if (this.pendingDigests >= 2) {
      this.skippedBoundary = boundary;
      return;
    }
    this.hashBoundary(boundary);
  }

  private hashBoundary({ index, bytes, generation }: VerifyBoundary) {
    this.pendingDigests++;
    void worldDigest(bytes, this.digest)
      .then(
        (hash) => {
          if (generation !== this.generation || this.state !== "live") return;
          if (!this.verified || index > this.verified.index) {
            this.verified = { index, hash };
            this.report();
          }
        },
        (error) => {
          if (generation === this.generation && this.state === "live")
            this.fail(
              error instanceof Error ? error.message : "Replica hash failed",
            );
        },
      )
      .finally(() => {
        this.pendingDigests--;
        const skipped = this.skippedBoundary;
        if (!skipped || this.pendingDigests >= 2) return;
        this.skippedBoundary = undefined;
        if (skipped.generation === this.generation && this.state === "live")
          this.hashBoundary(skipped);
      });
  }

  private requestViews(options?: Parameters<ViewPublication["request"]>[2]) {
    if (this.state !== "live" && this.state !== "stopped") return;
    const now = this.now();
    const delay = this.publication.request(this.replica.world, now, options);
    if (this.viewPending || delay === undefined) return;
    if (delay === 0) return this.publish();
    if (this.viewDue <= now + delay) return;
    clearTimeout(this.viewTimer);
    this.viewDue = now + delay;
    this.viewTimer = setTimeout(() => this.publish(), Math.ceil(delay));
  }

  private publish() {
    clearTimeout(this.viewTimer);
    this.viewTimer = undefined;
    this.viewDue = Infinity;
    if (this.state === "waiting") return;
    const views = this.publication.take(this.replica.world, this.now(), [
      this.seat,
    ]);
    if (!Object.keys(views).length) return;
    this.viewPending = true;
    this.post({ kind: "views", views });
  }

  private report(error?: string) {
    this.post({
      kind: "progress",
      matchId: this.matchId,
      epoch: this.epoch,
      applied: this.replica.applied,
      verified: this.verified,
      state: this.state,
      ...(error ? { error } : {}),
    });
  }
  private fail(reason: string, request?: ReplicaRequest) {
    this.state = "waiting";
    this.installing = false;
    this.generation++;
    this.skippedBoundary = undefined;
    clearTimeout(this.viewTimer);
    if (request?.kind === "records" && !this.matchId) {
      this.matchId = request.matchId;
      this.epoch = request.epoch;
    }
    this.report();
    const now = this.now();
    if (now - this.lastResync < 2000) return;
    this.lastResync = now;
    this.post({
      kind: "resync",
      matchId: this.matchId,
      epoch: this.epoch,
      applied: this.replica.applied,
      reason,
    });
  }
}
