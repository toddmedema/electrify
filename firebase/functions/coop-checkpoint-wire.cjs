const { gunzipSync } = require("node:zlib");

const MAX_COMPRESSED_BYTES = 6 * 1024 * 1024;
const MAX_DECODED_BYTES = 32 * 1024 * 1024;
const MAX_NESTING = 64;
const MAX_TOKENS = 2_000_000;

function snapshotJson(decoded) {
  const json = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  let depth = 0;
  let tokens = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    if (char === "{" || char === "[") {
      if (++depth > MAX_NESTING) throw new Error("Snapshot is too deep");
    } else if (char === "}" || char === "]") depth--;
    // Every array element or object property counts at least one delimiter.
    if ("{[,:".includes(char) && ++tokens > MAX_TOKENS)
      throw new Error("Snapshot contains too many fields");
  }
  return json;
}

function unpackCheckpoint(bytes) {
  return snapshotJson(
    gunzipSync(bytes, { maxOutputLength: MAX_DECODED_BYTES }),
  );
}

module.exports = {
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  snapshotJson,
  unpackCheckpoint,
};
