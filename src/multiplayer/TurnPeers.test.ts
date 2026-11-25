import { TextDecoder, TextEncoder } from "util";
import { TurnPeers } from "./TurnPeers";
import { turnFrames } from "./TurnWire";
import type { WireMessage } from "./SessionTransport";

Object.assign(globalThis, { TextDecoder, TextEncoder });

const authority = {
  roomId: "room",
  selfId: "host",
  hostId: "host",
  epoch: "epoch",
  binding: "host-device",
  leaseRemainingMs: 12_000,
};
const generation = "generation";
const offer = {
  type: "offer",
  sdp: [
    "m=application 2000 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 8.8.8.8",
    "a=candidate:11 1 udp 100 8.8.8.8 2000 typ relay",
  ].join("\r\n"),
} satisfies RTCSessionDescriptionInit;
const answer = {
  type: "answer",
  sdp: offer.sdp.replaceAll("8.8.8.8", "9.9.9.9").replaceAll("2000", "3000"),
} satisfies RTCSessionDescriptionInit;

const relayStats = (host: boolean) =>
  new Map<string, object>([
    ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
    [
      "pair",
      {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "local",
        remoteCandidateId: "remote",
      },
    ],
    [
      "local",
      {
        type: "local-candidate",
        candidateType: "relay",
        address: host ? "8.8.8.8" : "9.9.9.9",
        port: host ? 2000 : 3000,
      },
    ],
    [
      "remote",
      {
        type: "remote-candidate",
        candidateType: "relay",
        address: host ? "9.9.9.9" : "8.8.8.8",
        port: host ? 3000 : 2000,
      },
    ],
  ]);

class PeerFixture {
  connectionState: RTCPeerConnectionState = "connecting";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: RTCSessionDescriptionInit = offer;
  channel = {
    readyState: "connecting",
    bufferedAmount: 0,
    send: jest.fn(),
    close: jest.fn(),
    onmessage: undefined as
      ((event: { data: ArrayBuffer }) => void) | undefined,
  };
  close = jest.fn();
  holdStats = false;
  statsValid = true;
  private statsWaiters: Array<(stats: Map<string, object>) => void> = [];
  createDataChannel = jest.fn(() => this.channel);
  createOffer = async () => offer;
  setLocalDescription = async (): Promise<void> => undefined;
  setRemoteDescription = async () => {
    this.connectionState = "connected";
    this.channel.readyState = "open";
  };
  getStats = () => {
    if (!this.holdStats)
      return Promise.resolve(this.statsValid ? relayStats(true) : new Map());
    return new Promise<Map<string, object>>((resolve) => {
      this.statsWaiters.push(resolve);
    });
  };
  releaseStats() {
    const waiting = this.statsWaiters.splice(0);
    for (const resolve of waiting) resolve(relayStats(true));
  }
}

async function settle() {
  for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
}

test("a live verified relay stops delivering gameplay when the independent authority expires", async () => {
  jest.useFakeTimers();
  const fixture = new PeerFixture();
  const makePeer = jest.fn(() => fixture);
  const priorPeer = globalThis.RTCPeerConnection;
  Object.assign(globalThis, { RTCPeerConnection: makePeer });
  let answered = false;
  const api = {
    request: jest.fn(async (operation: string) => {
      if (operation === "signal/read") {
        return {
          pairs: [
            {
              peerId: "guest",
              generation,
              remainingMs: 90_000,
              answer: answered ? answer : undefined,
            },
          ],
        };
      }
      if (operation === "signal/turn") {
        return {
          iceServers: [
            {
              urls: [
                "turn:turn.cloudflare.com:3478",
                "turns:turn.cloudflare.com:443",
              ],
              username: "temporary-user",
              credential: "temporary-password",
            },
          ],
          remainingMs: 90_000,
        };
      }
      return {};
    }),
  };
  const status = jest.fn();
  const message = jest.fn();
  const peers = new TurnPeers(
    { request: <T>(operation: string) => api.request(operation) as Promise<T> },
    { status, message, storeTransfer: jest.fn(), readTransfer: jest.fn() },
  );
  try {
    peers.update(authority, performance.now());
    await settle();
    expect(makePeer).toHaveBeenCalledWith(
      expect.objectContaining({ iceTransportPolicy: "relay" }),
    );
    expect(fixture.createDataChannel).toHaveBeenCalledWith(
      "electrify-coop-v2",
      { id: 0, negotiated: true, ordered: true },
    );

    answered = true;
    jest.advanceTimersByTime(1_000);
    await settle();
    const confirmation = fixture.channel.send.mock
      .calls[0]?.[0] as Uint8Array<ArrayBuffer>;
    expect(confirmation.byteLength).toBe(1);
    expect(status).not.toHaveBeenCalled();
    fixture.channel.onmessage?.({ data: confirmation.buffer });
    expect(status).toHaveBeenLastCalledWith(["guest"]);

    const frame = turnFrames({
      generation,
      epoch: authority.epoch,
      message: { kind: "heartbeat" },
    })[0];
    fixture.channel.onmessage?.({ data: frame.buffer });
    expect(message).toHaveBeenCalledTimes(1);

    for (let step = 0; step < 5; step += 1) {
      jest.advanceTimersByTime(500);
      await settle();
    }
    fixture.channel.onmessage?.({ data: frame.buffer });
    expect(message).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(500);
    await settle();
    fixture.channel.onmessage?.({ data: frame.buffer });
    expect(message).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenLastCalledWith(["guest"]);
    // A stalled relay-stats read must not unpublish a channel that is still open.
    fixture.holdStats = true;
    jest.advanceTimersByTime(5_000);
    await settle();
    fixture.channel.onmessage?.({ data: frame.buffer });
    expect(message).toHaveBeenCalledTimes(4);
    expect(status).toHaveBeenLastCalledWith(["guest"]);
    fixture.holdStats = false;
    fixture.releaseStats();
    await settle();
    jest.advanceTimersByTime(8_000);
    await settle();
    fixture.channel.onmessage?.({ data: frame.buffer });
    expect(message).toHaveBeenCalledTimes(4);
    expect(status).toHaveBeenLastCalledWith([]);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    await expect(peers.send("guest", { kind: "heartbeat" })).rejects.toThrow(
      "unavailable",
    );
  } finally {
    peers.close();
    Object.assign(globalThis, { RTCPeerConnection: priorPeer });
    jest.useRealTimers();
  }
});

type Side = "host" | "guest";
type TestGeneration = {
  generation: string;
  expiresAt: number;
  createdAt: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
};

function duplex() {
  jest.useFakeTimers();
  const priorPeer = globalThis.RTCPeerConnection;
  const sockets = new Map<string, Partial<Record<Side, Connection>>>();
  const other = (side: Side) => (side === "host" ? "guest" : "host");
  let holdDrained = false;
  const heldDrains: (() => void)[] = [];
  class Connection extends PeerFixture {
    localInstalled = false;
    remoteInstalled = false;
    onconnectionstatechange?: () => void;
    constructor(config: RTCConfiguration) {
      super();
      const [side, id] = (config.iceServers![0].username as string).split(
        ":",
      ) as [Side, string];
      this.side = side;
      const pair = sockets.get(id) ?? {};
      pair[side] = this;
      sockets.set(id, pair);
      this.pair = pair;
      this.localDescription = side === "host" ? offer : answer;
      this.channel.send.mockImplementation((frame: Uint8Array<ArrayBuffer>) => {
        const target = pair[other(side)];
        const deliver = () => {
          if (target?.channel.readyState === "open")
            target.channel.onmessage?.({ data: frame.buffer });
        };
        if (holdDrained && frame.byteLength === 1 && frame[0] === 13) {
          heldDrains.push(deliver);
          return;
        }
        void Promise.resolve().then(deliver);
      });
      this.close.mockImplementation(() => {
        this.connectionState = "closed";
        this.channel.readyState = "closed";
        this.onconnectionstatechange?.();
      });
    }
    private side: Side;
    private pair: Partial<Record<Side, Connection>>;

    createAnswer = async () => answer;
    setLocalDescription = async () => {
      this.localInstalled = true;
      this.connect();
    };
    setRemoteDescription = async () => {
      this.remoteInstalled = true;
      this.connect();
    };
    getStats = async () => relayStats(this.side === "host");

    private connect() {
      const partner = this.pair[other(this.side)];
      if (
        !partner ||
        !this.localInstalled ||
        !this.remoteInstalled ||
        !partner.localInstalled ||
        !partner.remoteInstalled
      )
        return;
      for (const socket of [this, partner]) {
        socket.connectionState = "connected";
        socket.channel.readyState = "open";
        socket.onconnectionstatechange?.();
      }
    }
  }
  Object.assign(globalThis, { RTCPeerConnection: Connection });
  let created = 0;
  const makeGeneration = () => ({
    generation: "generation-" + ++created,
    createdAt: performance.now(),
    expiresAt: performance.now() + 120_000,
  });
  let current: TestGeneration = makeGeneration();
  let staged: TestGeneration | undefined;
  let rejectStagedCredential = false;
  const signal = (value: TestGeneration) => ({
    ...value,
    remainingMs: value.expiresAt - performance.now(),
  });
  const room = new Map<string, WireMessage>();
  const guestDownload = jest.fn((_: unknown, reference: string) =>
    Promise.resolve(room.get(reference)!),
  );
  const hostUpload = jest.fn((_: unknown, payload: WireMessage) => {
    room.set("baseline", payload);
    return Promise.resolve("baseline");
  });

  function player(side: Side) {
    const status = jest.fn();
    const message = jest.fn();
    const peers = new TurnPeers(
      {
        async request<T>(operation: string, body: unknown): Promise<T> {
          const { generation, description } = body as {
            generation?: string;
            description?: RTCSessionDescriptionInit;
          };
          if (operation === "signal/read") {
            if (current.expiresAt <= performance.now()) {
              current = staged ?? makeGeneration();
              staged = undefined;
            }
            return {
              pairs: [
                {
                  peerId: other(side),
                  ...signal(current),
                  ...(staged && { successor: signal(staged) }),
                },
              ],
            } as T;
          }
          const pair = generation === current.generation ? current : staged;
          if (!pair || generation !== pair.generation)
            throw new Error("obsolete generation");
          if (operation === "signal/turn") {
            if (pair === staged && rejectStagedCredential) {
              rejectStagedCredential = false;
              throw new Error("TURN is unavailable");
            }
            return {
              iceServers: [
                {
                  urls: [
                    "turn:turn.cloudflare.com:3478",
                    "turns:turn.cloudflare.com:443",
                  ],
                  username: side + ":" + generation,
                  credential: "temporary-password",
                },
              ],
              remainingMs: signal(pair).remainingMs,
            } as T;
          }
          if (operation === "signal/prepare") staged ??= makeGeneration();
          else if (operation === "signal/renegotiate") {
            delete pair.offer;
            delete pair.answer;
          } else if (operation === "signal/drained") {
            // Production promotes after both peers report; this mock waits for expiry.
          } else if (operation === "signal/describe") {
            if (description?.type === "offer") pair.offer = description;
            if (description?.type === "answer") pair.answer = description;
          } else if (operation === "signal/reset") {
            const minimumAge = pair.offer && pair.answer ? 25_000 : 15_000;
            if (performance.now() < pair.createdAt + minimumAge)
              throw new Error("turn-rotation-limit");
            if (pair === staged) staged = makeGeneration();
            else {
              current = makeGeneration();
              staged = undefined;
            }
          } else throw new Error(operation);
          return {} as T;
        },
      },
      {
        status,
        message,
        storeTransfer: hostUpload,
        readTransfer: guestDownload,
      },
    );
    return {
      peers,
      status,
      message,
      send: (payload: WireMessage) => peers.send(other(side), payload),
      renew: () =>
        peers.update(
          {
            ...authority,
            selfId: side,
            binding: side + "-device",
          },
          performance.now(),
        ),
    };
  }
  const host = player("host");
  const guest = player("guest");
  return {
    host,
    guest,
    hostUpload,
    guestDownload,
    sockets,
    generations: () => created,
    staged: () => staged?.generation,
    holdDrained: (hold: boolean) => {
      holdDrained = hold;
      if (!hold) {
        const pending = heldDrains.splice(0);
        pending.forEach((deliver) => deliver());
      }
    },
    rejectSuccessor: () => {
      rejectStagedCredential = true;
    },
    async advance(target: number) {
      while (performance.now() < target) {
        host.renew();
        guest.renew();
        await settle();
        jest.advanceTimersByTime(250);
        await settle();
      }
    },
    close() {
      host.peers.close();
      guest.peers.close();
      Object.assign(globalThis, { RTCPeerConnection: priorPeer });
      jest.useRealTimers();
    },
  };
}

function command(sequence: number): WireMessage {
  return {
    kind: "command",
    envelope: {
      matchId: "game",
      epoch: "epoch",
      sequence,
      command: { kind: "pause" },
    },
  };
}

function records(from: number): WireMessage {
  return {
    kind: "records",
    matchId: "game",
    epoch: "epoch",
    from,
    records: [{ t: "verify" }],
  };
}

test("forgetting a peer closes its link without waiting for the next signal poll", async () => {
  const f = duplex();
  try {
    await f.advance(4_000);
    await f.guest.send(command(1));
    f.host.peers.forget("guest");
    expect(f.host.status).toHaveBeenLastCalledWith([]);
    await expect(f.host.peers.send("guest", command(2))).rejects.toThrow(
      /unavailable/,
    );
  } finally {
    f.close();
  }
});

test("three TURN renewals keep both seats connected and deliver commands and records", async () => {
  const f = duplex();
  try {
    let index = 0;
    for (let now = 4_000; now <= 280_000; now += 4_000) {
      await f.advance(now);
      index++;
      await f.guest.send(command(index));
      await f.host.send(records(index));
      await settle();
    }
    const expected = Array.from({ length: index }, (_, i) => i + 1);
    expect(f.host.message.mock.calls.map(([, msg]) => msg)).toEqual(
      expected.map(command),
    );
    expect(f.guest.message.mock.calls.map(([, msg]) => msg)).toEqual(
      expected.map(records),
    );
    expect(f.host.status.mock.calls).toEqual([[["guest"]]]);
    expect(f.guest.status.mock.calls).toEqual([[["host"]]]);
    expect(f.generations()).toBe(4);
    expect(f.sockets.get("generation-1")!.host!.close).toHaveBeenCalled();
    const used = f.host.message.mock.calls.map(([, , peer]) => peer.generation);
    expect(new Set(used).size).toBe(4);
  } finally {
    f.close();
  }
});

test("a renewal preserves the old baseline and ordered records while a download is in flight", async () => {
  const f = duplex();
  try {
    await f.advance(82_000);
    const baseline: WireMessage = {
      kind: "baseline",
      matchId: "game",
      epoch: "epoch",
      index: 1,
      world: { matchId: "game", epoch: "epoch" } as Extract<
        WireMessage,
        { kind: "baseline" }
      >["world"],
      blockers: [],
    };
    let finishDownload!: (payload: WireMessage) => void;
    f.guestDownload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDownload = resolve;
        }),
    );
    await f.host.send(baseline);
    await f.host.send(records(2));
    await settle();
    expect(f.guestDownload).toHaveBeenCalledTimes(1);
    expect(f.guest.message).not.toHaveBeenCalled();

    await f.advance(96_000);
    let sent = false;
    const queued = f.host.send(records(3)).then(() => {
      sent = true;
    });
    await f.guest.send(command(1));
    await settle();
    expect(sent).toBe(false);
    expect(f.host.message).toHaveBeenCalledTimes(1);
    expect(f.guest.message).not.toHaveBeenCalled();

    finishDownload(baseline);
    await queued;
    await settle();
    expect(f.guest.message.mock.calls.map(([, message]) => message)).toEqual([
      baseline,
      records(2),
      records(3),
    ]);
    expect(f.host.status.mock.calls).toEqual([[["guest"]]]);
    expect(f.guest.status.mock.calls).toEqual([[["host"]]]);
  } finally {
    f.close();
  }
});

test("a failed successor preserves the current stream and a genuine loss reconnects", async () => {
  const f = duplex();
  try {
    await f.advance(82_000);
    f.rejectSuccessor();
    await f.advance(96_000);
    const staged = f.staged();
    expect(staged).toBe("generation-2");
    await f.guest.send(command(1));
    await f.host.send(records(1));
    await settle();
    expect(f.staged()).toBe(staged);
    expect(f.generations()).toBe(2);
    expect(f.host.status.mock.calls).toEqual([[["guest"]]]);
    expect(f.guest.status.mock.calls).toEqual([[["host"]]]);
    expect(f.host.message.mock.calls.map(([, message]) => message)).toEqual([
      command(1),
    ]);

    await f.advance(121_000);
    expect(f.staged()).not.toBe(staged);
    await f.guest.send(command(2));
    await settle();
    expect(f.host.message.mock.calls.map(([, message]) => message)).toEqual([
      command(1),
      command(2),
    ]);

    f.sockets.get("generation-2")!.host!.close();
    expect(f.host.status).toHaveBeenLastCalledWith([]);
    await f.advance(140_000);
    await f.guest.send(command(3));
    await settle();
    expect(f.host.status).toHaveBeenLastCalledWith(["guest"]);
    expect(f.host.message.mock.calls.map(([, message]) => message)).toEqual([
      command(1),
      command(2),
      command(3),
    ]);
  } finally {
    f.close();
  }
});

test("a predecessor loss after the local drain keeps the successor until the remote drain arrives", async () => {
  const f = duplex();
  try {
    f.holdDrained(true);
    await f.advance(90_000);
    let sent = false;
    const queued = f.host.send(records(1)).then(() => {
      sent = true;
    });
    await settle();
    expect(sent).toBe(false);
    const successor = f.sockets.get("generation-2")!.host!;
    f.sockets.get("generation-1")!.host!.close();
    await settle();
    expect(successor.close).not.toHaveBeenCalled();
    expect(sent).toBe(false);
    expect(f.host.status).toHaveBeenLastCalledWith(["guest"]);
    f.holdDrained(false);
    await queued;
    await settle();
    expect(f.guest.message.mock.calls.map(([, message]) => message)).toEqual([
      records(1),
    ]);
    expect(f.host.status).toHaveBeenLastCalledWith(["guest"]);
  } finally {
    f.close();
  }
});

test("credential expiry promotes a drained successor instead of closing it", async () => {
  const f = duplex();
  try {
    f.holdDrained(true);
    await f.advance(90_000);
    const successor = f.sockets.get("generation-2")!.host!;
    f.sockets.get("generation-1")!.host!.close();
    await settle();
    const queued = f.host.send(records(1));
    await f.advance(119_000);
    expect(successor.close).not.toHaveBeenCalled();
    await f.advance(121_000);
    await queued;
    await settle();
    expect(successor.close).not.toHaveBeenCalled();
    expect(f.guest.message.mock.calls.map(([, message]) => message)).toEqual([
      records(1),
    ]);
    expect(f.host.status).toHaveBeenLastCalledWith(["guest"]);
  } finally {
    f.close();
  }
});
