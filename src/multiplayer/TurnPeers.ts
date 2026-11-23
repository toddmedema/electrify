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
const SIGNAL_POLL_MS = 1_000;
const SIGNAL_IDLE_MS = 2_000;
const NEGOTIATION_MS = 30_000;
const GATHER_MS = 9_000;
const RENEW_MS = 20_000;
const MAX_BUFFERED_BYTES = 128 * 1024;
const MAX_PENDING_BYTES = 384 * 1024;
const TURN_URLS = [
  "turn:turn.cloudflare.com:3478",
  "turns:turn.cloudflare.com:443",
];
const CHANNEL = "electrify-coop-v2";
const CONFIRMED = 11;

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

interface Signal {
  peerId: string;
  generation: string;
  remainingMs: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

interface CredentialReply {
  iceServers: RTCIceServer[];
  remainingMs: number;
}

interface Peer {
  address: TurnPeer;
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
  private peers = new Map<string, Peer>();
  private obsolete = new Map<string, string>();
  private resetAt = new Map<string, number>();
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
      this.obsolete.clear();
      this.resetAt.clear();
      this.identity = nextIdentity;
    }
    const now = performance.now();
    this.authority = authority;
    this.until =
      Math.min(now, requestedAt) +
      Math.min(AUTHORITY_MS, authority.leaseRemainingMs);
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
      Date.now() < this.wallUntil &&
      document.visibilityState !== "hidden"
    );
  }

  private usable(peer: Peer) {
    const now = performance.now();
    return (
      this.current() &&
      this.peers.get(peer.address.to) === peer &&
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
    const ids = Array.from(this.peers.values())
      .filter((peer) => this.ready(peer))
      .map((peer) => peer.address.to)
      .sort();
    if (
      ids.length === this.connected.length &&
      ids.every((id, index) => id === this.connected[index])
    )
      return;
    this.connected = ids;
    this.options.status(ids);
  }

  private retire(peer: Peer) {
    if (this.peers.get(peer.address.to) !== peer) return;
    this.peers.delete(peer.address.to);
    this.obsolete.set(peer.address.to, peer.address.generation);
    peer.abort.abort();
    peer.pending = [];
    peer.pendingBytes = 0;
    peer.channel?.close();
    peer.pc?.close();
    this.publish();
  }

  close(): void {
    this.authority = undefined;
    this.poll?.abort();
    this.poll = undefined;
    this.nextReadAt = 0;
    window.clearInterval(this.timer);
    this.timer = undefined;
    for (const peer of this.peers.values()) this.retire(peer);
  }

  private tick() {
    if (!this.current()) {
      this.close();
      return;
    }
    const now = performance.now();
    for (const peer of this.peers.values()) {
      if (
        !this.usable(peer) ||
        (peer.localVerified && now - peer.proofAt > 2 * STATS_MS) ||
        (now - peer.createdAt > NEGOTIATION_MS && !this.ready(peer))
      ) {
        this.retire(peer);
      } else if (now - peer.candidateCheck > STATS_MS) {
        this.verify(peer);
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
      const connected = new Set(pairs.map((pair) => pair.peerId));
      for (const peer of this.peers.values()) {
        if (!connected.has(peer.address.to)) this.retire(peer);
      }
      for (const signal of pairs) this.useSignal(authority, signal, startedAt);
      if (pairs.every(({ peerId }) => this.connected.includes(peerId)))
        this.nextReadAt = startedAt + SIGNAL_IDLE_MS;
    } catch {
      // The previous signal confirmation expires independently of the room lease.
    } finally {
      if (this.poll === poll) this.poll = undefined;
    }
  }

  private reset(signal: Signal, authority: TurnAuthority) {
    const now = performance.now();
    if (now < (this.resetAt.get(signal.peerId) ?? 0)) return;
    this.resetAt.set(signal.peerId, now + 5_000);
    void this.api
      .request("signal/reset", {
        roomId: authority.roomId,
        to: signal.peerId,
        generation: signal.generation,
      })
      .catch(() => undefined);
  }

  private useSignal(
    authority: TurnAuthority,
    signal: Signal,
    startedAt: number,
  ) {
    if (
      signal.peerId === authority.selfId ||
      (authority.selfId !== authority.hostId &&
        signal.peerId !== authority.hostId)
    )
      return;
    if (!Number.isFinite(signal.remainingMs) || signal.remainingMs < 0) return;

    const { peerId, generation } = signal;
    const localIsHost = authority.selfId === authority.hostId;
    let peer = this.peers.get(peerId);
    if (peer && peer.address.generation !== generation) {
      this.retire(peer);
      peer = undefined;
    }
    if (peer) {
      peer.confirmedUntil = startedAt + AUTHORITY_MS;
      peer.expiresAt = Math.min(peer.expiresAt, startedAt + signal.remainingMs);
      if (this.ready(peer) && signal.remainingMs <= RENEW_MS) {
        this.reset(signal, authority);
      } else if (localIsHost && signal.answer) {
        this.acceptAnswer(peer, signal.answer);
      }
      return;
    }
    const alreadyNegotiated = localIsHost ? signal.offer : signal.answer;
    if (alreadyNegotiated || this.obsolete.get(peerId) === generation) {
      this.reset(signal, authority);
      return;
    }
    if (!localIsHost && !signal.offer) return;
    const candidate: Peer = {
      address: {
        roomId: authority.roomId,
        to: peerId,
        generation,
        epoch: authority.epoch,
      },
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
      pending: [],
      pendingBytes: 0,
    };
    this.peers.set(peerId, candidate);
    void this.open(candidate, signal).catch(() => this.retire(candidate));
  }

  private async open(peer: Peer, signal: Signal) {
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
        this.publish();
      })
      .catch(() => this.retire(peer))
      .finally(() => {
        peer.checking = false;
      });
  }

  private receive(peer: Peer, frame: unknown) {
    if (!this.usable(peer)) return;
    if (
      frame instanceof ArrayBuffer &&
      frame.byteLength === 1 &&
      new Uint8Array(frame)[0] === CONFIRMED &&
      !peer.remoteVerified
    ) {
      peer.remoteVerified = true;
      this.publish();
      return;
    }
    if (!this.ready(peer)) {
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
        if (!this.ready(peer)) return;
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
      })
      .catch(() => this.retire(peer));
  }

  async send(to: string, message: WireMessage): Promise<void> {
    const peer = this.peers.get(to);
    if (!peer || !this.ready(peer))
      throw new PeerDisconnectedError("Connection is unavailable");
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
