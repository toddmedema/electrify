const { createHmac } = require("node:crypto");
const { isIP } = require("node:net");
const { CrossplayError, requireValue } = require("./crossplay-errors.cjs");
const { createIdentity, keys } = require("./crossplay-identity.cjs");
const { createRooms } = require("./crossplay-rooms.cjs");

const OPERATIONS = /^[a-z]+\/[a-z]+(?:-[a-z]+)*$/;
const WINDOW_MS = 60_000;
const JSON_LIMIT = 128 * 1024;
const TRANSFER_LIMIT = 8 * 1024 * 1024 + 4096;
const BULK_OPERATIONS = new Set([
  "save/read",
  "save/download",
  "save/publish",
  "transfer/get",
  "transfer/put",
]);
const AUDIT = new Set([
  "auth/revoke",
  "room/approve",
  "room/reconnect",
  "room/remove",
  "room/rotate-invite",
  "room/withdraw",
  "save/publish",
]);

function operationName(path) {
  if (!path?.startsWith("/")) return "";
  return path.slice(1);
}

function createCrossplay({
  store,
  verifyGoogle,
  verifySteam,
  origins,
  quotaKey,
  extensions,
  isStopped = async () => false,
  healthy = async () => true,
  onRoomChanged,
  audit = () => undefined,
  clock = Date.now,
}) {
  requireValue(quotaKey?.length >= 24, 503, "unavailable");
  const identity = createIdentity({ store, verifyGoogle, verifySteam, clock });
  const rooms = createRooms({ store, extensions, onRoomChanged });

  function hashedIp(request) {
    // The direct network address cannot be selected using attacker-supplied
    // X-Forwarded-For values. An ingress may group its requests into one bucket.
    const address = request.socket?.remoteAddress;
    const ip = isIP(address) ? address : "unknown";
    return createHmac("sha256", quotaKey).update(ip).digest("hex");
  }

  function limit(scope, value, max) {
    const now = clock();
    const window = Math.floor(now / WINDOW_MS);
    return store
      .consume([
        {
          id: `${scope}-${value}-${window}`,
          max,
          expiresAt: (window + 2) * WINDOW_MS,
        },
      ])
      .then((accepted) => {
        requireValue(accepted, 429, "rate_limited");
      });
  }

  async function handle(request, response) {
    response.set("Cache-Control", "no-store");
    response.set("Referrer-Policy", "no-referrer");
    response.set("X-Content-Type-Options", "nosniff");
    const operation = operationName(request.path);
    const origin = request.get("origin");
    try {
      if (origin) {
        requireValue(origins.includes(origin), 403, "forbidden");
        response.set("Access-Control-Allow-Origin", origin);
        response.set("Vary", "Origin");
      }
      if (request.method === "OPTIONS" && origin) {
        requireValue(OPERATIONS.test(operation), 404, "not_found");
        response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        response.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        response.status(204).end();
        return;
      }
      if (request.method === "GET" && operation === "healthz") {
        requireValue(
          !(await isStopped()) && (await healthy()),
          503,
          "unavailable",
        );
        response.status(200).json({ status: "ok" });
        return;
      }
      requireValue(request.method === "POST", 405, "method_not_allowed");
      requireValue(
        OPERATIONS.test(operation) && !request.originalUrl?.includes("?"),
        404,
        "not_found",
      );
      requireValue(
        /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.get("content-type") ?? "",
        ),
        415,
        "invalid_request",
      );
      const bulk = /^(save|transfer)\//.test(operation);
      requireValue(!bulk || BULK_OPERATIONS.has(operation), 404, "not_found");
      const maxBytes = bulk ? TRANSFER_LIMIT : JSON_LIMIT;
      requireValue(
        Buffer.isBuffer(request.rawBody) && request.rawBody.length <= maxBytes,
        413,
        "payload_too_large",
      );
      requireValue(!(await isStopped()), 503, "unavailable");
      const exchange =
        operation === "auth/google" || operation === "auth/steam";
      const authorization = request.get("authorization");
      const actor = exchange ? undefined : await identity.auth(authorization);
      if (actor && bulk) await limit("bulk", actor.account, 20);
      let requestBody;
      try {
        requestBody = JSON.parse(request.rawBody.toString("utf8"));
      } catch {
        throw new CrossplayError(400, "invalid_request");
      }

      let result;
      if (exchange) {
        const provider = operation.slice(5);
        requireValue(
          provider === "google" ? !!origin : !origin,
          403,
          "forbidden",
        );
        await limit("auth-ip", hashedIp(request), 128);
        result = await identity.exchange(
          provider,
          requestBody,
          limit,
          authorization,
        );
      } else {
        if (operation === "auth/revoke") {
          keys(requestBody);
          await store.revoke(actor.account, actor.tokenHash);
          await onRoomChanged?.();
          result = {};
        } else {
          await limit("account", actor.account, 240);
          if (operation === "room/join")
            await limit("join-ip", hashedIp(request), 80);
          result = await rooms.handle(operation, actor, requestBody, limit);
          if (bulk && operation !== "save/publish") {
            requireValue(
              !response.destroyed && !(await isStopped()),
              503,
              "unavailable",
            );
            await identity.auth(authorization);
          }
        }
      }
      if (AUDIT.has(operation)) audit({ operation, status: 200 });
      response.status(200).json(result);
    } catch (error) {
      const expected = error instanceof CrossplayError;
      const status = expected ? error.status : 503;
      if (status >= 500 || status === 429 || AUDIT.has(operation))
        audit({
          operation: AUDIT.has(operation) ? operation : "request",
          status,
        });
      response
        .status(status)
        .json({ error: expected ? error.code : "unavailable" });
    }
  }

  return { handle, loadRoom: rooms.loadRoom };
}

module.exports = { createCrossplay, JSON_LIMIT, TRANSFER_LIMIT };
