const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { CrossplayError, requireValue } = require("./crossplay-errors.cjs");

const SESSION_MS = 5 * 60_000;
const STEAM_TICKET_IDENTITY = "electrify-coop-prod-v2";
const DEVICE = /^[A-Za-z0-9_-]{43}$/;
const INVALID_GOOGLE_PROOF = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);
const BEARER = /^Bearer ([a-f0-9]{64}\.[A-Za-z0-9_-]{43})$/;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function sameSecret(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function keys(input, ...names) {
  requireValue(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).length === names.length &&
      names.every((name) => Object.hasOwn(input, name)),
  );
}

function text(value, max) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/\p{Cc}/u.test(value)
  );
}

async function steamUser(ticket, { appId, publisherKey, fetchImpl = fetch }) {
  requireValue(/^\d{1,10}$/.test(appId) && publisherKey, 503, "unavailable");
  const parameters = new URLSearchParams({
    appid: appId,
    ticket,
    identity: STEAM_TICKET_IDENTITY,
  });
  // Steam requires a publisher key; the endpoint accepts it as an HTTP header.
  const response = await fetchImpl(
    `https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?${parameters}`,
    {
      headers: { "x-webapi-key": publisherKey },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  requireValue(response.ok || response.status === 400, 503, "unavailable");
  const params = (await response.json()).response?.params;
  requireValue(
    params?.result === "OK" &&
      /^\d{17}$/.test(params.steamid) &&
      params.vacbanned === false &&
      params.publisherbanned === false,
    401,
    "unauthenticated",
  );
  return params.steamid;
}

function createIdentity({ store, verifyGoogle, verifySteam, clock }) {
  return {
    async exchange(provider, input, limit, authorization) {
      const startedAt = clock();
      let externalId;
      let ticketDigest;
      keys(input, provider === "google" ? "token" : "ticket", "device");
      requireValue(
        typeof input.device === "string" && DEVICE.test(input.device),
      );
      if (provider === "google") {
        requireValue(text(input.token, 8_192));
        await limit("google-proof", "global", 480);
        let decoded;
        try {
          decoded = await verifyGoogle(input.token);
        } catch (error) {
          if (!INVALID_GOOGLE_PROOF.has(error?.code)) throw error;
          throw new CrossplayError(401, "unauthenticated");
        }
        requireValue(
          decoded?.firebase?.sign_in_provider === "google.com" &&
            text(decoded.uid, 128),
          401,
          "unauthenticated",
        );
        externalId = decoded.uid;
      } else {
        requireValue(typeof verifySteam === "function", 503, "unavailable");
        requireValue(
          typeof input.ticket === "string" &&
            /^(?:[a-f0-9]{2}){16,2048}$/i.test(input.ticket),
        );
        await limit("steam-proof", "global", 480);
        const ticket = input.ticket.toLowerCase();
        ticketDigest = hash(ticket);
        requireValue(
          await store.consumeTicket(ticketDigest, startedAt),
          401,
          "unauthenticated",
        );
        externalId = await verifySteam(ticket);
      }
      const account = hash(`${provider}:${externalId}`);
      let priorTokenHash;
      if (authorization !== undefined) {
        const prior = BEARER.exec(authorization)?.[1];
        requireValue(prior?.startsWith(`${account}.`), 401, "unauthenticated");
        priorTokenHash = hash(prior);
      }
      await limit("account-proof", account, 12);
      const token = `${account}.${randomSecret(32)}`;
      const now = clock();
      const expiresAt = now + SESSION_MS;
      const binding = await store.issue(
        account,
        {
          binding: randomSecret(18),
          deviceHash: hash(input.device),
          tokenHash: hash(token),
          startedAt,
          expiresAt,
          priorTokenHash,
          ticketDigest,
        },
        now,
      );
      requireValue(binding, 401, "unauthenticated");
      return { token, expiresAt };
    },
    async auth(header) {
      requireValue(typeof header === "string", 401, "unauthenticated");
      const match = BEARER.exec(header);
      requireValue(match, 401, "unauthenticated");
      const token = match[1];
      const account = token.split(".")[0];
      const data = await store.account(account);
      const tokenHash = hash(token);
      requireValue(
        data?.expiresAt > clock() &&
          !data.revoked &&
          !data.banned &&
          sameSecret(data.tokenHash, tokenHash),
        401,
        "unauthenticated",
      );
      return { account, binding: data.binding, tokenHash };
    },
  };
}

module.exports = {
  createIdentity,
  hash,
  keys,
  randomSecret,
  sameSecret,
  steamUser,
  text,
  STEAM_TICKET_IDENTITY,
};
