const { BlockList, isIP } = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const {
  installTurnProbe,
  gatherDescription,
} = require("./cloudflare-turn-browser");

const ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys";
const PROTOCOLS = {
  udp: "turn:turn.cloudflare.com:3478?transport=udp",
  tls: "turns:turn.cloudflare.com:443?transport=tcp",
};
const ENGINES = ["chromium", "firefox", "webkit"];
const ROOM_URL = "http://localhost/turn-probe";
const CONTROL_BYTES = 8192;
const BURST = 8;

// Reject locally scoped and special-use IPv4 addresses in observations. Provider allocation
// provenance is a separate requirement and cannot be inferred from this public-address check.
const nonPublic = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  nonPublic.addSubnet(address, bits);

class ProbeError extends Error {}

function cloudflare(keyId, keyToken, interrupted) {
  const active = new Set();
  async function post(path, payload, status) {
    const response = await fetch(`${ENDPOINT}/${keyId}/credentials/${path}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${keyToken}`,
        "Content-Type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      throw new ProbeError("Cloudflare TURN API request failed");
    });
    if (response.status !== status) {
      await response.body?.cancel();
      throw new ProbeError(
        `Cloudflare TURN API returned HTTP ${response.status}`,
      );
    }
    return response;
  }
  return {
    async issue(protocol) {
      if (interrupted()) throw new ProbeError("TURN probe was interrupted");
      const result = await (
        await post("generate-ice-servers", { ttl: 120 }, 201)
      ).json();
      const grants = Array.isArray(result?.iceServers) ? result.iceServers : [];
      // Track issued usernames even if the expected TURN URL is missing.
      for (const grant of grants) {
        if (
          typeof grant?.username === "string" &&
          /^[a-zA-Z0-9._~-]{1,256}$/.test(grant.username)
        )
          active.add(grant.username);
      }
      const url = PROTOCOLS[protocol];
      const selected = grants.find(
        (grant) =>
          active.has(grant?.username) &&
          typeof grant.credential === "string" &&
          grant.credential.length > 0 &&
          Array.isArray(grant.urls) &&
          grant.urls.includes(url),
      );
      if (!selected)
        throw new ProbeError("Expected Cloudflare TURN URL was absent");
      return {
        urls: url,
        username: selected.username,
        credential: selected.credential,
      };
    },
    async revoke(username) {
      await post(`${encodeURIComponent(username)}/revoke`, undefined, 204);
      active.delete(username);
    },
    async cleanup() {
      const results = await Promise.allSettled(
        [...active].map((username) => this.revoke(username)),
      );
      if (results.some(({ status }) => status === "rejected"))
        throw new ProbeError(
          "Cloudflare did not confirm cleanup of every short-lived credential",
        );
    },
  };
}

function inspectDescription(description, type) {
  if (
    description?.type !== type ||
    typeof description.sdp !== "string" ||
    description.sdp.length > 16 * 1024
  )
    throw new ProbeError("Invalid generated WebRTC description");
  const lines = description.sdp.split(/\r?\n/);
  const media = lines.filter((line) => line.startsWith("m="));
  if (
    media.length !== 1 ||
    !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(media[0])
  )
    throw new ProbeError("WebRTC description was not data-only");
  const candidates = lines.filter((line) => line.startsWith("a=candidate:"));
  if (!candidates.length)
    throw new ProbeError("No relay candidates were gathered");
  const endpoints = [];
  const relayAddresses = new Set();
  for (const line of candidates) {
    const [
      ,
      component,
      protocol,
      ,
      address,
      port,
      typ,
      candidateType,
      ...extensions
    ] = line.split(" ");
    if (
      component !== "1" ||
      protocol?.toLowerCase() !== "udp" ||
      typ !== "typ" ||
      candidateType !== "relay" ||
      isIP(address) !== 4 ||
      nonPublic.check(address) ||
      !/^\d{1,5}$/.test(port) ||
      Number(port) < 1 ||
      Number(port) > 65535
    )
      throw new ProbeError(
        "A generated ICE candidate did not describe a Cloudflare-style IPv4 relay",
      );
    relayAddresses.add(address);
    endpoints.push(`${address}:${Number(port)}`);
    for (let i = 0; i < extensions.length; i += 2) {
      const key = extensions[i];
      const value = extensions[i + 1];
      if (!(
        (key === "raddr" && (value === "0.0.0.0" || value === "::")) ||
        (key === "rport" && (value === "0" || value === "9")) ||
        (["generation", "network-id", "network-cost"].includes(key) &&
          /^\d+$/.test(value))
      )) {
        throw new ProbeError(
          "A generated ICE candidate contained unexpected address metadata",
        );
      }
    }
  }
  // This is a diagnostic on the two local browsers' SDP, not a parser for untrusted signaling.
  for (const line of lines) {
    if (
      line.startsWith("o=") &&
      !/ IN IP[46] (?:0\.0\.0\.0|127\.0\.0\.1|::)$/.test(line)
    )
      throw new ProbeError(
        "A generated SDP origin exposed an unexpected address",
      );
    if (
      line.startsWith("c=") &&
      !/^c=IN IP[46] (?:0\.0\.0\.0|::)$/.test(line) &&
      !relayAddresses.has(line.split(" ")[2])
    )
      throw new ProbeError(
        "A generated SDP connection exposed an unexpected address",
      );
    if (line.startsWith("a=remote-candidates:"))
      throw new ProbeError(
        "A generated SDP description included remote candidate metadata",
      );
  }
  const fragments = lines.filter((line) => line.startsWith("a=ice-ufrag:"));
  if (
    fragments.length !== 1 ||
    !/^a=ice-ufrag:[a-zA-Z0-9+/]{4,256}$/.test(fragments[0])
  )
    throw new ProbeError(
      "Generated WebRTC description lacked a unique ICE username fragment",
    );
  return { description, endpoints, fragment: fragments[0] };
}

async function openBrowserPage(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    if (route.request().url() !== ROOM_URL) return route.abort();
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>TURN probe</title>",
    });
  });
  const page = await context.newPage();
  await page.goto(ROOM_URL, { timeout: 8000 });
  return page;
}

async function exchangeDescriptions(host, guest, id, restart) {
  const offer = inspectDescription(
    await host.evaluate(gatherDescription, { id, type: "offer", restart }),
    "offer",
  );
  await guest.evaluate(
    ({ id, offer }) => window.turnProbes[id].peer.setRemoteDescription(offer),
    { id, offer: offer.description },
  );
  const answer = inspectDescription(
    await guest.evaluate(gatherDescription, { id, type: "answer" }),
    "answer",
  );
  await host.evaluate(
    ({ id, answer }) => window.turnProbes[id].peer.setRemoteDescription(answer),
    { id, answer: answer.description },
  );
  return { offer, answer };
}

async function confirmRelayPair(page, id, protocol, local, remote, previous) {
  const handle = await page.waitForFunction(
    async ({ id, local, remote, previous }) => {
      const probe = window.turnProbes[id];
      if (probe.channel.readyState !== "open") return false;
      const pair = await probe.selectedPair();
      if (
        !pair ||
        !local.includes(pair.localEndpoint) ||
        !remote.includes(pair.remoteEndpoint)
      )
        return false;
      if (
        previous?.localEndpoint === pair.localEndpoint ||
        previous?.remoteEndpoint === pair.remoteEndpoint
      )
        return false;
      return pair;
    },
    { id, local: local.endpoints, remote: remote.endpoints, previous },
    { timeout: 10000, polling: 50 },
  );
  const selected = await handle.jsonValue();
  await handle.dispose();
  if (!selected.relayToRelay)
    throw new ProbeError("Selected WebRTC candidates were not both relays");
  if (selected.relayProtocol !== null && selected.relayProtocol !== protocol)
    throw new ProbeError(
      "Selected TURN client protocol did not match requested transport",
    );
  return selected;
}

async function sendBurst(page, id, from, observingRevocation = false) {
  const attempted = await page.evaluate(
    ({ id, from, count, bytes }) => {
      const { channel } = window.turnProbes[id];
      if (channel.readyState !== "open") return false;
      const body = "x".repeat(bytes);
      for (let sequence = from; sequence < from + count; sequence++)
        channel.send(`${sequence}:${body}`);
      return true;
    },
    { id, from, count: BURST, bytes: CONTROL_BYTES },
  );
  if (!attempted) {
    if (observingRevocation) return 0;
    throw new ProbeError("TURN channel closed before the send");
  }
  try {
    const handle = await page.waitForFunction(
      ({ id, last }) => {
        const probe = window.turnProbes[id];
        return !probe.healthy() || probe.receipts.length >= last;
      },
      { id, last: from + BURST - 1 },
      { timeout: 8000 },
    );
    await handle.dispose();
  } catch (error) {
    if (!observingRevocation || error.name !== "TimeoutError") throw error;
  }
  const { healthy, received } = await page.evaluate(
    ({ id, from }) => {
      const probe = window.turnProbes[id];
      return {
        healthy: probe.healthy(),
        received: probe.receipts.length - from + 1,
      };
    },
    { id, from },
  );
  if (!healthy || received < 0 || received > BURST)
    throw new ProbeError("TURN channel returned invalid receipts");
  return received;
}

async function runPair(provider, host, guest, protocol, id, delayedReceipts) {
  const start = performance.now();
  const hostGrant = await provider.issue(protocol);
  const guestGrant = await provider.issue(protocol);
  await Promise.all([
    host.evaluate(installTurnProbe, {
      iceServer: hostGrant,
      channelId: id,
      receiptDelayMs: null,
    }),
    guest.evaluate(installTurnProbe, {
      iceServer: guestGrant,
      channelId: id,
      receiptDelayMs: delayedReceipts ? 1200 : 0,
    }),
  ]);
  const initialSignal = await exchangeDescriptions(host, guest, id, false);
  const initial = await Promise.all([
    confirmRelayPair(
      host,
      id,
      protocol,
      initialSignal.offer,
      initialSignal.answer,
    ),
    confirmRelayPair(
      guest,
      id,
      protocol,
      initialSignal.answer,
      initialSignal.offer,
    ),
  ]);
  const setupMs = Math.round(performance.now() - start);
  const burst = performance.now();
  await sendBurst(host, id, 1);
  const receiptMs = Math.round(performance.now() - burst);

  const restartStart = performance.now();
  const newHostGrant = await provider.issue(protocol);
  const newGuestGrant = await provider.issue(protocol);
  await Promise.all(
    [
      [host, newHostGrant],
      [guest, newGuestGrant],
    ].map(([page, iceServer]) =>
      page.evaluate(
        ({ id, iceServer }) => {
          window.turnProbes[id].peer.setConfiguration({
            iceServers: [iceServer],
            iceTransportPolicy: "relay",
          });
        },
        { id, iceServer },
      ),
    ),
  );
  const restartSignal = await exchangeDescriptions(host, guest, id, true);
  if (
    restartSignal.offer.fragment === initialSignal.offer.fragment ||
    restartSignal.answer.fragment === initialSignal.answer.fragment
  )
    throw new ProbeError("ICE username fragment did not rotate on both peers");
  const restarted = await Promise.all([
    confirmRelayPair(
      host,
      id,
      protocol,
      restartSignal.offer,
      restartSignal.answer,
      initial[0],
    ),
    confirmRelayPair(
      guest,
      id,
      protocol,
      restartSignal.answer,
      restartSignal.offer,
      initial[1],
    ),
  ]);
  const restartMs = Math.round(performance.now() - restartStart);
  await sendBurst(host, id, BURST + 1);
  const pairBytesReceived = await Promise.all(
    [host, guest].map((page) =>
      page.evaluate(
        async (id) =>
          (await window.turnProbes[id].selectedPair())?.bytesReceived ?? null,
        id,
      ),
    ),
  );

  const revocation = await Promise.allSettled(
    [hostGrant, guestGrant, newHostGrant, newGuestGrant].map(({ username }) =>
      provider.revoke(username),
    ),
  );
  if (revocation.some(({ status }) => status === "rejected"))
    throw new ProbeError("Cloudflare did not confirm a credential revocation");

  // A successful revoke API response does not by itself establish a live-traffic cutoff.
  const revokedAt = performance.now();
  await delay(1000);
  const receiptsAfterRevocation = await sendBurst(
    host,
    id,
    2 * BURST + 1,
    true,
  );
  const guestReceivedAfterRevocation = await guest.evaluate(
    ({ id, before }) => window.turnProbes[id].received() - before,
    { id, before: 2 * BURST },
  );
  if (
    guestReceivedAfterRevocation < receiptsAfterRevocation ||
    guestReceivedAfterRevocation > BURST
  )
    throw new ProbeError(
      "TURN channel returned inconsistent post-revocation counts",
    );
  const revocationObservationMs = Math.round(performance.now() - revokedAt);
  await Promise.all(
    [host, guest].map((page) =>
      page.evaluate((id) => {
        window.turnProbes[id].peer.close();
        delete window.turnProbes[id];
      }, id),
    ),
  );
  return {
    protocol,
    delayedReceipts,
    setupMs,
    receiptMs,
    restartMs,
    pairBytesReceived,
    beforeAndAfterRelayPairs: [...initial, ...restarted].every(
      (pair) => pair.relayToRelay,
    ),
    localRelayProtocols: [...initial, ...restarted].map(
      (pair) => pair.relayProtocol,
    ),
    guestReceivedAfterRevocation,
    receiptsAfterRevocation,
    revocationObservationMs,
  };
}

async function main() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const keyToken = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
  if (
    !/^[a-f0-9]{32}$/i.test(keyId ?? "") ||
    !/^[a-zA-Z0-9_-]{64}$/.test(keyToken ?? "")
  )
    throw new ProbeError(
      "Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN from a dedicated test key",
    );
  const engines = (
    process.env.ELECTRIFY_TURN_BROWSERS || "chromium,chromium,chromium,chromium"
  ).split(",");
  if (
    engines.length !== 4 ||
    engines.some((engine) => !ENGINES.includes(engine))
  )
    throw new ProbeError(
      "ELECTRIFY_TURN_BROWSERS must select four chromium, firefox or webkit browsers",
    );
  const transport = process.env.ELECTRIFY_TURN_TRANSPORT ?? "both";
  if (transport !== "both" && !Object.hasOwn(PROTOCOLS, transport))
    throw new ProbeError("ELECTRIFY_TURN_TRANSPORT must be both, udp or tls");
  const protocols = transport === "both" ? Object.keys(PROTOCOLS) : [transport];
  const playwright = require("@playwright/test");
  const browsers = new Map();
  let stopping = false;
  const provider = cloudflare(keyId, keyToken, () => stopping);
  const closeBrowsers = () =>
    Promise.allSettled(
      [...browsers.values()].map((browser) => browser.close()),
    );
  function stop(signal) {
    stopping = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void closeBrowsers();
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let step = "browser startup";
  try {
    for (const engine of new Set(engines)) {
      browsers.set(
        engine,
        await playwright[engine].launch({ headless: true, timeout: 10000 }),
      );
      if (stopping) return;
    }
    const [host, ...guests] = await Promise.all(
      engines.map((engine) => openBrowserPage(browsers.get(engine))),
    );
    for (const protocol of protocols) {
      step = `${protocol}: browser relay pairs`;
      const results = await Promise.allSettled(
        guests.map((guest, index) =>
          runPair(provider, host, guest, protocol, index, index === 2),
        ),
      );
      for (const [index, result] of results.entries()) {
        const participants = {
          host: engines[0],
          guest: engines[index + 1],
          seat: index + 2,
        };
        if (result.status === "fulfilled")
          process.stdout.write(
            JSON.stringify({ ...participants, ...result.value }) + "\n",
          );
        else
          console.error(
            JSON.stringify({
              ...participants,
              protocol,
              error:
                result.reason instanceof ProbeError
                  ? result.reason.message
                  : "probe failed or timed out",
            }),
          );
      }
      if (stopping) break;
      if (results.some(({ status }) => status === "rejected")) {
        process.exitCode = 1;
        break; // Close browsers and clean up this mode before any further issuance.
      }
    }
  } catch (error) {
    if (stopping) return;
    // Playwright call logs and provider payloads may contain SDP or credentials.
    throw new ProbeError(
      `${step}: ${error instanceof ProbeError ? error.message : "probe failed or timed out"}`,
    );
  } finally {
    try {
      await closeBrowsers();
      await provider.cleanup();
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof ProbeError
        ? error.message
        : "Cloudflare TURN probe failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { inspectDescription };
