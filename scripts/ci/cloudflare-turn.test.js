const assert = require("node:assert/strict");
const test = require("node:test");
const { runInNewContext } = require("node:vm");
const { installTurnProbe } = require("../testing/cloudflare-turn-browser");
const { inspectDescription } = require("../testing/cloudflare-turn");
const {
  createRelayPolicy,
} = require("../../firebase/functions/coop-signaling-sdp.cjs");

const candidate = "a=candidate:1 1 UDP 16777215 1.1.1.1 1234 typ relay";
const offer = {
  type: "offer",
  sdp: [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "m=application 1234 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 1.1.1.1",
    "a=ice-ufrag:test",
    candidate + " raddr 0.0.0.0 rport 9",
    "",
  ].join("\r\n"),
};
const replace = (from, to) => ({ ...offer, sdp: offer.sdp.replace(from, to) });

test("accepts an embedded public relay and SDP privacy placeholders", () => {
  for (const port of [0, 9]) {
    const result = inspectDescription(
      replace("rport 9", "rport " + port),
      "offer",
    );
    assert.deepEqual(result.endpoints, ["1.1.1.1:1234"]);
  }
});

test("a syntactically valid relay still needs to match the supplied allocation ranges", () => {
  const isRelay = createRelayPolicy("141.101.64.0/18");
  const inside = replace(
    "1.1.1.1 1234 typ relay",
    "141.101.64.1 1234 typ relay",
  );
  const description = {
    ...inside,
    sdp: inside.sdp.replace("c=IN IP4 1.1.1.1", "c=IN IP4 141.101.64.1"),
  };
  assert.deepEqual(
    inspectDescription(description, "offer", isRelay).endpoints,
    ["141.101.64.1:1234"],
  );
  assert.throws(
    () => inspectDescription(offer, "offer", isRelay),
    /allocation ranges/,
  );
});

test("removes related addresses and ports before exchanging Firefox-style SDP", () => {
  const raw = replace("raddr 0.0.0.0 rport 9", "raddr 192.168.1.1 rport 61234");
  const { description, endpoints } = inspectDescription(raw, "offer");
  assert.match(description.sdp, /raddr 0\.0\.0\.0 rport 9/);
  assert.doesNotMatch(description.sdp, /192\.168\.1\.1|61234/);
  assert.deepEqual(endpoints, ["1.1.1.1:1234"]);
  assert.match(raw.sdp, /raddr 192\.168\.1\.1 rport 61234/);
});

test("rejects generated SDP with direct candidates or exposed addresses", () => {
  for (const invalid of [
    replace(candidate, candidate.replace("typ relay", "typ host")),
    replace(candidate, candidate.replace("1.1.1.1", "192.168.1.1")),
    replace("raddr 0.0.0.0", "raddr peer.local"),
    replace("c=IN IP4 1.1.1.1", "c=IN IP4 192.168.1.1"),
    replace("o=- 1 2 IN IP4 127.0.0.1", "o=- 1 2 IN IP4 192.168.1.1"),
    replace(
      candidate,
      "a=remote-candidates:1 192.168.1.1 1234\r\n" + candidate,
    ),
  ]) {
    assert.throws(
      () => inspectDescription(invalid, "offer"),
      /address|IPv4 relay|metadata/,
    );
  }
});

test("requires a single data-only section, ICE username fragment and relay candidate", () => {
  assert.throws(
    () => inspectDescription(replace("m=application", "m=video"), "offer"),
    /data-only/,
  );
  assert.throws(
    () =>
      inspectDescription(
        replace("a=ice-ufrag:test", "a=ice-ufrag:test\r\na=ice-ufrag:other"),
        "offer",
      ),
    /username fragment/,
  );
  assert.throws(
    () =>
      inspectDescription(replace(candidate, "a=end-of-candidates"), "offer"),
    /No relay/,
  );
});

test("a malformed guest packet cannot count as a delivered message", () => {
  const receipts = [];
  const window = {};
  const channel = {
    readyState: "open",
    send: (receipt) => receipts.push(receipt),
  };
  runInNewContext(
    `(${installTurnProbe})({ channelId: 1, receiptDelayMs: 0 })`,
    {
      window,
      RTCPeerConnection: class {
        createDataChannel() {
          return channel;
        }
      },
      setTimeout: (callback) => callback(),
    },
  );
  const guest = window.turnProbes[1];
  channel.onmessage({ data: "1:" + "x".repeat(8192) });
  channel.onmessage({ data: "2:malformed" });
  assert.equal(guest.healthy(), false);
  assert.equal(guest.received(), 1);
  assert.deepEqual(receipts, ["1"]);
});
