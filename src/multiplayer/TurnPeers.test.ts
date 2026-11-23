import { TextDecoder, TextEncoder } from "util";
import { TurnPeers } from "./TurnPeers";
import { turnFrames } from "./TurnWire";

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

class PeerFixture {
  connectionState: RTCPeerConnectionState = "connecting";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription = offer;
  channel = {
    readyState: "connecting",
    bufferedAmount: 0,
    send: jest.fn(),
    close: jest.fn(),
    onmessage: undefined as
      ((event: { data: ArrayBuffer }) => void) | undefined,
  };
  close = jest.fn();
  createDataChannel = jest.fn(() => this.channel);
  createOffer = async () => offer;
  setLocalDescription = async () => undefined;
  setRemoteDescription = async () => {
    this.connectionState = "connected";
    this.channel.readyState = "open";
  };
  getStats = async () =>
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
          address: "8.8.8.8",
          port: 2000,
        },
      ],
      [
        "remote",
        {
          type: "remote-candidate",
          candidateType: "relay",
          address: "9.9.9.9",
          port: 3000,
        },
      ],
    ]);
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
    expect(message).toHaveBeenCalledTimes(2);
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
