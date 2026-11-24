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
  const candidate = sdp.split("\r\n").at(-1)!;
  const offer = relayDescription({
    type: "offer",
    sdp: [sdp, candidate, candidate.toUpperCase()].join("\r\n"),
  });
  expect(offer.sdp?.match(/a=candidate:/gi)).toHaveLength(1);
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

test("browser extras and an IPv6 relay become the canonical description", () => {
  const noisy = [
    "v=0",
    "o=mozilla...THIS_IS_SDPARTA-99 1 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP6 2606:4700:4700::1111",
    "a=rtcp-mux",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:iA22",
    "a=ice-pwd:FtboouybttTfOsvwT8PvWx",
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 AA:BB",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "a=candidate:7 1 udp 1 2606:4700:4700::1111 3478 typ relay",
    "a=candidate:8 1 udp 1 fe80::1 3478 typ relay",
    "a=candidate:9 1 udp 1 2001:db8::1 3478 typ relay",
    "a=candidate:10 1 udp 1 0:0:0:0:0:ffff:808:808 3478 typ relay",
    "a=end-of-candidates",
  ].join("\r\n");
  const offer = relayDescription({ type: "offer", sdp: noisy });
  expect(offer.sdp).toContain("a=group:BUNDLE 0");
  expect(offer.sdp).toContain(
    "a=candidate:7 1 udp 1 2606:4700:4700::1111 3478 typ relay",
  );
  expect(offer.sdp).not.toMatch(
    /rtcp|trickle|extmap|sendrecv|fe80|127\.0|2001:db8|ffff/,
  );
  expect(offer.sdp).toContain("c=IN IP4 0.0.0.0");
});

test("public neighbors of reserved /24 ranges stay eligible relays", () => {
  const relay = (address: string) =>
    relayDescription({
      type: "offer",
      sdp: [
        "v=0",
        "o=- 1 1 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
        "c=IN IP4 0.0.0.0",
        `a=candidate:1 1 udp 1 ${address} 3478 typ relay`,
        "a=ice-ufrag:iA22",
        "a=ice-pwd:FtboouybttTfOsvwT8PvWx",
        "a=fingerprint:sha-256 AA:BB",
        "a=setup:actpass",
        "a=mid:0",
        "a=sctp-port:5000",
      ].join("\r\n"),
    });
  expect(relay("198.51.101.1").sdp).toContain("198.51.101.1");
  expect(relay("192.0.1.1").sdp).toContain("192.0.1.1");
  expect(() => relay("198.51.100.1")).toThrow(/eligible relay/);
  expect(() => relay("192.0.2.1")).toThrow(/eligible relay/);
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
