/* A synchronous SHA-256 for the shared browser/Node data contract; no platform crypto dependency. */
const SHA_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function utf8Bytes(value) {
  const bytes = [];
  for (const character of value) {
    let n = character.codePointAt(0);
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 0x80) bytes.push(n);
    else if (n < 0x800) bytes.push(0xc0 | (n >>> 6), 0x80 | (n & 63));
    else if (n < 0x10000)
      bytes.push(0xe0 | (n >>> 12), 0x80 | ((n >>> 6) & 63), 0x80 | (n & 63));
    else
      bytes.push(
        0xf0 | (n >>> 18),
        0x80 | ((n >>> 12) & 63),
        0x80 | ((n >>> 6) & 63),
        0x80 | (n & 63),
      );
  }
  return bytes;
}
function sha256(value) {
  const bytes = utf8Bytes(value),
    bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--)
    bytes.push(i >= 4 ? 0 : (bitLength >>> (i * 8)) & 255);
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const rotate = (n, s) => (n >>> s) | (n << (32 - s));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Int32Array(64);
    for (let i = 0; i < 16; i++)
      words[i] =
        (bytes[offset + 4 * i] << 24) |
        (bytes[offset + 4 * i + 1] << 16) |
        (bytes[offset + 4 * i + 2] << 8) |
        bytes[offset + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15],
        b = words[i - 2];
      words[i] =
        (words[i - 16] +
          (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
          words[i - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) |
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h +
          (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          SHA_CONSTANTS[i] +
          words[i]) |
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) |
        0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((n, i) => {
      hash[i] = (hash[i] + n) | 0;
    });
  }
  return hash.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}
function canonicalRuleValue(value, key = "") {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalRuleValue(v));
    if (
      items.every((v) => v && typeof v === "object" && typeof v.id === "string")
    )
      items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    else if (
      ["outputMultipliersBySelector", "targets", "transactions"].includes(key)
    )
      items.sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      );
    else if (key === "officialArcs")
      items.sort((a, b) => a.scenarioId - b.scenarioId);
    else if (
      ["optionIds", "eventIds", "fuels", "startingAssetIds"].includes(key)
    )
      items.sort();
    return items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalRuleValue(value[k], k)]),
    );
  return value;
}
const canonicalRuleJson = (value) => JSON.stringify(canonicalRuleValue(value));
const ruleDigest = (value) => `sha256-${sha256(canonicalRuleJson(value))}`;
module.exports = {
  utf8Bytes,
  sha256,
  canonicalRuleValue,
  canonicalRuleJson,
  ruleDigest,
};
