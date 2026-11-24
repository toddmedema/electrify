const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRelayPolicy,
  validateDescription,
} = require("./coop-signaling-sdp.cjs");

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
    "0:0:0:0:0:ffff:808:808",
    "2001:db8::1",
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
    const offer = {
      type: "offer",
      sdp: sdp.replace(
        "a=mid:0",
        `a=candidate:2 1 udp 12345 ${address} 12213 typ relay\r\na=mid:0`,
      ),
    };
    assert.equal(validateDescription(offer, "offer"), null, address);
  }
});

test("accepts a public IPv6 relay and rejects a link-local one", () => {
  const v6 = sdp
    .replace("m=application 12212", "m=application 9")
    .replace("c=IN IP4 8.8.8.8", "c=IN IP4 0.0.0.0")
    .replace(
      "a=candidate:455721 1 udp 30298521 8.8.8.8 12212 typ relay",
      "a=candidate:455721 1 udp 30298521 2606:4700:4700::1111 12212 typ relay",
    );
  assert.ok(validateDescription({ type: "offer", sdp: v6 }, "offer"));
  assert.equal(
    validateDescription(
      {
        type: "offer",
        sdp: v6.replace("2606:4700:4700::1111", "fe80::1"),
      },
      "offer",
    ),
    null,
  );
});

test("an IPv6 allocation prefix is part of the relay policy", () => {
  const policy = createRelayPolicy("2606:4700:4700::/48");
  assert.equal(typeof policy, "function");
  assert.equal(policy("2606:4700:4700::1111"), true);
  assert.equal(policy("2606:4700:4800::1"), false);
  assert.equal(createRelayPolicy("2606:4700:4700::/129"), null);
});

test("a configured relay policy rejects public addresses outside its ranges", () => {
  const policy = createRelayPolicy("8.8.8.0/24");
  assert.ok(validateDescription({ type: "offer", sdp }, "offer", policy));
  assert.equal(
    validateDescription(
      { type: "offer", sdp: sdp.replaceAll("8.8.8.8", "1.1.1.1") },
      "offer",
      policy,
    ),
    null,
  );
});
