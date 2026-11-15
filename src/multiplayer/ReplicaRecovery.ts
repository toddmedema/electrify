import {
  canonicalWorldBytes,
  ReplicatedWorld,
  worldDigest,
} from "./Replication";
import type { DigestFunction, ReplicaBaseline } from "./Replication";
import type { ReplicaProgress } from "./ReplicaProtocol";
import { worldBlockers } from "./World";

type Progress = ReplicaProgress & { sender: string };
interface Peer {
  connected: boolean;
  live: boolean;
  applied: number;
  progressedAt: number;
  baseline?: { index: number; sentAt: number };
  attempts: number[];
  minimumVerify: number;
  compared: number;
  report?: { index: number; hash: string };
  heldAt?: number;
  stopped?: string;
}
interface Options {
  flush: () => void;
  send: (to: string, baseline: ReplicaBaseline) => void;
  changed: () => void;
  error: (error: unknown) => void;
  now?: () => number;
  digest?: DigestFunction;
}

/** Host-only recovery policy. Every clock change still enters the ordinary record stream. */
export class ReplicaRecovery {
  private peers = new Map<string, Peer>();
  private captures = new Map<number, { hash?: string }>();
  private pending = 0;
  private terminal = false;
  private lastVerify = -Infinity;
  private verifiedIndex = 0;
  private shell: string[];
  private now: () => number;
  constructor(
    private host: ReplicatedWorld,
    hostSeat: string,
    private options: Options,
  ) {
    this.now = options.now || (() => performance.now());
    this.shell = worldBlockers(host.world);
    for (const seat of host.world.seats)
      if (seat.id !== hostSeat)
        this.peers.set(seat.id, {
          connected: true,
          live: false,
          applied: 0,
          progressedAt: this.now(),
          attempts: [],
          minimumVerify: 1,
          compared: 0,
        });
  }
  /** The renderer authenticates membership; disconnected replicas cannot hold the clock. */
  connected(ids: string[]) {
    if (this.terminal) return;
    for (const [id, peer] of this.peers) {
      peer.connected = ids.includes(id);
      if (!peer.connected) {
        peer.live = false;
        peer.baseline = undefined;
        peer.report = undefined;
        peer.heldAt = undefined;
      }
    }
    this.blockers();
  }
  setShellBlockers(reasons: string[]) {
    if (this.terminal) return;
    this.shell = [...reasons];
    this.blockers();
  }
  private blockers() {
    const reasons = Array.from(
      this.peers,
      ([id, peer]) =>
        peer.stopped ||
        (peer.connected &&
        peer.heldAt !== undefined &&
        !this.host.world.outcomes[id]
          ? `Waiting for ${this.name(id)} to catch up`
          : ""),
    ).filter(Boolean);
    const merged = [...this.shell, ...reasons];
    if (
      JSON.stringify(merged) === JSON.stringify(worldBlockers(this.host.world))
    )
      return;
    this.host.setBlockers(this.shell, reasons);
    this.options.changed();
  }
  private name(id: string) {
    return this.host.world.seats.find((seat) => seat.id === id)!.name;
  }
  /** A transfer is retried only after its acknowledgement window, or a new connection. */
  baseline(to: string): boolean {
    const peer = this.peers.get(to);
    if (this.terminal || !peer?.connected || peer.stopped) return false;
    const now = this.now();
    if (peer.baseline && now - peer.baseline.sentAt < 10000) return false;
    peer.attempts = peer.attempts.filter((time) => now - time < 60000);
    peer.live = false;
    peer.report = undefined;
    peer.heldAt = undefined;
    if (peer.attempts.length >= 2) {
      peer.baseline = undefined;
      peer.stopped = `${this.name(to)} could not stay in sync. Save and resume the match.`;
      this.host.pause(peer.stopped);
      this.blockers();
      this.options.changed();
      return false;
    }
    peer.attempts.push(now);
    if (!this.host.world.outcomes[to])
      this.host.pause(`Synchronizing ${this.name(to)}`);
    this.blockers();
    // The preceding stream, baseline and its verify must enter the transport in this order.
    this.options.flush();
    const baseline = this.host.baseline();
    peer.baseline = { index: baseline.index, sentAt: now };
    peer.minimumVerify = baseline.index + 1;
    this.capture();
    this.options.send(to, baseline);
    this.options.changed();
    return true;
  }
  progress(report: Progress) {
    if (this.terminal) return;
    const peer = this.peers.get(report.sender);
    if (
      !peer?.connected ||
      peer.stopped ||
      report.matchId !== this.host.world.matchId ||
      report.epoch !== this.host.world.epoch ||
      !Number.isSafeInteger(report.applied) ||
      report.applied < peer.applied ||
      report.applied > this.host.index
    )
      return;
    if (peer.baseline && report.applied < peer.baseline.index) return;
    if (report.applied > peer.applied || peer.baseline)
      peer.progressedAt = this.now();
    peer.applied = report.applied;
    peer.baseline = undefined;
    peer.live = true;
    const verified = report.verified;
    if (
      verified &&
      Number.isSafeInteger(verified.index) &&
      verified.index <= report.applied &&
      verified.index >= peer.minimumVerify &&
      verified.index > peer.compared &&
      (!peer.report || verified.index >= peer.report.index) &&
      /^[a-f0-9]{64}$/.test(verified.hash) &&
      this.captures.has(verified.index)
    ) {
      peer.report = verified;
      this.compare(report.sender, peer);
    }
    this.lag();
  }
  private compare(id: string, peer: Peer) {
    const report = peer.report;
    if (!report || !peer.connected || !peer.live || this.terminal) return;
    const hash = this.captures.get(report.index)?.hash;
    if (!hash) return;
    peer.compared = report.index;
    peer.report = undefined;
    if (hash !== report.hash) this.baseline(id);
  }
  /** Called synchronously at the verify boundary, before any further world mutation. */
  private capture() {
    this.lastVerify = this.now();
    this.verifiedIndex = this.host.index;
    if (this.pending >= 2 || this.terminal) return;
    const index = this.host.index;
    const bytes = canonicalWorldBytes(this.host.world);
    const capture: { hash?: string } = {};
    this.captures.set(index, capture);
    // Insertion order is record order, even when digest promises complete out of order.
    if (this.captures.size > 16)
      this.captures.delete(this.captures.keys().next().value!);
    this.pending++;
    void worldDigest(bytes, this.options.digest).then(
      (hash) => {
        this.pending--;
        if (this.terminal || !this.captures.has(index)) return;
        capture.hash = hash;
        for (const [id, peer] of this.peers) this.compare(id, peer);
      },
      (error) => {
        this.pending--;
        if (!this.terminal) this.options.error(error);
      },
    );
  }
  private lag() {
    const now = this.now();
    for (const [id, peer] of this.peers) {
      if (
        !peer.connected ||
        !peer.live ||
        peer.stopped ||
        this.host.world.outcomes[id]
      ) {
        peer.heldAt = undefined;
        continue;
      }
      const lag =
        peer.applied >= this.host.index
          ? 0
          : now - (this.host.appendedAt(peer.applied + 1) ?? -Infinity);
      if (peer.heldAt === undefined && lag > 2000) peer.heldAt = now;
      else if (peer.heldAt !== undefined && lag < 500) peer.heldAt = undefined;
      if (
        peer.heldAt !== undefined &&
        now - Math.max(peer.heldAt, peer.progressedAt) >= 10000
      )
        this.baseline(id);
    }
    this.blockers();
  }
  /** A paused, fully applied world produces neither periodic verifies nor recovery traffic. */
  pulse() {
    if (this.terminal) return;
    const now = this.now();
    for (const [id, peer] of this.peers)
      if (peer.baseline && now - peer.baseline.sentAt >= 10000)
        this.baseline(id);
    this.lag();
    if (this.host.index > this.verifiedIndex && now - this.lastVerify >= 1000) {
      this.host.verify();
      this.capture();
      this.options.changed();
    }
  }
  stop() {
    this.terminal = true;
    this.captures.clear();
    for (const peer of this.peers.values()) peer.report = undefined;
  }
}
