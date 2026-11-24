const assert = require("node:assert/strict");
const test = require("node:test");
const { validateDescription } = require("./coop-signaling-sdp.cjs");

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

test("accepts data-only offers and answers with public IPv4 relays without configured ranges", () => {
  const offer = { type: "offer", sdp };
  const answer = {
    type: "answer",
    sdp: sdp.replaceAll("8.8.8.8", "1.1.1.1").replace("actpass", "active"),
  };
  assert.deepEqual(validateDescription(offer, "offer"), offer);
  assert.deepEqual(validateDescription(answer, "answer"), answer);
  assert.equal(validateDescription(offer, "answer"), null);
  assert.equal(validateDescription(answer, "offer"), null);
});

test("rejects direct candidates, leaked addresses and duplicate DTLS identity", () => {
  const invalid = [
    sdp.replace("typ relay", "typ host"),
    sdp.replace("typ relay", "typ srflx"),
    sdp.replace("c=IN IP4 8.8.8.8", "c=IN IP4 192.168.0.11"),
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
      validateDescription({ type: "offer", sdp: value }, "offer"),
      null,
    );
  }
});

test("rejects malformed, private and reserved relay candidate addresses", () => {
  for (const address of [
    "999.8.8.8",
    "8.008.8.8",
    "::ffff:8.8.8.8",
    "relay.example.com",
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.11",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    const offer = { type: "offer", sdp: sdp.replaceAll("8.8.8.8", address) };
    assert.equal(validateDescription(offer, "offer"), null, address);
  }
});
