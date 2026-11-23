/** Only the renderer's configured relay can receive remote desktop requests. */
function coopRelayUrl(value) {
  if (!value) return undefined;
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "wss:" && !(loopback && url.protocol === "ws:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/v1"
  )
    throw new Error(
      "Use a wss:// relay URL ending in /v1 (ws:// is allowed on loopback).",
    );
  return url;
}

module.exports = { coopRelayUrl };
