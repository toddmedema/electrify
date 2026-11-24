import { PeerDisconnectedError, type WireMessage } from "./SessionTransport";
import { relayDescription, selectedRelayPair } from "./TurnDescription";
import {
  TurnFrameReader,
  turnFrames,
  validTurnPayload,
  validTurnTransfer,
  type TransferKind,
  type TurnTransfer,
} from "./TurnWire";

const AUTHORITY_MS = 4_000;
const STATS_MS = 1_000;
const PROOF_STALE_MS = 10_000;
const RENEGOTIATE_REMAINING_MS = 20_000;
const SIGNAL_POLL_MS = 1_000;
const SIGNAL_IDLE_MS = 2_000;
const NEGOTIATION_MS = 30_000;
const GATHER_MS = 9_000;
const RENEW_MS = 35_000;
const HANDOFF_WAITERS = 128;
const MAX_BUFFERED_BYTES = 128 * 1024;
const MAX_PENDING_BYTES = 384 * 1024;
const TURN_URLS = [
  "turn:turn.cloudflare.com:3478",
  "turns:turn.cloudflare.com:443",
];
const CHANNEL = "electrify-coop-v2";
const CONFIRMED = 11;
const DRAIN = 12;
const DRAINED = 13;

export interface TurnAuthority {
  roomId: string;
  selfId: string;
  hostId: string;
  epoch: string;
  binding: string;
  leaseRemainingMs: number;
}

export interface TurnPeer {
  roomId: string;
  to: string;
  generation: string;
  epoch: string;
}

interface TurnApi {
  request<T>(
    operation: string,
    body: unknown,
    options?: { signal: AbortSignal },
  ): Promise<T>;
}

type TransferPayload = Extract<WireMessage, { kind: TransferKind }>;

interface Options {
  message(from: string, payload: WireMessage, peer: TurnPeer): void;
  status(connectedIds: string[]): void;
  storeTransfer(
    peer: TurnPeer,
    payload: TransferPayload,
    signal: AbortSignal,
  ): Promise<string>;
  readTransfer(
    peer: TurnPeer,
    reference: string,
    signal: AbortSignal,
  ): Promise<WireMessage>;
}

interface Generation {
  generation: string;
  remainingMs: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

interface Signal extends Generation {
  peerId: string;
  successor?: Generation;
}

interface Leg {
  generation: string;
  peer?: Peer;
  retired?: boolean;
  requestAt?: number;
}

interface Handoff {
  receivedDrain?: boolean;
  sentDrained?: boolean;
  receivedDrained?: boolean;
  acknowledgement?: Promise<boolean>;
  release?: (delivered: boolean) => void;
  waiters: number;
  reported?: boolean;
}

interface Link {
  to: string;
  current: Leg;
  successor?: Leg;
  handoff?: Handoff;
}

interface CredentialReply {
  iceServers: RTCIceServer[];
  remainingMs: number;
}

interface Peer {
  address: TurnPeer;
  leg: Leg;
  link: Link;
  abort: AbortController;
  createdAt: number;
  localIsHost: boolean;
  reader: TurnFrameReader;
  expiresAt: number;
  confirmedUntil: number;
  candidateCheck: number;
  proofAt: number;
  checking: boolean;
  localVerified: boolean;
  remoteVerified: boolean;
  sawLocal: boolean;
  sawRemote: boolean;
  local?: RTCSessionDescriptionInit;
  remote?: RTCSessionDescriptionInit;
  channel?: RTCDataChannel;
  pc?: RTCPeerConnection;
  installingAnswer?: boolean;
  outgoingTransfer?: boolean;
  readingTransfer?: boolean;
  pending: { message: WireMessage | TurnTransfer; bytes: number }[];
  pendingBytes: number;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new PeerDisconnectedError("Connection replaced"));
      return;
    }
    const cancel = () => {
      window.clearTimeout(timer);
      reject(new PeerDisconnectedError("Connection replaced"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function validIce(value: CredentialReply) {
  const [server] = value?.iceServers ?? [];
  return (
    value?.iceServers.length === 1 &&
    Array.isArray(server.urls) &&
    server.urls.length === TURN_URLS.length &&
    TURN_URLS.every((url) => server.urls.includes(url)) &&
    typeof server.username === "string" &&
    server.username.length > 0 &&
    server.username.length <= 256 &&
    typeof server.credential === "string" &&
    server.credential.length > 0 &&
    server.credential.length <= 256 &&
    Number.isFinite(value.remainingMs)
  );
}

function identity(value: TurnAuthority) {
  return JSON.stringify([
    value.roomId,
    value.selfId,
    value.hostId,
    value.epoch,
    value.binding,
  ]);
}

/** The authority poll is independent of WebRTC liveness. Either fence can retire a channel. */
export class TurnPeers {
  private authority?: TurnAuthority;
  private until = 0;
  private wallUntil = 0;
  private identity?: string;
  private connected: string[] = [];
  private links = new Map<string, Link>();
  private poll?: AbortController;
  private nextReadAt = 0;
  private timer?: number;

  constructor(
    private api: TurnApi,
    private options: Options,
  ) {}

  update(authority: TurnAuthority, requestedAt: number): void {
    const nextIdentity = identity(authority);
    if (this.identity !== nextIdentity) {
      this.close();
      this.identity = nextIdentity;
    }
    const now = performance.now();
    this.authority = authority;
    const leaseMs = Math.min(12_000, Math.max(0, authority.leaseRemainingMs));
    this.until = Math.min(now, requestedAt) + leaseMs;
    this.wallUntil = Date.now() + (this.until - now);
    if (!this.current()) {
      this.close();
      return;
    }
    this.timer ??= window.setInterval(() => this.tick(), 250);
    this.tick();
  }

  private current() {
    return (
      !!this.authority &&
      performance.now() < this.until &&
      Date.now() < this.wallUntil
    );
  }

  private usable(peer: Peer) {
    const now = performance.now();
    return (
      this.current() &&
      peer.leg.peer === peer &&
      now < peer.expiresAt &&
      now < peer.confirmedUntil
    );
  }

  private ready(peer: Peer): peer is Peer & { channel: RTCDataChannel } {
    return (
      this.usable(peer) &&
      peer.localVerified &&
      peer.remoteVerified &&
      performance.now() - peer.proofAt <= 2 * STATS_MS &&
      peer.pc?.connectionState === "connected" &&
      peer.channel?.readyState === "open"
    );
  }

  private publish() {
    const ids = Array.from(this.links.values())
      .filter((link) => {
        const peer = (
          this.handoffComplete(link) || link.handoff?.sentDrained
            ? (link.successor ?? link.current)
            : link.current
        )?.peer;
        return peer && this.ready(peer);
      })
      .map((link) => link.to)
      .sort();
    if (
      ids.length === this.connected.length &&
      ids.every((id, index) => id === this.connected[index])
    )
      return;
    this.connected = ids;
    this.options.status(ids);
  }

  private closeLeg(leg: Leg | undefined) {
    if (!leg) return;
    const peer = leg.peer;
    leg.peer = undefined;
    leg.retired = true;
    if (!peer) return;
    peer.abort.abort();
    peer.pending = [];
    peer.pendingBytes = 0;
    peer.channel?.close();
    peer.pc?.close();
  }

  private closeLink(link: Link) {
    link.handoff?.release?.(false);
    link.handoff = undefined;
    this.closeLeg(link.current);
    this.closeLeg(link.successor);
  }

  /** Local drain is on the successor; keep that channel until the remote drain arrives. */
  private holdingSuccessor(link: Link) {
    return !!(link.handoff?.sentDrained && !this.handoffComplete(link));
  }

  private handoffComplete(link: Link) {
    return !!(link.handoff?.receivedDrained && link.handoff.sentDrained);
  }

  private retire(peer: Peer) {
    const { link, leg } = peer;
    if (leg.peer !== peer) return;
    const handoffStarted =
      link.handoff?.acknowledgement || link.handoff?.receivedDrain;
    if (leg === link.current && this.holdingSuccessor(link)) {
      // The predecessor credential is the server's bound. Closing here would
      // drop the successor in the same turn the room promotes it.
      this.closeLeg(leg);
    } else if (
      (leg === link.successor && !handoffStarted) ||
      (leg === link.current && this.handoffComplete(link))
    ) {
      this.closeLeg(leg);
    } else {
      this.closeLink(link);
    }
    this.publish();
  }

  close(): void {
    this.authority = undefined;
    this.poll?.abort();
    this.poll = undefined;
    this.nextReadAt = 0;
    window.clearInterval(this.timer);
    this.timer = undefined;
    for (const link of this.links.values()) this.closeLink(link);
    this.links.clear();
    this.publish();
  }

  private tick() {
    if (!this.current()) {
      this.close();
      return;
    }
    const now = performance.now();
    for (const link of this.links.values()) {
      for (const leg of [link.current, link.successor]) {
        const peer = leg?.peer;
        if (!peer) continue;
        if (
          !this.usable(peer) ||
          (peer.localVerified && now - peer.proofAt > PROOF_STALE_MS) ||
          (now - peer.createdAt > NEGOTIATION_MS && !this.ready(peer))
        ) {
          this.retire(peer);
        } else if (now - peer.candidateCheck > STATS_MS) {
          this.verify(peer);
        }
      }
    }
    if (!this.poll && now >= this.nextReadAt) void this.readSignals(now);
  }

  private async readSignals(startedAt: number) {
    const authority = this.authority;
    if (!authority) return;
    const poll = new AbortController();
    this.poll = poll;
    this.nextReadAt = startedAt + SIGNAL_POLL_MS;
    try {
      const { pairs } = await this.api.request<{ pairs: Signal[] }>(
        "signal/read",
        { roomId: authority.roomId },
        { signal: poll.signal },
      );
      if (
        this.poll !== poll ||
        !this.current() ||
        performance.now() - startedAt >= AUTHORITY_MS
      )
        return;
      const confirmed = new Set(pairs.map((pair) => pair.peerId));
      for (const [id, link] of this.links) {
        if (!confirmed.has(id)) {
          this.closeLink(link);
          this.links.delete(id);
        }
      }
      this.publish();
      for (const signal of pairs) this.useSignal(authority, signal, startedAt);
      if (
        pairs.every(({ peerId }) => {
          const link = this.links.get(peerId);
          return (
            this.connected.includes(peerId) &&
            (!link?.successor || this.handoffComplete(link))
          );
        })
      )
        this.nextReadAt = startedAt + SIGNAL_IDLE_MS;
    } catch {
      // The previous signal confirmation expires independently of the room lease.
    } finally {
      if (this.poll === poll) this.poll = undefined;
    }
  }

  private signalAction(
    action: "prepare" | "reset" | "renegotiate",
    authority: TurnAuthority,
    link: Link,
    leg: Leg,
  ) {
    const now = performance.now();
    if (now < (leg.requestAt ?? 0)) return;
    leg.requestAt = now + 5_000;
    void this.api
      .request(`signal/${action}`, {
        roomId: authority.roomId,
        to: link.to,
        generation: leg.generation,
      })
      .catch(() => undefined);
  }

  private useSignal(
    authority: TurnAuthority,
    signal: Signal,
    startedAt: number,
  ) {
    const { peerId, generation, successor } = signal;
    if (
      peerId === authority.selfId ||
      (authority.selfId !== authority.hostId && peerId !== authority.hostId) ||
      !Number.isFinite(signal.remainingMs) ||
      signal.remainingMs < 0
    )
      return;

    let link = this.links.get(peerId);
    if (link && link.current.generation !== generation) {
      const promoted = link.successor;
      if (promoted?.generation === generation) {
        this.closeLeg(link.current);
        link.current = promoted;
        link.successor = undefined;
        if (!this.handoffComplete(link) && link.handoff) {
          // The server has retired the predecessor. Keep the successor open.
          link.handoff.sentDrained = true;
          link.handoff.receivedDrained = true;
          link.handoff.release?.(true);
        }
        link.handoff = undefined;
      } else {
        this.closeLink(link);
        this.publish();
        link = undefined;
      }
    }
    if (!link) {
      link = { to: peerId, current: { generation } };
      this.links.set(peerId, link);
    }
    if (link.successor && link.successor.generation !== successor?.generation) {
      // The far end can reset a staged leg independently. Once either barrier
      // has crossed, using the old stream again could skip or duplicate data.
      if (link.handoff?.acknowledgement || link.handoff?.receivedDrain) {
        this.closeLink(link);
        this.publish();
      } else {
        this.closeLeg(link.successor);
      }
      link.successor = undefined;
    }
    if (!link.successor && successor) {
      link.successor = { generation: successor.generation };
      link.handoff = { waiters: 0 };
    }

    const holdingSuccessor = this.holdingSuccessor(link);
    if (link.current.peer || (!this.handoffComplete(link) && !holdingSuccessor))
      this.useGeneration(authority, link, link.current, signal, startedAt);
    if (
      successor &&
      link.successor &&
      (!link.current.retired || this.handoffComplete(link) || holdingSuccessor)
    )
      this.useGeneration(authority, link, link.successor, successor, startedAt);

    const peer = link.current.peer;
    if (
      !link.successor &&
      peer &&
      peer.localIsHost &&
      this.ready(peer) &&
      signal.remainingMs <= RENEW_MS
    )
      this.signalAction("prepare", authority, link, link.current);
  }

  private useGeneration(
    authority: TurnAuthority,
    link: Link,
    leg: Leg,
    signal: Generation,
    startedAt: number,
  ) {
    if (!Number.isFinite(signal.remainingMs) || signal.remainingMs < 0) return;
    const localIsHost = authority.selfId === authority.hostId;
    const peer = leg.peer;
    const signalLocal = localIsHost ? signal.offer : signal.answer;
    const signalRemote = localIsHost ? signal.answer : signal.offer;
    if (peer) {
      peer.confirmedUntil = startedAt + AUTHORITY_MS;
      peer.expiresAt = Math.min(peer.expiresAt, startedAt + signal.remainingMs);
      if (signalLocal) peer.sawLocal = true;
      if (signalRemote) peer.sawRemote = true;
      if (
        (peer.sawLocal && !signalLocal) ||
        (peer.sawRemote && !signalRemote)
      ) {
        this.retire(peer);
        return;
      }
      if (localIsHost && signal.answer) this.acceptAnswer(peer, signal.answer);
      return;
    }
    if (signalLocal) {
      // The local peer connection is gone. Reuse this generation's credential
      // while it still has time; the rotation cooldown stays on signal/reset.
      this.signalAction(
        signal.remainingMs > RENEGOTIATE_REMAINING_MS ? "renegotiate" : "reset",
        authority,
        link,
        leg,
      );
      return;
    }
    if (leg.retired) leg.retired = false;
    if (!localIsHost && !signal.offer) return;
    const candidate: Peer = {
      address: {
        roomId: authority.roomId,
        to: link.to,
        generation: leg.generation,
        epoch: authority.epoch,
      },
      leg,
      link,
      abort: new AbortController(),
      createdAt: performance.now(),
      localIsHost,
      reader: new TurnFrameReader(),
      expiresAt: startedAt + signal.remainingMs,
      confirmedUntil: startedAt + AUTHORITY_MS,
      candidateCheck: -Infinity,
      proofAt: -Infinity,
      checking: false,
      localVerified: false,
      remoteVerified: false,
      sawLocal: false,
      sawRemote: false,
      pending: [],
      pendingBytes: 0,
    };
    leg.peer = candidate;
    void this.open(candidate, signal).catch(() => this.retire(candidate));
  }

  private async open(peer: Peer, signal: Generation) {
    const startedAt = performance.now();
    const { address } = peer;
    const credential = await this.api.request<CredentialReply>(
      "signal/turn",
      {
        roomId: address.roomId,
        to: address.to,
        generation: address.generation,
      },
      { signal: peer.abort.signal },
    );
    if (!this.usable(peer) || !validIce(credential))
      throw new PeerDisconnectedError("Relay credentials became unavailable");
    peer.expiresAt = Math.min(
      peer.expiresAt,
      startedAt + credential.remainingMs,
    );
    const pc = new RTCPeerConnection({
      iceServers: credential.iceServers,
      iceTransportPolicy: "relay",
    });
    peer.pc = pc;
    const channel = pc.createDataChannel(CHANNEL, {
      id: 0,
      negotiated: true,
      ordered: true,
    });
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    pc.ondatachannel = () => this.retire(peer);
    pc.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        this.retire(peer);
      } else {
        this.verify(peer);
      }
    };
    pc.oniceconnectionstatechange = () => this.verify(peer);
    channel.onopen = () => this.verify(peer);
    channel.onmessage = ({ data }) => this.receive(peer, data);
    channel.onclose = () => this.retire(peer);
    channel.onerror = () => this.retire(peer);

    let description: RTCSessionDescriptionInit;
    if (peer.localIsHost) {
      description = await pc.createOffer();
    } else {
      peer.remote = signal.offer;
      await pc.setRemoteDescription(signal.offer!);
      description = await pc.createAnswer();
    }
    await pc.setLocalDescription(description);
    const gatherUntil = performance.now() + GATHER_MS;
    while (
      this.usable(peer) &&
      pc.iceGatheringState !== "complete" &&
      performance.now() < gatherUntil
    ) {
      await wait(100, peer.abort.signal);
    }
    if (!this.usable(peer) || !pc.localDescription)
      throw new PeerDisconnectedError("Relay connection was interrupted");
    peer.local = relayDescription(pc.localDescription);
    await this.api.request(
      "signal/describe",
      {
        roomId: address.roomId,
        to: address.to,
        generation: address.generation,
        description: peer.local,
      },
      { signal: peer.abort.signal },
    );
    this.verify(peer);
  }

  private acceptAnswer(peer: Peer, answer: RTCSessionDescriptionInit) {
    if (!peer.local || !peer.pc || peer.remote || peer.installingAnswer) return;
    peer.installingAnswer = true;
    void peer.pc
      .setRemoteDescription(answer)
      .then(() => {
        if (!this.usable(peer)) return;
        peer.remote = answer;
        this.verify(peer);
      })
      .catch(() => this.retire(peer));
  }

  private verify(peer: Peer) {
    const { pc, channel } = peer;
    if (
      !this.usable(peer) ||
      !pc ||
      !channel ||
      !peer.local ||
      !peer.remote ||
      channel.readyState !== "open" ||
      pc.connectionState !== "connected" ||
      peer.checking
    )
      return;
    peer.checking = true;
    peer.candidateCheck = performance.now();
    void selectedRelayPair(pc, peer.local, peer.remote)
      .then((valid) => {
        if (!this.usable(peer)) return;
        if (!valid) {
          this.retire(peer);
          return;
        }
        peer.proofAt = performance.now();
        if (!peer.localVerified) {
          channel.send(new Uint8Array([CONFIRMED]));
          peer.localVerified = true;
        }
        this.advanceHandoff(peer.link);
        this.publish();
      })
      .catch(() => this.retire(peer))
      .finally(() => {
        peer.checking = false;
      });
  }

  private reportDrained(link: Link) {
    const handoff = link.handoff;
    const authority = this.authority;
    if (
      !handoff ||
      !authority ||
      handoff.reported ||
      !this.handoffComplete(link)
    )
      return;
    handoff.reported = true;
    void this.api
      .request("signal/drained", {
        roomId: authority.roomId,
        to: link.to,
        generation: link.current.generation,
      })
      .catch(() => undefined);
  }

  private advanceHandoff(link: Link) {
    const { handoff } = link;
    const current = link.current.peer;
    const successor = link.successor?.peer;
    if (
      !handoff ||
      !current ||
      !this.ready(current) ||
      !successor ||
      !this.ready(successor)
    )
      return;

    if (!handoff.acknowledgement && !current.outgoingTransfer) {
      handoff.acknowledgement = new Promise((resolve) => {
        handoff.release = resolve;
      });
      try {
        current.channel.send(new Uint8Array([DRAIN]));
      } catch {
        this.retire(current);
        return;
      }
    }
    if (
      handoff.receivedDrain &&
      !handoff.sentDrained &&
      !current.readingTransfer &&
      !current.pending.length
    ) {
      handoff.sentDrained = true;
      try {
        successor.channel.send(new Uint8Array([DRAINED]));
      } catch {
        this.retire(successor);
      }
      this.reportDrained(link);
    }
  }

  private receive(peer: Peer, frame: unknown) {
    if (!this.usable(peer)) return;
    const control =
      frame instanceof ArrayBuffer && frame.byteLength === 1
        ? new Uint8Array(frame)[0]
        : undefined;
    if (control === CONFIRMED && !peer.remoteVerified) {
      peer.remoteVerified = true;
      this.advanceHandoff(peer.link);
      this.publish();
      return;
    }
    if (!this.ready(peer)) {
      this.retire(peer);
      return;
    }
    const { link, leg } = peer;
    const { handoff } = link;
    const staged = leg === link.successor;
    if (
      control === DRAIN &&
      !staged &&
      link.successor?.peer &&
      handoff &&
      !handoff.receivedDrain
    ) {
      handoff.receivedDrain = true;
      this.advanceHandoff(link);
      return;
    }
    if (
      control === DRAINED &&
      handoff?.acknowledgement &&
      !handoff.receivedDrained &&
      (staged || (handoff.sentDrained && leg === link.current))
    ) {
      handoff.receivedDrained = true;
      handoff.release?.(true);
      this.reportDrained(link);
      this.publish();
      return;
    }
    // New-channel gameplay can arrive only after this side acknowledged that
    // the old ordered stream, including asynchronous downloads, has drained.
    if (
      (staged && !handoff?.sentDrained) ||
      (!staged && handoff?.receivedDrain)
    ) {
      this.retire(peer);
      return;
    }
    try {
      const packet = peer.reader.read(
        frame,
        performance.now(),
        peer.address.generation,
        peer.address.epoch,
        !peer.localIsHost,
      );
      if (!packet) return;
      const { message, bytes } = packet;
      if (
        peer.readingTransfer &&
        !["heartbeat", "keepalive", "save-result"].includes(message.kind)
      ) {
        // A transfer holds the ordered state stream, but critical connection and save
        // control can still pass while a baseline downloads.
        peer.pendingBytes += bytes;
        if (
          peer.pendingBytes > MAX_PENDING_BYTES ||
          peer.pending.length >= 128
        ) {
          this.retire(peer);
          return;
        }
        peer.pending.push(packet);
      } else {
        this.deliver(peer, message);
      }
    } catch {
      this.retire(peer);
    }
  }

  private deliver(peer: Peer, message: WireMessage | TurnTransfer) {
    if (!this.ready(peer)) return;
    if (message.kind !== "transfer") {
      this.options.message(peer.address.to, message, peer.address);
      return;
    }
    peer.readingTransfer = true;
    void this.options
      .readTransfer(peer.address, message.reference, peer.abort.signal)
      .then((payload) => {
        if (!this.ready(peer)) return this.retire(peer);
        if (!validTurnTransfer(payload, message.type, peer.address.epoch)) {
          this.retire(peer);
          return;
        }
        this.options.message(peer.address.to, payload, peer.address);
        peer.readingTransfer = false;
        while (
          this.ready(peer) &&
          !peer.readingTransfer &&
          peer.pending.length
        ) {
          const next = peer.pending.shift()!;
          peer.pendingBytes -= next.bytes;
          this.deliver(peer, next.message);
        }
        this.advanceHandoff(peer.link);
      })
      .catch(() => this.retire(peer));
  }

  async send(to: string, message: WireMessage): Promise<void> {
    const link = this.links.get(to);
    if (!link) throw new PeerDisconnectedError("Connection is unavailable");
    const handoff = link.handoff;
    let peer = link.current.peer;
    if (handoff?.acknowledgement) {
      if (!handoff.receivedDrained) {
        if (handoff.waiters >= HANDOFF_WAITERS) {
          this.closeLink(link);
          this.publish();
          throw new PeerDisconnectedError("Multiplayer handoff is overloaded");
        }
        handoff.waiters++;
        try {
          if (!(await handoff.acknowledgement))
            throw new PeerDisconnectedError("Connection was replaced");
        } finally {
          handoff.waiters--;
        }
      }
      peer = link.successor?.peer ?? link.current.peer;
    }
    if (!peer || !this.ready(peer))
      throw new PeerDisconnectedError("Connection is unavailable");
    try {
      await this.sendToPeer(peer, message);
    } finally {
      if (message.kind === "baseline" || message.kind === "scenario")
        this.advanceHandoff(link);
    }
  }

  private async sendToPeer(
    peer: Peer & { channel: RTCDataChannel },
    message: WireMessage,
  ) {
    let outgoing: WireMessage | TurnTransfer = message;
    if (message.kind === "baseline" || message.kind === "scenario") {
      if (
        !peer.localIsHost ||
        !validTurnTransfer(message, message.kind, peer.address.epoch) ||
        peer.outgoingTransfer
      ) {
        throw new Error("Invalid multiplayer transfer");
      }
      peer.outgoingTransfer = true;
      try {
        const reference = await this.options.storeTransfer(
          peer.address,
          message,
          peer.abort.signal,
        );
        outgoing = { kind: "transfer", type: message.kind, reference };
      } finally {
        peer.outgoingTransfer = false;
      }
    }
    if (!this.ready(peer))
      throw new PeerDisconnectedError("Connection was replaced");
    if (!validTurnPayload(outgoing, peer.localIsHost, peer.address.epoch))
      throw new Error("Invalid multiplayer message");
    const frames = turnFrames({
      epoch: peer.address.epoch,
      generation: peer.address.generation,
      message: outgoing,
    });
    if (
      peer.channel.bufferedAmount +
        frames.reduce((total, frame) => total + frame.byteLength, 0) >
      MAX_BUFFERED_BYTES
    ) {
      this.retire(peer);
      throw new PeerDisconnectedError("Multiplayer connection is overloaded");
    }
    try {
      for (const frame of frames) peer.channel.send(frame);
    } catch {
      this.retire(peer);
      throw new PeerDisconnectedError("Multiplayer send failed");
    }
  }
}
