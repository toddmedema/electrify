const { createHmac, randomUUID } = require("node:crypto");
const { CrossplayError, requireValue } = require("./crossplay-errors.cjs");
const { hash, keys, randomSecret, text } = require("./crossplay-identity.cjs");

const ROOM_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const RULES_ID = /^coop-\d+-[a-f0-9]{64}$/;
const CODE = /^[a-z0-9]{6}$/i;
const LEGACY_CODE = /^[a-f0-9]{20}$/i;
const CODE_SPAN = 36n ** 6n;
const INVITE_VERSION_PREFIX = "derived.";
const LINK = /^[A-Za-z0-9_-]{22}$/;
const MEMBER_DATA = /^[a-zA-Z0-9_.:|-]*$/;
const MEMBERS = 4;
const LEASE_MS = 12_000;
const PRESENCE_MS = 12_000;
const GUARD_MS = 3_000;
const HEARTBEAT_MS = 4000;
const INVITE_MS = 15 * 60_000;
const LOBBY_MS = 30 * 60_000;
const CAMPAIGN_MS = 30 * 24 * 60 * 60_000;

function roomId(value) {
  requireValue(typeof value === "string" && ROOM_ID.test(value));
  return value;
}

function publicSeat({ id, name, ready, slot }) {
  return { id, name, ready, slot };
}

function sameSet(left, right) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function accountSeat(room, account) {
  return room.members.find(
    (member) => member.account === account && !member.withdrawn,
  );
}

function bindingCurrent(member, account, now) {
  return (
    !!account &&
    !account.banned &&
    !account.revoked &&
    account.expiresAt > now &&
    account.binding === member.binding
  );
}

function activeMember(member, account, now) {
  return (
    !!member?.active &&
    !member.withdrawn &&
    (member.away || now - member.seenAt < PRESENCE_MS) &&
    bindingCurrent(member, account, now)
  );
}

function acceptPresenceSeq(member, seq) {
  if (seq === undefined) return member.presenceSeq === undefined;
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > 1_000_000) return false;
  if (seq <= (member.presenceSeq ?? 0)) return false;
  member.presenceSeq = seq;
  return true;
}

function forgetPair(room, seatId) {
  if (room.hostId === seatId) room.signals = {};
  else if (room.signals) delete room.signals[seatId];
}

function invalidInvite(condition) {
  requireValue(condition, 404, "invalid_invite");
}

function createRooms({ store, inviteKey, extensions = {}, campaignRules }) {
  async function loadRoom(id) {
    const result = await store.getRoom(id);
    if (!result.room || result.room.expiresAt <= result.now) return null;
    return result;
  }

  async function project(room, now) {
    const accounts = await store.accounts(
      room.members.map((member) => member.account),
    );
    return {
      ...room,
      members: room.members.map((member, index) => ({
        ...member,
        active: activeMember(member, accounts[index], now),
      })),
    };
  }

  function isLive(room, now) {
    return (
      room.leaseUntil > now &&
      room.members.some((member) => member.id === room.hostId && member.active)
    );
  }

  async function reserve(id, now) {
    requireValue(
      await store.reserveRoom(id, now + LEASE_MS + GUARD_MS, now),
      429,
      "room_capacity",
    );
  }

  const keyedInviteHash = (purpose, value) =>
    createHmac("sha256", inviteKey).update(
      `electrify-coop-invite:${purpose}:${value}`,
    );
  const codeDigest = (code) => keyedInviteHash("lookup", code).digest("hex");

  // Host polls can recover the same secrets without storing them in a room document.
  function inviteSecrets(version) {
    return {
      inviteCode: (
        keyedInviteHash("code", version).digest().readBigUInt64BE() % CODE_SPAN
      )
        .toString(36)
        .padStart(6, "0"),
      inviteToken: keyedInviteHash("link", version)
        .digest()
        .subarray(0, 16)
        .toString("base64url"),
    };
  }

  function inviteExpired(room, now) {
    return (
      !room.invite ||
      room.invite.expiresAt <= now ||
      (room.invite.version.startsWith(INVITE_VERSION_PREFIX) &&
        !revealInvite(room.invite))
    );
  }

  async function rollInvite(id, now) {
    const expiresAt = now + INVITE_MS;
    for (let attempt = 0; attempt < 8; attempt++) {
      const version = INVITE_VERSION_PREFIX + randomSecret(12);
      const { inviteCode, inviteToken } = inviteSecrets(version);
      const codeHash = codeDigest(inviteCode);
      if (await store.reserveInviteCode(codeHash, id, expiresAt, now))
        return { version, codeHash, linkHash: hash(inviteToken), expiresAt };
    }
    throw new CrossplayError(503, "unavailable");
  }

  function revealInvite(invite) {
    if (!invite.version.startsWith(INVITE_VERSION_PREFIX)) return undefined;
    const secret = inviteSecrets(invite.version);
    if (
      codeDigest(secret.inviteCode) === invite.codeHash &&
      hash(secret.inviteToken) === invite.linkHash
    )
      return secret;
  }

  async function edit(id, actor, initialGuard, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const loaded = await loadRoom(id);
      requireValue(loaded, 404, "room_unavailable");
      const { room, now, snapshot } = loaded;
      const projected = await project(room, now);
      const self = accountSeat(projected, actor.account);
      const guard =
        typeof initialGuard === "string"
          ? { type: initialGuard }
          : initialGuard;
      const type = guard.type;
      if (type !== "invite") requireValue(self, 403, "forbidden");
      if (type === "active" || type === "host") {
        requireValue(
          self.active &&
            self.binding === actor.binding &&
            isLive(projected, now),
          409,
          "authority_changed",
        );
        if (type === "host")
          requireValue(room.hostId === self.id, 403, "forbidden");
        if (guard.peerId)
          requireValue(
            projected.members.some(
              (member) => member.id === guard.peerId && member.active,
            ),
            409,
            "authority_changed",
          );
      }
      const result = await mutate(structuredClone(room), self, now, projected);
      if (!result?.room) return result?.value;
      const writeGuard = {
        type: result.guard ?? type,
        seatId: result.seatId ?? self?.id ?? "",
        peerId: guard.peerId ?? "",
        deadline: Math.min(now + GUARD_MS, result.deadline ?? Infinity),
        ...(guard.inviteHash && { inviteHash: guard.inviteHash }),
      };
      if (await store.writeRoom(snapshot, result.room, actor, writeGuard)) {
        return result.value;
      }
    }
    throw new CrossplayError(409, "authority_changed");
  }

  async function response(id, actor) {
    const loaded = await loadRoom(id);
    requireValue(loaded, 404, "room_unavailable");
    const { now } = loaded;
    const room = await project(loaded.room, now);
    const self = accountSeat(room, actor.account);
    invalidInvite(self);
    requireValue(self.binding === actor.binding, 409, "seat_reclaim_required");
    const host = room.members.find((member) => member.id === room.hostId);
    return {
      lobby: {
        available: true,
        lobbyId: id,
        hostId: host?.id,
        selfId: self.id,
        members: room.members
          .filter(({ withdrawn }) => !withdrawn)
          .map(publicSeat),
        connected: [],
        ...(host?.id === self.id && {
          ...(room.invite?.expiresAt > now && {
            inviteVersion: room.invite.version,
            inviteExpiresAt: room.invite.expiresAt,
            ...(self.active && isLive(room, now) && revealInvite(room.invite)),
          }),
        }),
        ...(room.head && {
          savedAt: room.head.savedAt,
          sharedAt: room.head.savedAt,
        }),
      },
      authority: {
        epoch: room.epoch,
        binding: actor.binding,
        presence: self.presence,
        hostBinding: host?.binding,
        leaseRemainingMs:
          self.active && isLive(room, now) ? room.leaseUntil - now : 0,
        head: room.head,
        requiredIds: room.requiredIds,
        locked: room.locked,
      },
      connections: [],
    };
  }

  async function create(actor, body, limit) {
    keys(body, "rules", "name");
    requireValue(
      typeof body.rules === "string" &&
        RULES_ID.test(body.rules) &&
        text(body.name, 40),
    );
    await limit("room-create", actor.account, 10);
    const id = randomUUID();
    const seat = randomUUID();
    const { now } = await store.getRoom(id);
    await reserve(id, now);
    const invite = await rollInvite(id, now);
    const room = {
      id,
      rules: body.rules,
      hostId: seat,
      epoch: randomUUID(),
      leaseUntil: now + LEASE_MS,
      expiresAt: now + LOBBY_MS,
      invite,
      members: [
        {
          id: seat,
          account: actor.account,
          binding: actor.binding,
          presence: randomUUID(),
          name: body.name,
          active: true,
          seenAt: now,
        },
      ],
      locked: false,
      requiredIds: [],
      head: null,
      signals: {},
    };
    requireValue(
      await store.writeRoom(null, room, actor, {
        type: "create",
        seatId: seat,
        peerId: "",
        deadline: now + GUARD_MS,
      }),
      409,
      "authority_changed",
    );
    return response(id, actor);
  }

  async function join(actor, body, limit) {
    keys(body, "rules", "name", "invite");
    requireValue(
      text(body.name, 40) &&
        typeof body.rules === "string" &&
        RULES_ID.test(body.rules),
    );
    await limit("room-join", actor.account, 12);
    const token = typeof body.invite === "string" ? body.invite.trim() : "";
    const shortCode = CODE.test(token);
    const code = shortCode || LEGACY_CODE.test(token);
    invalidInvite(code || LINK.test(token));
    const digest = shortCode
      ? codeDigest(token.toLowerCase())
      : hash(code ? token.toLowerCase() : token);
    const found = await store.findInvite(digest, shortCode);
    invalidInvite(found?.room);
    const id = found.room.id;
    await limit("room-invitations", id, 40);
    const reclaim = await edit(
      id,
      actor,
      { type: "invite", inviteHash: digest },
      (room, self, now, projected) => {
        invalidInvite(
          !room.locked &&
            room.rules === body.rules &&
            isLive(projected, now) &&
            room.invite?.expiresAt > now &&
            [room.invite.codeHash, room.invite.linkHash].includes(digest) &&
            !room.removedAccounts?.includes(actor.account),
        );
        if (self)
          return { value: self.binding !== actor.binding || !self.active };
        requireValue(room.members.length < MEMBERS, 409, "room_full");
        const seatId = randomUUID();
        room.members.push({
          id: seatId,
          account: actor.account,
          binding: actor.binding,
          presence: randomUUID(),
          name: body.name,
          seenAt: now,
          active: true,
        });
        return { room, seatId, deadline: room.invite.expiresAt };
      },
    );
    if (reclaim) return reconnect(id, actor, { roomId: id, rules: body.rules });
    return response(id, actor);
  }

  async function state(id, actor) {
    const loaded = await loadRoom(id);
    requireValue(loaded, 404, "room_unavailable");
    const self = accountSeat(loaded.room, actor.account);
    if (self?.binding === actor.binding && self.active) {
      const renew = loaded.room.hostId === self.id;
      if (
        loaded.now - self.seenAt >= HEARTBEAT_MS &&
        loaded.room.leaseUntil > loaded.now
      ) {
        let replaceInvite = false;
        try {
          replaceInvite =
            (await edit(
              id,
              actor,
              renew ? "host" : "active",
              async (room, seat, now) => {
                if (now - seat.seenAt < HEARTBEAT_MS || seat.away) return {};
                let roll = false;
                if (renew) {
                  await reserve(id, now);
                  room.leaseUntil = now + LEASE_MS;
                  if (!room.locked) {
                    room.expiresAt = now + LOBBY_MS;
                    roll = inviteExpired(room, now);
                  }
                }
                const present = room.members.find(({ id }) => id === seat.id);
                present.seenAt = now;
                return { room, value: roll };
              },
            )) === true;
        } catch (error) {
          if (error.code !== "authority_changed") throw error;
        }
        if (replaceInvite) {
          // The lease is already committed. A failed code reservation must not
          // roll that write back or fail the host's presence update.
          await edit(id, actor, "host", async (room, _seat, now) => {
            if (room.locked || !inviteExpired(room, now)) return {};
            room.invite = await rollInvite(id, now);
            return { room };
          }).catch((error) => {
            if (
              error.code !== "authority_changed" &&
              error.code !== "unavailable"
            )
              throw error;
          });
        }
      }
    }
    return response(id, actor);
  }

  async function reconnect(id, actor, body) {
    keys(body, "roomId", "rules");
    requireValue(typeof body.rules === "string" && RULES_ID.test(body.rules));
    await edit(id, actor, "member", async (room, self, now) => {
      const upgrade = body.rules !== room.rules;
      if (upgrade) {
        const published = campaignRules?.published;
        const checkpoint = room.head;
        // Compatibility follows the published checkpoint. room.rules may name
        // an intermediate build that acquired the room without publishing.
        requireValue(
          body.rules === campaignRules?.current &&
            room.leaseUntil <= now &&
            room.locked &&
            checkpoint &&
            published &&
            Object.hasOwn(published, checkpoint.rules) &&
            published[checkpoint.rules] === checkpoint.gameSchema,
          409,
          "incompatible",
        );
      }
      const member = room.members.find(({ id }) => id === self.id);
      if (
        (room.head?.activeSeatIds ?? room.requiredIds).some((id) =>
          room.members.some((entry) => entry.id === id && entry.withdrawn),
        )
      ) {
        throw new CrossplayError(409, "roster_unavailable");
      }
      if (
        room.leaseUntil > now &&
        room.hostId === self.id &&
        member.binding !== actor.binding
      ) {
        throw new CrossplayError(409, "host_lease_held");
      }
      let guard = "member";
      if (
        room.leaseUntil <= now &&
        (room.hostId === self.id || (room.locked && room.head))
      ) {
        await reserve(id, now);
        room.hostId = self.id;
        room.leaseUntil = now + LEASE_MS;
        room.epoch = randomUUID();
        room.restoreHead = room.head;
        if (upgrade) room.rules = body.rules;
        if (room.head?.activeSeatIds)
          room.requiredIds = Array.from(
            new Set([...room.head.activeSeatIds, self.id]),
          );
        room.signals = {};
        room.members.forEach((entry) => {
          delete entry.ready;
          delete entry.slot;
        });
        guard = "acquire";
      } else if (member.binding !== actor.binding) {
        // A new device must not inherit the previous device's relay descriptions.
        forgetPair(room, self.id);
      }
      member.binding = actor.binding;
      delete member.away;
      member.presence = randomUUID();
      member.seenAt = now;
      member.active = true;
      return { room, guard };
    });
    return response(id, actor);
  }

  async function roomAction(operation, id, actor, body) {
    const withOnlyRoom = () => keys(body, "roomId");
    switch (operation) {
      case "room/state":
        withOnlyRoom();
        return state(id, actor);
      case "room/reconnect":
        return reconnect(id, actor, body);
      case "room/member":
        keys(body, "roomId", "key", "value");
        requireValue(
          (body.key === "ready" || body.key === "slot") &&
            typeof body.value === "string" &&
            body.value.length <= (body.key === "ready" ? 256 : 128) &&
            MEMBER_DATA.test(body.value),
        );
        await edit(id, actor, "active", (room, self) => {
          room.members.find(({ id }) => id === self.id)[body.key] = body.value;
          return { room };
        });
        break;
      case "room/lock":
        keys(body, "roomId", "ids", "requiredIds");
        requireValue(
          Array.isArray(body.ids) &&
            body.ids.length >= 2 &&
            body.ids.length <= MEMBERS &&
            new Set(body.ids).size === body.ids.length &&
            Array.isArray(body.requiredIds) &&
            body.requiredIds.length >= 1 &&
            body.requiredIds.length <= body.ids.length &&
            new Set(body.requiredIds).size === body.requiredIds.length &&
            body.requiredIds.every((id) => body.ids.includes(id)),
        );
        await edit(id, actor, "host", (room, self, now, projected) => {
          requireValue(
            body.requiredIds.includes(self.id) &&
              sameSet(
                body.ids,
                room.members.map(({ id }) => id),
              ) &&
              body.requiredIds.every((seat) =>
                projected.members.some(
                  ({ id, active }) => id === seat && active,
                ),
              ),
            409,
            "roster_unavailable",
          );
          if (room.locked) {
            requireValue(
              sameSet(room.requiredIds, body.requiredIds),
              409,
              "roster_locked",
            );
            return {};
          }
          room.locked = true;
          room.requiredIds = body.requiredIds;
          room.invite = null;
          room.expiresAt = now + CAMPAIGN_MS;
          return { room };
        });
        break;
      case "room/unlock": {
        withOnlyRoom();
        await edit(id, actor, "host", async (room, _self, now) => {
          requireValue(!room.head, 409, "roster_locked");
          room.members = room.members.filter((member) => !member.withdrawn);
          room.locked = false;
          room.requiredIds = [];
          room.expiresAt = now + LOBBY_MS;
          room.invite = await rollInvite(id, now);
          return { room };
        });
        return response(id, actor);
      }
      case "room/remove": {
        keys(body, "roomId", "seatId");
        await edit(id, actor, "host", (room, self) => {
          const target = room.members.find(({ id }) => id === body.seatId);
          requireValue(target && target.id !== self.id, 403, "forbidden");
          forgetPair(room, target.id);
          if (room.locked) {
            target.withdrawn = true;
            target.active = false;
          } else {
            room.members = room.members.filter(({ id }) => id !== target.id);
            room.removedAccounts = [
              ...(room.removedAccounts ?? []),
              target.account,
            ];
          }
          return { room };
        });
        break;
      }
      case "room/resume": {
        keys(
          body,
          "roomId",
          "presence",
          ...(body?.seq === undefined ? [] : ["seq"]),
        );
        requireValue(ROOM_ID.test(body.presence));
        requireValue(
          acceptPresenceSeq({ presenceSeq: 0 }, body.seq) ||
            body.seq === undefined,
        );
        await edit(id, actor, "bound", async (room, self, now) => {
          const member = room.members.find(
            ({ account }) => account === actor.account,
          );
          requireValue(
            self.binding === actor.binding,
            409,
            "seat_reclaim_required",
          );
          if (member.presence !== body.presence) return {};
          if (!acceptPresenceSeq(member, body.seq)) return {};
          delete member.away;
          member.seenAt = now;
          member.active = true;
          if (room.hostId === member.id && room.leaseUntil > now) {
            await reserve(id, now);
            room.leaseUntil = now + LEASE_MS;
            if (!room.locked)
              room.expiresAt = Math.max(room.expiresAt, now + LOBBY_MS);
          }
          return { room };
        });
        return response(id, actor);
      }
      case "room/suspend":
      case "room/leave":
      case "room/withdraw": {
        if (operation === "room/suspend") {
          keys(
            body,
            "roomId",
            "presence",
            ...(body?.seq === undefined ? [] : ["seq"]),
          );
          requireValue(ROOM_ID.test(body.presence));
          requireValue(
            body.seq === undefined ||
              (Number.isSafeInteger(body.seq) &&
                body.seq >= 1 &&
                body.seq <= 1_000_000),
          );
        } else withOnlyRoom();
        const withdraw = operation === "room/withdraw";
        const leave = operation === "room/leave";
        await edit(
          id,
          actor,
          withdraw ? "member" : "bound",
          (room, self, now) => {
            const member = room.members.find(
              ({ account }) => account === actor.account,
            );
            requireValue(
              withdraw || self.binding === actor.binding,
              409,
              "seat_reclaim_required",
            );
            if (
              operation === "room/suspend" &&
              (member.presence !== body.presence ||
                !acceptPresenceSeq(member, body.seq))
            )
              return {};
            if (operation === "room/suspend") {
              // Hiding the tab pauses renewal. The open relay and its credential stay.
              member.away = true;
              return { room };
            }
            forgetPair(room, member.id);
            if (
              !room.locked &&
              (withdraw || (leave && room.hostId !== member.id))
            ) {
              room.members = room.members.filter(({ id }) => id !== member.id);
            } else {
              member.active = false;
              delete member.ready;
              if (withdraw) member.withdrawn = true;
            }
            if (room.hostId === member.id && operation !== "room/suspend") {
              room.leaseUntil = now;
              if (!room.locked) room.expiresAt = now;
            }
            return { room };
          },
        );
        return {};
      }
      default:
        throw new CrossplayError(404, "not_found");
    }
    return response(id, actor);
  }

  return {
    async handle(operation, actor, body, limit) {
      if (operation === "room/create") return create(actor, body, limit);
      if (operation === "room/join") return join(actor, body, limit);
      if (operation === "room/list") {
        keys(body);
        const rooms = await store.listRooms(actor.account);
        return {
          slots: rooms
            .filter(
              ({ room, now }) =>
                room?.head &&
                room.expiresAt > now &&
                accountSeat(room, actor.account),
            )
            .map(({ room }) => ({
              id: room.id,
              name: room.head.name,
              updatedAt: room.head.savedAt,
              matchId: room.head.matchId,
              schema: room.head.schema,
              players: room.members.map(({ name }) => name),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        };
      }
      const id = roomId(body?.roomId);
      const namespace = operation.split("/")[0];
      if (namespace === "room") return roomAction(operation, id, actor, body);
      const handler = extensions[namespace];
      requireValue(typeof handler === "function", 404, "not_found");
      const loaded = await loadRoom(id);
      requireValue(loaded, 404, "room_unavailable");
      const room = await project(loaded.room, loaded.now);
      const self = accountSeat(room, actor.account);
      requireValue(self, 403, "forbidden");
      if (operation !== "save/read" && operation !== "save/download")
        requireValue(
          self.active &&
            self.binding === actor.binding &&
            isLive(room, loaded.now),
          409,
          "authority_changed",
        );
      return handler(
        operation,
        {
          roomId: id,
          seatId: self.id,
          binding: actor.binding,
          hostId: room.hostId,
          epoch: room.epoch,
          room,
          now: loaded.now,
          limit: (bucket, cap) => limit(bucket, actor.account, cap),
          async recheck(requireLease = true) {
            const fresh = await loadRoom(id);
            requireValue(fresh, 404, "room_unavailable");
            const projected = await project(fresh.room, fresh.now);
            const seat = accountSeat(projected, actor.account);
            requireValue(seat, 403, "forbidden");
            if (requireLease)
              requireValue(
                projected.epoch === room.epoch &&
                  seat.active &&
                  seat.binding === actor.binding &&
                  isLive(projected, fresh.now),
                409,
                "authority_changed",
              );
            return projected;
          },
          updateRoom(apply, guard = "active") {
            return edit(id, actor, guard, (current, seat, now, projected) => {
              requireValue(
                current.epoch === room.epoch && seat.binding === actor.binding,
                409,
                "authority_changed",
              );
              return apply(current, now, projected);
            });
          },
        },
        body,
      );
    },
    async loadRoom(id) {
      const loaded = await loadRoom(roomId(id));
      return loaded ? project(loaded.room, loaded.now) : null;
    },
  };
}

module.exports = { createRooms, LEASE_MS, PRESENCE_MS };
