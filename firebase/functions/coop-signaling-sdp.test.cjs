const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRelayPolicy,
  validateDescription,
} = require("./coop-signaling-sdp.cjs");

const approved = createRelayPolicy("8.8.8.0/24");
const fingerprint = Array(32).fill("C2").join(":");
const sdp = [
  "v=0",
  "o=- 4321 2 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 12212 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 8.8.8.8",
  "a=candidate:455721 1 udp 30298521 8.8.8.8 12212 typ relay",
  "a=ice-ufrag:iA22",
  "a=ice-pwd:FtboouybttTfOsvwT8PvWx",
  `a=fingerprint:sha-256 ${fingerprint}`,
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "",
].join("\r\n");

test("accepts a single data-only exchange with approved relay endpoints", () => {
  const offer = { type: "offer", sdp };
  const answer = { type: "answer", sdp: sdp.replace("actpass", "active") };
  assert.deepEqual(validateDescription(offer, "offer", approved), offer);
  assert.deepEqual(validateDescription(answer, "answer", approved), answer);
  assert.equal(validateDescription(offer, "answer", approved), null);
  assert.equal(validateDescription(answer, "offer", approved), null);
});

test("rejects fake relays, direct candidates, leaked addresses and duplicate DTLS identity", () => {
  const invalid = [
    sdp.replaceAll("8.8.8.8", "8.8.4.4"),
    sdp.replaceAll("8.8.8.8", "192.168.0.11"),
    sdp.replace("typ relay", "typ host"),
    sdp.replace("typ relay", "typ relay raddr 192.168.0.11 rport 6133"),
    sdp.replace("12212 typ relay", "61222 typ relay"),
    sdp.replace("a=mid:0", "a=mid:1"),
    sdp.replace("a=setup:actpass", "a=setup:active"),
    sdp.replace("IN IP4 0.0.0.0", "IN IP4 192.168.1.4"),
    sdp.replace("a=mid:0", `a=fingerprint:sha-256 ${fingerprint}\r\na=mid:0`),
    sdp.replace(
      "a=mid:0",
      "a=remote-candidates:1 192.168.0.11 6133\r\na=mid:0",
    ),
    sdp.replace("a=mid:0", "m=video 9 UDP/TLS/RTP/SAVPF 100\r\na=mid:0"),
  ];
  for (const value of invalid) {
    assert.equal(
      validateDescription({ type: "offer", sdp: value }, "offer", approved),
      null,
    );
  }
  assert.equal(
    validateDescription({ type: "offer", sdp }, "offer", createRelayPolicy("")),
    null,
  );
});
