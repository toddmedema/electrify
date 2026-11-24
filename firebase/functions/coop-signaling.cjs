const { createHash, randomUUID } = require("node:crypto");
const { CrossplayError } = require("./crossplay-errors.cjs");
const { validateDescription } = require("./coop-signaling-sdp.cjs");

const TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
const UDP = "turn:turn.cloudflare.com:3478";
const TLS = "turns:turn.cloudflare.com:443";
const MAX_GRANTS = 120;
// Split capacity between two live rooms, then between three host/guest pairs.
const MAX_ROOM_GRANTS = MAX_GRANTS / 2;
const MAX_PAIR_GRANTS = MAX_ROOM_GRANTS / 3;
const GENERATION_MS = 120_000;
const ALLOCATION_DRAIN_MS = 600_000;
const ROTATION_WINDOW_MS = 25_000;
const FAILED_GENERATION_MS = 15_000;
const IDENTIFIER = /^[\w-]{1,128}$/;
const CREDENTIAL = /^[a-zA-Z0-9._~+/=-]{1,256}$/;
const millis = (value) =>
  typeof value === "number" ? value : value?.toMillis();

function member(room, id) {
  return room.members.find((entry) => entry.id === id && entry.active);
}

function livePair(room, pair, now) {
  return !!(
    pair &&
    pair.epoch === room.epoch &&
    pair.hostId === room.hostId &&
    pair.hostBinding === member(room, pair.hostId)?.binding &&
    pair.guestBinding === member(room, pair.guestId)?.binding &&
    pair.expiresAt > now &&
    millis(room.leaseUntil) > now
  );
}

/** Transfer endpoints use the same fence as the SDP and credential operations. */
function activeSignalPair(room, seatId, to, generation, now) {
  if (seatId === to || (room.hostId !== seatId && room.hostId !== to))
    return null;
  const guestId = room.hostId === seatId ? to : seatId;
  const pair = room.signals?.[guestId];
  return pair?.generation === generation && livePair(room, pair, now)
    ? pair
    : null;
}

function buildPair(room, guest, now) {
  return {
    generation: randomUUID(),
    epoch: room.epoch,
    hostId: room.hostId,
    hostBinding: member(room, room.hostId).binding,
    guestId: guest.id,
    guestBinding: guest.binding,
    expiresAt: now + GENERATION_MS,
    createdAt: now,
  };
}

function presentPairs(room, seatId, now) {
  const host = member(room, room.hostId);
  if (!host || millis(room.leaseUntil) <= now) return {};
  const peers = room.members.filter(
    (entry) => entry.active && entry.id !== host.id,
  );
  const old = room.signals ?? {};
  return Object.fromEntries(
    peers
      .filter((guest) => seatId === host.id || guest.id === seatId)
      .map((guest) => [
        guest.id,
        livePair(room, old[guest.id], now)
          ? old[guest.id]
          : buildPair(room, guest, now),
      ]),
  );
}

function formatPairs(pairs, seatId, now) {
  return Object.values(pairs).map((pair) => ({
    peerId: seatId === pair.hostId ? pair.guestId : pair.hostId,
    generation: pair.generation,
    remainingMs: Math.max(0, pair.expiresAt - now),
    offer: pair.offer,
    answer: pair.answer,
  }));
}

function aborted() {
  return new CrossplayError(409, "obsolete-connection");
}

function credentialId(roomId, generation, seatId) {
  return createHash("sha256")
    .update(JSON.stringify([roomId, generation, seatId]))
    .digest("hex");
}

function createTurnSignaling({
  db,
  keyId,
  keyToken,
  loadRoom,
  fetchImpl = fetch,
  clock = Date.now,
}) {
  const configured =
    typeof keyId === "string" &&
    IDENTIFIER.test(keyId) &&
    typeof keyToken === "string" &&
    CREDENTIAL.test(keyToken);
  const grants = db.collection("coopTurnGrants");
  const operation = db.doc("coopOperations/turn");
  const runtime = db.doc("coopSettings/runtime");

  async function provider(path, status, body) {
    if (!configured) throw new CrossplayError(503, "turn-unavailable");
    const response = await fetchImpl(
      `${TURN_API}/${keyId}/credentials/${path}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${keyToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(6_000),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ).catch(() => null);
    if (!response || response.status !== status) {
      await response?.body?.cancel().catch(() => undefined);
      throw new CrossplayError(503, "turn-unavailable");
    }
    return response;
  }

  async function revoke(grant) {
    const data = grant.data();
    if (!data?.ice || data.revoked) return;
    await provider(`${encodeURIComponent(data.ice.username)}/revoke`, 204);
    await grant.ref.update({ revoked: true, ice: null });
  }

  async function revokeGeneration(roomId, pair) {
    const refs = [pair.hostId, pair.guestId].map((id) =>
      grants.doc(credentialId(roomId, pair.generation, id)),
    );
    const snapshots = await db.getAll(...refs);
    await Promise.allSettled(snapshots.map(revoke));
  }

  async function issue(context, pair, to) {
    if (!configured) throw new CrossplayError(503, "turn-unavailable");
    const { roomId, seatId } = context;
    const ref = grants.doc(credentialId(roomId, pair.generation, seatId));
    const now = clock();
    const ttl = Math.floor((pair.expiresAt - now) / 1_000);
    if (ttl < 10) throw aborted();
    const claimed = await db.runTransaction(async (transaction) => {
      const [control, existing, settings] = await transaction.getAll(
        operation,
        ref,
        runtime,
      );
      if (settings.data()?.stopped === true)
        throw new CrossplayError(503, "turn-unavailable");
      if (existing.exists) return { existing: existing.data() };
      const count = control.data()?.count ?? 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= MAX_GRANTS)
        throw new CrossplayError(429, "turn-capacity");
      const roomGrants = await transaction.get(
        grants.where("roomId", "==", roomId),
      );
      // Old seats retain their drain reservations even after the room admits new players.
      if (roomGrants.docs.length >= MAX_ROOM_GRANTS)
        throw new CrossplayError(429, "turn-capacity");
      const pairCount = roomGrants.docs.filter((snapshot) => {
        const grant = snapshot.data();
        return (
          (grant.seatId === seatId && grant.to === to) ||
          (grant.seatId === to && grant.to === seatId)
        );
      }).length;
      if (pairCount >= MAX_PAIR_GRANTS)
        throw new CrossplayError(429, "turn-capacity");
      transaction.set(operation, { count: count + 1 }, { merge: true });
      transaction.create(ref, {
        roomId,
        seatId,
        to,
        generation: pair.generation,
        expiresAt: pair.expiresAt,
        removeAfter: pair.expiresAt + ALLOCATION_DRAIN_MS,
      });
      return {};
    });
    let ice = claimed.existing?.ice;
    if (!claimed.existing) {
      // The reservation survives provider timeouts, so an ambiguous issuance cannot be retried.
      const response = await provider("generate-ice-servers", 201, { ttl });
      const { iceServers } = await response.json();
      const server =
        Array.isArray(iceServers) &&
        iceServers.find(
          (entry) =>
            Array.isArray(entry?.urls) &&
            entry.urls.includes(`${UDP}?transport=udp`) &&
            entry.urls.includes(`${TLS}?transport=tcp`) &&
            typeof entry.username === "string" &&
            CREDENTIAL.test(entry.username) &&
            typeof entry.credential === "string" &&
            CREDENTIAL.test(entry.credential),
        );
      if (!server) throw new CrossplayError(503, "turn-unavailable");
      ice = {
        urls: [UDP, TLS],
        username: server.username,
        credential: server.credential,
      };
      try {
        await ref.update({ ice });
      } catch (error) {
        await provider(`${encodeURIComponent(ice.username)}/revoke`, 204).catch(
          () => undefined,
        );
        throw error;
      }
    }
    if (!ice || claimed.existing?.revoked)
      throw new CrossplayError(409, "turn-pending");
    try {
      await context.updateRoom(
        (_room, now, projected) => {
          if (!activeSignalPair(projected, seatId, to, pair.generation, now))
            throw aborted();
          return { value: undefined };
        },
        { type: "active", peerId: to },
      );
      if ((await runtime.get()).data()?.stopped === true) throw aborted();
    } catch (error) {
      if (
        error instanceof CrossplayError &&
        error.code === "obsolete-connection"
      )
        await revoke(await ref.get()).catch(() => undefined);
      throw error;
    }
    return {
      iceServers: [ice],
      remainingMs: Math.max(0, pair.expiresAt - clock()),
    };
  }

  async function handle(name, context, body) {
    const { roomId, seatId } = context;
    if (name === "signal/read") {
      const { pairs, at } = await context.updateRoom((room, now, projected) => {
        const pairs = presentPairs(projected, seatId, now);
        const old = room.signals ?? {};
        const next = Object.fromEntries(
          Object.entries(old).filter(([, pair]) =>
            livePair(projected, pair, now),
          ),
        );
        Object.assign(next, pairs);
        const obsolete = Object.values(old).filter(
          (pair) => next[pair.guestId]?.generation !== pair.generation,
        );
        const changed =
          obsolete.length ||
          Object.keys(next).some((id) => next[id] !== old[id]);
        return {
          ...(changed ? { room: { ...room, signals: next } } : {}),
          value: { pairs, at: now },
        };
      });
      // The scheduled reaper revokes obsolete generations independently of confirmations.
      return { pairs: formatPairs(pairs, seatId, at) };
    }

    const { to, generation } = body;
    if (
      typeof to !== "string" ||
      typeof generation !== "string" ||
      !IDENTIFIER.test(to) ||
      !IDENTIFIER.test(generation)
    )
      throw new CrossplayError(400, "invalid-signaling");
    const result = await context.updateRoom(
      (room, now, projected) => {
        const pair = activeSignalPair(projected, seatId, to, generation, now);
        if (!pair) throw aborted();
        if (name === "signal/turn") return { value: pair };
        if (name === "signal/reset") {
          const deadline =
            pair.offer && pair.answer
              ? pair.createdAt + ROTATION_WINDOW_MS
              : pair.createdAt + FAILED_GENERATION_MS;
          if (now < deadline)
            throw new CrossplayError(429, "turn-rotation-limit");
          return {
            room: {
              ...room,
              signals: {
                ...room.signals,
                [pair.guestId]: buildPair(
                  projected,
                  member(projected, pair.guestId),
                  now,
                ),
              },
            },
            value: pair,
          };
        }
        if (name !== "signal/describe")
          throw new CrossplayError(404, "unknown-operation");
        const type = seatId === pair.hostId ? "offer" : "answer";
        const description = validateDescription(body.description, type);
        if (!description || (type === "answer" && !pair.offer))
          throw new CrossplayError(400, "invalid-signaling");
        if (pair[type]) {
          if (pair[type].sdp !== description.sdp) throw aborted();
          return { value: null };
        }
        return {
          room: {
            ...room,
            signals: {
              ...room.signals,
              [pair.guestId]: { ...pair, [type]: description },
            },
          },
          value: null,
        };
      },
      { type: "active", peerId: to },
    );
    if (name === "signal/turn") return issue(context, result, to);
    if (name === "signal/reset")
      await revokeGeneration(roomId, result).catch(() => undefined);
    return {};
  }

  /** Scheduled cleanup also reaches grants from replaced sessions and expired host leases. */
  async function reap({ all = false } = {}) {
    const settings = await runtime.get();
    const stop = all || settings.data()?.stopped === true;
    const snapshots = await grants.limit(MAX_GRANTS).get();
    const rooms = new Map();
    let failures = 0;
    for (let index = 0; index < snapshots.docs.length; index += 8) {
      const results = await Promise.allSettled(
        snapshots.docs.slice(index, index + 8).map(async (snapshot) => {
          const grant = snapshot.data();
          const now = clock();
          if (grant.removeAfter > now) {
            if (!stop && !rooms.has(grant.roomId))
              rooms.set(grant.roomId, loadRoom(grant.roomId));
            const room = stop ? undefined : await rooms.get(grant.roomId);
            if (
              (stop ||
                !room ||
                !activeSignalPair(
                  room,
                  grant.seatId,
                  grant.to,
                  grant.generation,
                  now,
                )) &&
              grant.ice &&
              !grant.revoked
            ) {
              await revoke(snapshot);
            }
            return;
          }
          await db.runTransaction(async (transaction) => {
            const [latest, count] = await transaction.getAll(
              snapshot.ref,
              operation,
            );
            if (!latest.exists || latest.data().removeAfter > clock()) return;
            transaction.delete(snapshot.ref);
            transaction.set(
              operation,
              { count: Math.max(0, (count.data()?.count ?? 0) - 1) },
              { merge: true },
            );
          });
        }),
      );
      failures += results.filter(
        (result) => result.status === "rejected",
      ).length;
    }
    if (failures) throw new Error("TURN grant cleanup needs retry");
  }

  return { handle, reap, configured };
}

module.exports = { activeSignalPair, createTurnSignaling };
