const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { CrossplayError } = require("./crossplay-errors.cjs");

const COLLECTION = "coopRooms";
const WRITER_UID = "electrify-coop-authority-v2";
// Four players use six grants per generation. Allow space for routine renewal
// of both admitted rooms during the ten-minute grant drain and for a few retries.
const MAX_LIVE_ROOMS = 2;

function toMillis(value) {
  return value?.toMillis?.() ?? value ?? 0;
}

function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Timestamp)
    return { timestampValue: value.toDate().toISOString() };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(firestoreValue) } };
  switch (typeof value) {
    case "boolean":
      return { booleanValue: value };
    case "string":
      return { stringValue: value };
    case "number":
      return Number.isSafeInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case "object":
      return { mapValue: { fields: firestoreFields(value) } };
    default:
      throw new CrossplayError(500, "unavailable");
  }
}

function firestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([name, field]) => [name, firestoreValue(field)]),
  );
}

function version(snapshot) {
  const { seconds, nanoseconds } = snapshot.updateTime;
  const second = new Date(seconds * 1000).toISOString().slice(0, -5);
  return `${second}.${String(nanoseconds).padStart(9, "0")}Z`;
}

function createWriter({ auth, apiKey, fetchImpl = fetch, clock = Date.now }) {
  let cached;
  let pending;
  return async () => {
    if (cached?.expiresAt > clock() + 60_000) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const token = await auth.createCustomToken(WRITER_UID, {
        electrifyCoopWriter: 2,
      });
      if (!apiKey) throw new CrossplayError(503, "unavailable");
      const response = await fetchImpl(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, returnSecureToken: true }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new CrossplayError(503, "unavailable");
      const { idToken, expiresIn } = await response.json();
      if (!idToken || !Number.isFinite(Number(expiresIn)))
        throw new CrossplayError(503, "unavailable");
      cached = {
        token: idToken,
        expiresAt: clock() + Number(expiresIn) * 1000,
      };
      return idToken;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}

function createStore({ db, projectId, writerToken, fetchImpl = fetch }) {
  const accountRef = (id) => db.collection("coopAccounts").doc(id);
  const rooms = db.collection(COLLECTION);
  const usedTickets = db.collection("coopUsedSteamTickets");
  const accountData = (snapshot) => {
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    return { ...data, expiresAt: toMillis(data.expiresAt) };
  };
  const roomData = (snapshot) => ({
    snapshot,
    room: snapshot.exists ? snapshot.data().room : null,
    now: toMillis(snapshot.readTime),
  });
  return {
    async consume(quotas) {
      const refs = quotas.map(({ id }) => db.collection("coopLimits").doc(id));
      return db.runTransaction(async (tx) => {
        const counts = await tx.getAll(...refs);
        if (
          counts.some(
            (entry, index) => (entry.data()?.count ?? 0) >= quotas[index].max,
          )
        )
          return false;
        counts.forEach((entry, index) => {
          tx.set(entry.ref, {
            count: (entry.data()?.count ?? 0) + 1,
            deleteAt: Timestamp.fromMillis(quotas[index].expiresAt),
          });
        });
        return true;
      });
    },
    async consumeTicket(digest, now) {
      try {
        await usedTickets.doc(digest).create({
          consumedAt: Timestamp.fromMillis(now),
          deleteAt: Timestamp.fromMillis(now + 60 * 60_000),
        });
        return true;
      } catch (error) {
        if (error.code === 6) return false;
        throw error;
      }
    },
    async issue(account, issue, now) {
      const ref = accountRef(account);
      return db.runTransaction(async (tx) => {
        const previous = accountData(await tx.get(ref));
        if (previous?.banned || (previous?.issuedAt ?? 0) > issue.startedAt)
          return null;
        const retain =
          previous?.deviceHash === issue.deviceHash &&
          !previous.revoked &&
          (previous.expiresAt > now || issue.priorTokenHash !== undefined);
        if (
          issue.priorTokenHash !== undefined &&
          (!retain || previous.tokenHash !== issue.priorTokenHash)
        )
          return null;
        const binding = retain ? previous.binding : issue.binding;
        tx.set(ref, {
          deviceHash: issue.deviceHash,
          tokenHash: issue.tokenHash,
          binding,
          issuedAt: issue.startedAt,
          expiresAt: Timestamp.fromMillis(issue.expiresAt),
          revoked: false,
        });
        if (issue.ticketDigest) {
          // Keep accepted ticket hashes until Valve's maximum replay lifetime is
          // established. Unverified attempts expire after their short reservation.
          tx.update(usedTickets.doc(issue.ticketDigest), {
            deleteAt: FieldValue.delete(),
          });
        }
        return binding;
      });
    },
    async revoke(account, tokenHash) {
      const ref = accountRef(account);
      await db.runTransaction(async (tx) => {
        const current = accountData(await tx.get(ref));
        if (current?.tokenHash === tokenHash)
          tx.update(ref, { revoked: true, tokenHash: FieldValue.delete() });
      });
    },
    async account(id) {
      return accountData(await accountRef(id).get());
    },
    async accounts(ids) {
      if (!ids.length) return [];
      return (await db.getAll(...ids.map(accountRef))).map(accountData);
    },
    async reserveRoom(id, expiresAt, now) {
      const ref = db.collection("coopLimits").doc("active-rooms");
      return db.runTransaction(async (tx) => {
        const previous = (await tx.get(ref)).data()?.rooms ?? {};
        const next = Object.fromEntries(
          Object.entries(previous).filter(([, until]) => until > now),
        );
        if (!(id in next) && Object.keys(next).length >= MAX_LIVE_ROOMS)
          return false;
        next[id] = Math.max(next[id] ?? 0, expiresAt);
        tx.set(ref, { rooms: next });
        return true;
      });
    },
    async getRoom(id) {
      return roomData(await rooms.doc(id).get());
    },
    async findInvite(digest) {
      const result = await rooms
        .where("inviteHashes", "array-contains", digest)
        .limit(2)
        .get();
      return result.size === 1 ? roomData(result.docs[0]) : null;
    },
    async listRooms(account) {
      const result = await rooms
        .where("savedAccounts", "array-contains", account)
        .where("savedAt", ">", 0)
        .where("roomExpiry", ">", Timestamp.now())
        .orderBy("savedAt", "desc")
        .orderBy("roomExpiry", "desc")
        .limit(24)
        .get();
      return result.docs.map(roomData);
    },
    async writeRoom(snapshot, room, actor, guard) {
      const record = {
        room,
        roomExpiry: Timestamp.fromMillis(room.expiresAt),
        leaseExpiry: Timestamp.fromMillis(room.leaseUntil),
        inviteHashes: room.invite
          ? [room.invite.codeHash, room.invite.linkHash]
          : [],
        accounts: room.members.map(({ account }) => account),
        savedAt: room.head?.savedAt ?? 0,
        savedAccounts: room.head
          ? room.members
              .filter(({ withdrawn }) => !withdrawn)
              .map(({ account }) => account)
          : [],
        bindings: Object.fromEntries(
          room.members.map(({ id, account, binding, active, seenAt }) => [
            id,
            { account, binding, active, seenAt: Timestamp.fromMillis(seenAt) },
          ]),
        ),
        writeGuard: {
          ...guard,
          account: actor.account,
          binding: actor.binding,
          tokenHash: actor.tokenHash,
          deadline: Timestamp.fromMillis(guard.deadline),
        },
      };
      const database = `projects/${projectId}/databases/(default)`;
      const response = await fetchImpl(
        `https://firestore.googleapis.com/v1/${database}/documents:commit`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${await writerToken()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            writes: [
              {
                update: {
                  name: `${database}/documents/${COLLECTION}/${room.id}`,
                  fields: firestoreFields(record),
                },
                currentDocument: snapshot?.exists
                  ? { updateTime: version(snapshot) }
                  : { exists: false },
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
      if (response.ok) return true;
      if ([403, 409].includes(response.status)) return false;
      const { error } = await response.json().catch(() => ({}));
      if (error?.status === "FAILED_PRECONDITION") return false;
      throw new CrossplayError(503, "unavailable");
    },
  };
}

module.exports = { createStore, createWriter, firestoreValue, toMillis };
