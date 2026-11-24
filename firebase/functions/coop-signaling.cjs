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
const GENERATION_MS = 140_000;
const ALLOCATION_DRAIN_MS = 600_000;
// Prepare during the last 56 seconds so the successor is up 36 seconds before the
// previous 120-second mark, with 20 seconds of credential grace for the drain.
const PREPARE_WINDOW_MS = 56_000;
const ROTATION_WINDOW_MS = 25_000;
const FAILED_GENERATION_MS = 15_000;
const RENEGOTIATE_MS = 10_000;
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
  return (
    [pair, pair?.successor].find(
      (candidate) =>
        candidate?.generation === generation && livePair(room, candidate, now),
    ) ?? null
  );
}

function currentPair(room, pair, now) {
  const successor = pair?.successor;
  const liveSuccessor = livePair(room, successor, now);
  if (!livePair(room, pair, now)) return liveSuccessor ? successor : undefined;
  if (!successor || liveSuccessor) return pair;
  const { successor: _expired, ...current } = pair;
  return current;
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

function presentPairs(room, seatId, now, current) {
  const host = member(room, room.hostId);
  if (!host || millis(room.leaseUntil) <= now) return {};
  const peers = room.members.filter(
    (entry) => entry.active && entry.id !== host.id,
  );
  return Object.fromEntries(
    peers
      .filter((guest) => seatId === host.id || guest.id === seatId)
      .map((guest) => [
        guest.id,
        current[guest.id] ?? buildPair(room, guest, now),
      ]),
  );
}

function formatPairs(pairs, seatId, now) {
  const format = (pair) => ({
    generation: pair.generation,
    remainingMs: Math.max(0, pair.expiresAt - now),
    offer: pair.offer,
    answer: pair.answer,
  });
  return Object.values(pairs).map((pair) => ({
    peerId: seatId === pair.hostId ? pair.guestId : pair.hostId,
    ...format(pair),
    ...(pair.successor && { successor: format(pair.successor) }),
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
  relayPolicy = null,
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

  /** A definite provider refusal never created a credential, so it must not occupy the cap. */
  async function releaseReservation(ref) {
    await db.runTransaction(async (transaction) => {
      const [latest, count] = await transaction.getAll(ref, operation);
      if (!latest.exists || latest.data()?.ice) return;
      transaction.delete(ref);
      transaction.set(
        operation,
        { count: Math.max(0, (count.data()?.count ?? 1) - 1) },
        { merge: true },
      );
    });
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
      // A timeout can hide a credential Cloudflare already created. An HTTP refusal cannot.
      let response;
      try {
        response = await fetchImpl(
          `${TURN_API}/${keyId}/credentials/generate-ice-servers`,
          {
            method: "POST",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${keyToken}`,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(6_000),
            body: JSON.stringify({ ttl }),
          },
        );
      } catch {
        throw new CrossplayError(503, "turn-unavailable");
      }
      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        await releaseReservation(ref).catch(() => undefined);
        throw new CrossplayError(503, "turn-unavailable");
      }
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
        const old = room.signals ?? {};
        const next = Object.fromEntries(
          Object.values(old).flatMap((pair) => {
            const current = currentPair(projected, pair, now);
            return current ? [[current.guestId, current]] : [];
          }),
        );
        const pairs = presentPairs(projected, seatId, now, next);
        Object.assign(next, pairs);
        const changed =
          Object.keys(next).length !== Object.keys(old).length ||
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
        const current = currentPair(
          projected,
          room.signals?.[pair.guestId],
          now,
        );
        const isCurrent = current.generation === pair.generation;
        const update = (next, value = null) => ({
          room: {
            ...room,
            signals: { ...room.signals, [pair.guestId]: next },
          },
          value,
        });
        const create = () =>
          buildPair(projected, member(projected, pair.guestId), now);
        if (name === "signal/prepare") {
          if (!isCurrent || !pair.offer || !pair.answer) throw aborted();
          if (current.successor) return { value: null };
          if (pair.expiresAt - now > PREPARE_WINDOW_MS)
            throw new CrossplayError(429, "turn-rotation-limit");
          return update({ ...current, successor: create() });
        }
        if (name === "signal/renegotiate") {
          if (
            pair.renegotiatedAt !== undefined &&
            now < pair.renegotiatedAt + RENEGOTIATE_MS
          )
            throw new CrossplayError(429, "turn-rotation-limit");
          const cleared = { ...pair, renegotiatedAt: now };
          delete cleared.offer;
          delete cleared.answer;
          delete cleared.drained;
          if (isCurrent) {
            const dropped = current.successor ? [current.successor] : [];
            delete cleared.successor;
            return update(cleared, dropped);
          }
          const retained = { ...current, successor: cleared };
          delete retained.drained;
          return update(retained);
        }
        if (name === "signal/drained") {
          // A vote after renegotiate must not complete the next handoff.
          if (!isCurrent || !current.offer || !current.answer)
            return { value: null };
          const drained = { ...(current.drained ?? {}), [seatId]: true };
          if (
            drained[current.hostId] &&
            drained[current.guestId] &&
            current.successor
          )
            return update(current.successor, [current]);
          return update({ ...current, drained });
        }
        if (name === "signal/reset") {
          const deadline =
            pair.offer && pair.answer
              ? pair.createdAt + ROTATION_WINDOW_MS
              : pair.createdAt + FAILED_GENERATION_MS;
          if (now < deadline)
            throw new CrossplayError(429, "turn-rotation-limit");
          // A failed successor can be replaced while the current channel is live.
          // A reset of the current channel abandons both ends of an in-flight handoff.
          return isCurrent
            ? update(create(), [pair, current.successor].filter(Boolean))
            : update({ ...current, successor: create() }, [pair]);
        }
        if (name !== "signal/describe")
          throw new CrossplayError(404, "unknown-operation");
        const type = seatId === pair.hostId ? "offer" : "answer";
        const description = validateDescription(
          body.description,
          type,
          relayPolicy,
        );
        if (!description || (type === "answer" && !pair.offer))
          throw new CrossplayError(400, "invalid-signaling");
        if (pair[type]) {
          if (pair[type].sdp !== description.sdp) throw aborted();
          return { value: null };
        }
        return update(
          isCurrent
            ? { ...current, [type]: description }
            : { ...current, successor: { ...pair, [type]: description } },
        );
      },
      { type: "active", peerId: to },
    );
    if (name === "signal/turn") return issue(context, result, to);
    if (Array.isArray(result))
      await Promise.allSettled(
        result.map((pair) => revokeGeneration(roomId, pair)),
      );
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
