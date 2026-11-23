const { randomBytes } = require("node:crypto");
const { trustedSender } = require("./runtime.cjs");
const {
  CrossplayApiError,
  SESSION_REFRESH_MS,
  crossplayPost,
  crossplayTransfer,
  crossplayUserAction,
  parseCrossplaySession,
} = require("../src/multiplayer/CrossplayHttp.js");

const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const requestId = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const text = (maximum) => (value) =>
  typeof value === "string" && value.length <= maximum;
const list = (value) =>
  Array.isArray(value) && value.length <= 4 && value.every(id);
const flag = (value) => typeof value === "boolean";
const invite = (value) =>
  typeof value === "string" &&
  (/^[a-f0-9]{20}$/i.test(value) || /^[A-Za-z0-9_-]{22}$/.test(value));

function shape(value, required, optional = {}) {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(
      (key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key),
    ) &&
    Object.entries(required).every(([key, check]) => check(value[key])) &&
    Object.entries(optional).every(
      ([key, check]) => !Object.hasOwn(value, key) || check(value[key]),
    )
  );
}

const values = (choices) => (value) => choices.includes(value);
const room = { roomId: id };
const pair = { ...room, to: id, generation: id };
const encoded = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= Math.ceil((8 * 1024 * 1024) / 3) * 4 &&
  value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]*={0,2}$/.test(value);
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const description = (value) =>
  shape(value, {
    type: values(["offer", "answer"]),
    sdp: (sdp) =>
      typeof sdp === "string" &&
      sdp.length <= 16_384 &&
      /^[\x20-\x7e\r\n]+$/.test(sdp),
  });
const REQUESTS = {
  "room/create": [{ rules: id, name: text(64) }],
  "room/join": [{ rules: id, invite, name: text(64) }],
  "room/state": [room],
  "room/list": [{}],
  "room/reconnect": [{ ...room, rules: id }],
  "room/member": [
    { ...room, key: values(["ready", "slot"]), value: text(512) },
  ],
  "room/lock": [{ ...room, ids: list, requiredIds: list }],
  "room/unlock": [room],
  "room/leave": [room],
  "room/suspend": [room],
  "room/withdraw": [room],
  "room/approve": [{ ...room, requestId: id, approve: flag }],
  "room/rotate-invite": [room],
  "room/remove": [{ ...room, seatId: id }],
  "signal/read": [room],
  "signal/describe": [{ ...pair, description }],
  "signal/turn": [pair],
  "signal/reset": [pair],
  "save/read": [room],
  "save/publish": [
    { ...room, content: encoded, digest, explicit: flag },
    { name: text(72) },
  ],
  "transfer/put": [{ ...pair, epoch: id, content: encoded, digest }],
  "transfer/get": [{ ...pair, epoch: id, reference: id }],
};

function validateCrossplayRequest(operation, value) {
  if (typeof operation !== "string" || !Object.hasOwn(REQUESTS, operation))
    return false;
  return shape(value, ...REQUESTS[operation]);
}

function trustedCrossplaySender(event, window) {
  return (
    !!trustedSender(event, window) &&
    new URL(event.senderFrame.url).pathname === "/index.html"
  );
}

/** Authentication exchanges are internal. Their result is never forwarded to the renderer. */
function createSteamCrossplayApi({
  online,
  withTicket,
  fetcher,
  now = Date.now,
}) {
  const device = randomBytes(32).toString("base64url");
  let session;
  let fenced = false;
  let renewing;
  let closing = false;
  let renewalAbort;
  let sessionGeneration = 0;
  let flight = 0;
  let transferPending = false;
  const pending = new Map();
  let available = 24;
  let lastDebit = now();
  const revoke = (token) =>
    crossplayPost("auth/revoke", {}, { token, fetcher, timeoutMs: 2000 }).catch(
      () => undefined,
    );

  async function reset() {
    const token = session?.token;
    if (session || renewing) fenced = true;
    session = undefined;
    sessionGeneration++;
    renewalAbort?.abort();
    for (const request of pending.values()) request.abort();
    if (token) await revoke(token);
  }

  async function authorize(operation, userAction) {
    if (fenced && !(userAction && crossplayUserAction(operation)))
      throw new CrossplayApiError("unauthenticated");
    if (session && session.expiresAt - now() > SESSION_REFRESH_MS)
      return session.token;
    if (renewing) return renewing;

    const generation = sessionGeneration;
    const priorToken = session?.token;
    renewalAbort = new AbortController();
    const signal = renewalAbort.signal;
    renewing = withTicket(async (ticket) => {
      const next = parseCrossplaySession(
        await crossplayPost(
          "auth/steam",
          { ticket, device },
          { fetcher, signal, token: priorToken },
        ),
      );
      if (closing || !online() || generation !== sessionGeneration) {
        void revoke(next.token);
        throw new CrossplayApiError("unauthenticated");
      }
      session = next;
      fenced = false;
      return next.token;
    }, signal);
    try {
      return await renewing;
    } catch (error) {
      if (
        error instanceof CrossplayApiError &&
        error.code === "unauthenticated"
      ) {
        session = undefined;
        fenced = true;
      }
      throw error;
    } finally {
      renewalAbort = undefined;
      renewing = undefined;
    }
  }

  return {
    async request(operation, body, id, userAction) {
      if (
        !requestId(id) ||
        pending.has(id) ||
        typeof userAction !== "boolean" ||
        typeof operation !== "string" ||
        !Object.hasOwn(REQUESTS, operation)
      )
        return { ok: false, code: "invalid_request" };
      if (closing || !online()) {
        if (session || renewing) void reset();
        return { ok: false, code: "unauthenticated" };
      }
      const transfer = crossplayTransfer(operation);
      const current = now();
      available = Math.min(
        24,
        available + Math.max(0, current - lastDebit) / 80,
      );
      lastDebit = current;
      if (available < 1 || flight >= 6 || (transfer && transferPending))
        return { ok: false, code: "rate_limited" };
      available--;
      flight++;
      if (transfer) transferPending = true;
      const controller = new AbortController();
      pending.set(id, controller);
      let token;
      try {
        if (!validateCrossplayRequest(operation, body))
          return { ok: false, code: "invalid_request" };
        token = await authorize(operation, userAction);
        const value = await crossplayPost(operation, body, {
          token,
          fetcher,
          transfer,
          signal: controller.signal,
        });
        if (closing || !online())
          throw new CrossplayApiError("unauthenticated");
        return { ok: true, value };
      } catch (error) {
        const code =
          error instanceof CrossplayApiError ? error.code : "unavailable";
        if (
          code === "unauthenticated" &&
          token &&
          session?.token === token &&
          !renewing
        ) {
          session = undefined;
          fenced = true;
        }
        return { ok: false, code };
      } finally {
        pending.delete(id);
        flight--;
        if (transfer) transferPending = false;
      }
    },
    cancel(id) {
      if (requestId(id)) pending.get(id)?.abort();
    },
    reset,
    async dispose() {
      closing = true;
      await Promise.all([reset(), renewing?.catch(() => undefined)]);
    },
  };
}
module.exports = {
  createSteamCrossplayApi,
  trustedCrossplaySender,
  validateCrossplayRequest,
};
