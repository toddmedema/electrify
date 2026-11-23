import { relayDescription, selectedRelayPair } from "./TurnDescription";

const sdp = [
  "v=0",
  "o=- 200 2 IN IP4 127.0.0.1",
  "a=extmap-allow-mixed",
  "a=msid-semantic:WMS *",
  "m=application 3222 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 192.168.23.5",
  "a=sendrecv",
  "a=ice-options:trickle",
  "a=candidate:111 1 UDP 200 192.168.23.5 3222 typ host",
  "a=candidate:223 1 UDP 201 8.8.8.8 4444 typ relay raddr 192.168.23.5 rport 3222",
].join("\r\n");

test("the exchanged SDP keeps the relay and strips local network details", () => {
  const offer = relayDescription({ type: "offer", sdp });
  expect(offer.sdp).toContain(
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  );
  expect(offer.sdp).toContain("c=IN IP4 0.0.0.0");
  expect(offer.sdp).toContain(
    "a=candidate:223 1 udp 201 8.8.8.8 4444 typ relay\r\n",
  );
  expect(offer.sdp).not.toMatch(
    /typ host|192\.168|127\.0|raddr|rport|trickle|extmap/,
  );
});

test("the selected pair must match both authenticated relay endpoints", async () => {
  const local = relayDescription({ type: "offer", sdp });
  const remote = relayDescription({
    type: "answer",
    sdp: sdp.replace("8.8.8.8 4444", "9.9.9.9 8888"),
  });
  const localCandidate = {
    type: "local-candidate",
    candidateType: "relay",
    address: "8.8.8.8",
    port: 4444,
  };
  const remoteCandidate = {
    type: "remote-candidate",
    candidateType: "relay",
    address: "9.9.9.9",
    port: 8888,
  };
  const stats = new Map<string, object>([
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
    ["local", localCandidate],
    ["remote", remoteCandidate],
  ]);
  const pc = { getStats: async () => stats } as unknown as RTCPeerConnection;
  await expect(selectedRelayPair(pc, local, remote)).resolves.toBe(true);
  remoteCandidate.port = 8889;
  await expect(selectedRelayPair(pc, local, remote)).resolves.toBe(false);
  remoteCandidate.port = 8888;
  remoteCandidate.candidateType = "srflx";
  await expect(selectedRelayPair(pc, local, remote)).resolves.toBe(false);
});
