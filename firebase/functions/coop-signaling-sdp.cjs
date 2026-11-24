const { BlockList, isIP } = require("node:net");

const nonPublic = new BlockList();
// A separate list: putting ::ffff:0:0/96 on the IPv4 list blocks every IPv4 address.
const mapped = new BlockList();
mapped.addSubnet("::ffff:0:0", 96, "ipv6");
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]) {
  nonPublic.addSubnet(address, bits, "ipv4");
}
for (const [address, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["fc00::", 7],
  ["ff00::", 8],
  ["2001:db8::", 32],
]) {
  nonPublic.addSubnet(address, bits, "ipv6");
}

const candidate =
  /^a=candidate:[a-zA-Z0-9+/]{1,32} 1 udp (\d{1,10}) ([0-9a-f:.]+) (\d{1,5}) typ relay$/i;
const origin =
  /^o=(?:-|mozilla\.\.\.THIS_IS_SDPARTA-[\w.-]+) \d{1,20} \d{1,20} IN IP4 0\.0\.0\.0$/;
const data = /^m=application (\d{1,5}) UDP\/DTLS\/SCTP webrtc-datachannel$/;
const connect = /^c=IN IP4 (\d{1,3}(?:\.\d{1,3}){3})$/;
const mid = /^a=mid:([\w-]{1,16})$/;
const bundle = /^a=group:BUNDLE ([\w-]{1,16})$/;
const maximumSize = /^a=max-message-size:\d{1,10}$/;
const fingerprint = /^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i;
const ufrag = /^a=ice-ufrag:[\da-z+/]{4,256}$/i;
const password = /^a=ice-pwd:[\da-z+/]{22,256}$/i;
const direct = new Set(["v=0", "s=-", "t=0 0", "a=sctp-port:5000"]);
const optional = new Set(["a=msid-semantic: WMS", "a=end-of-candidates"]);

function isPublicRelayAddress(address) {
  const version = isIP(address);
  if (version === 4) return !nonPublic.check(address, "ipv4");
  if (version === 6) {
    // Mapped text compares as IPv4 on the shared list, so it has its own prefix.
    if (mapped.check(address, "ipv6")) return false;
    return !nonPublic.check(address, "ipv6");
  }
  return false;
}

function createRelayPolicy(config) {
  if (typeof config !== "string" || !config.trim()) return null;
  const ips = new BlockList();
  for (const range of config.trim().split(/[\s,]+/)) {
    const [address, mask, extra] = range.split("/");
    const version = isIP(address);
    const bits = Number(mask);
    const prefix =
      version === 4
        ? bits >= 16 && bits <= 32
        : version === 6 && bits >= 8 && bits <= 128;
    if (
      extra !== undefined ||
      !isPublicRelayAddress(address) ||
      !Number.isInteger(bits) ||
      !prefix
    ) {
      return null;
    }
    ips.addSubnet(address, bits, version === 6 ? "ipv6" : "ipv4");
  }
  return (address) => {
    const version = isIP(address);
    if (version !== 4 && version !== 6) return false;
    return (
      isPublicRelayAddress(address) &&
      ips.check(address, version === 6 ? "ipv6" : "ipv4")
    );
  };
}

function validateDescription(value, type, relayPolicy = null) {
  if (
    value?.type !== type ||
    Object.keys(value).length !== 2 ||
    typeof value.sdp !== "string" ||
    value.sdp.length > 16 * 1024 ||
    !/^[\x20-\x7e\r\n]+$/.test(value.sdp) ||
    !value.sdp.endsWith("\r\n")
  ) {
    return null;
  }

  const lines = value.sdp.slice(0, -2).split("\r\n");
  const endpoints = new Set();
  const seen = new Set();
  let connection, mediaPort, mediaMid, bundleMid;
  for (const line of lines) {
    const fields = candidate.exec(line);
    if (fields) {
      const [, priority, address, port] = fields;
      const key = `${address}:${Number(port)}`;
      if (
        endpoints.size >= 16 ||
        endpoints.has(key) ||
        !(relayPolicy ? relayPolicy(address) : isPublicRelayAddress(address)) ||
        Number(priority) > 0xffffffff ||
        Number(port) < 1 ||
        Number(port) > 65535
      ) {
        return null;
      }
      endpoints.add(key);
      continue;
    }

    const key = line.startsWith("a=") ? line.split(":", 1)[0] : line[0];
    if (seen.has(key)) return null;
    seen.add(key);
    if (direct.has(line) || optional.has(line)) continue;
    const mediaFields = data.exec(line);
    const connectionFields = connect.exec(line);
    const midFields = mid.exec(line);
    const bundleFields = bundle.exec(line);
    if (mediaFields || connectionFields || midFields || bundleFields) {
      mediaPort = mediaFields?.[1] ?? mediaPort;
      connection = connectionFields?.[1] ?? connection;
      mediaMid = midFields?.[1] ?? mediaMid;
      bundleMid = bundleFields?.[1] ?? bundleMid;
      continue;
    }
    if (
      origin.test(line) ||
      maximumSize.test(line) ||
      fingerprint.test(line) ||
      ufrag.test(line) ||
      password.test(line) ||
      (type === "offer"
        ? /^a=setup:actpass$/
        : /^a=setup:(active|passive)$/
      ).test(line)
    ) {
      continue;
    }
    return null;
  }

  const required = [
    "v",
    "o",
    "s",
    "t",
    "m",
    "c",
    "a=mid",
    "a=fingerprint",
    "a=ice-ufrag",
    "a=ice-pwd",
    "a=setup",
    "a=sctp-port",
  ];
  if (
    !required.every((key) => seen.has(key)) ||
    !endpoints.size ||
    (bundleMid && bundleMid !== mediaMid) ||
    (connection === "0.0.0.0"
      ? Number(mediaPort) !== 9
      : !endpoints.has(`${connection}:${Number(mediaPort)}`))
  ) {
    return null;
  }
  return { type, sdp: value.sdp };
}

module.exports = {
  createRelayPolicy,
  isPublicRelayAddress,
  validateDescription,
};
