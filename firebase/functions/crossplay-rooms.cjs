const { randomUUID } = require("node:crypto");
const { CrossplayError, requireValue } = require("./crossplay-errors.cjs");
const { hash, keys, randomSecret, text } = require("./crossplay-identity.cjs");

const ROOM_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const RULES_ID = /^coop-\d+-[a-f0-9]{64}$/;
const CODE = /^[a-f0-9]{20}$/i;
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

function rolledInvite(now) {
  const inviteCode = Buffer.from(randomSecret(10), "base64url").toString("hex");
  const inviteToken = randomSecret(16);
  const version = randomSecret(12);
  return {
    secret: { inviteCode, inviteToken, version },
    invite: {
      version,
      codeHash: hash(inviteCode),
      linkHash: hash(inviteToken),
      expiresAt: now + INVITE_MS,
    },
  };
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
    now - member.seenAt < PRESENCE_MS &&
    bindingCurrent(member, account, now)
  );
}

function forgetPair(room, seatId) {
  if (room.hostId === seatId) room.signals = {};
  else if (room.signals) delete room.signals[seatId];
}

function invalidInvite(condition) {
  requireValue(condition, 404, "invalid_invite");
}

function createRooms({ store, extensions = {}, onRoomChanged }) {
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
      if (type !== "invite" && type !== "cancelInvite")
        requireValue(self, 403, "forbidden");
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
        seatId: self?.id ?? "",
        peerId: guard.peerId ?? "",
        approvedId: result.approvedId ?? "",
        deadline: now + GUARD_MS,
      };
      if (await store.writeRoom(snapshot, result.room, actor, writeGuard)) {
        return result.value;
      }
    }
    throw new CrossplayError(409, "authority_changed");
  }

  async function response(id, actor, inviteSecret) {
    const loaded = await loadRoom(id);
    requireValue(loaded, 404, "room_unavailable");
    const { now } = loaded;
    const room = await project(loaded.room, now);
    const self = accountSeat(room, actor.account);
    if (!self) {
      invalidInvite(
        room.pending.some(
          (item) => item.account === actor.account && item.expiresAt > now,
        ),
      );
      return {
        lobby: {
          available: true,
          lobbyId: id,
          members: [],
          connected: [],
          joinPending: true,
        },
        authority: null,
        connections: [],
      };
    }
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
          pendingApprovals: room.pending
            .filter((item) => item.expiresAt > now)
            .map(({ id, name }) => ({ id, name })),
          ...(room.invite?.expiresAt > now && {
            inviteVersion: room.invite.version,
            inviteExpiresAt: room.invite.expiresAt,
            ...(inviteSecret &&
              hash(inviteSecret.inviteCode) === room.invite.codeHash &&
              inviteSecret),
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
        leaseRemainingMs: isLive(room, now) ? room.leaseUntil - now : 0,
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
    const { secret, invite } = rolledInvite(now);
    await reserve(id, now);
    const room = {
      id,
      rules: body.rules,
      hostId: seat,
      epoch: randomUUID(),
      leaseUntil: now + LEASE_MS,
      expiresAt: now + LOBBY_MS,
      invite,
      pending: [],
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
        approvedId: "",
        deadline: now + GUARD_MS,
      }),
      409,
      "authority_changed",
    );
    return response(id, actor, secret);
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
    invalidInvite(CODE.test(token) || LINK.test(token));
    const digest = hash(CODE.test(token) ? token.toLowerCase() : token);
    const found = await store.findInvite(digest);
    invalidInvite(found?.room);
    const id = found.room.id;
    await limit("room-invitations", id, 40);
    const reclaim = await edit(
      id,
      actor,
      "invite",
      (room, self, now, projected) => {
        invalidInvite(
          !room.locked &&
            room.rules === body.rules &&
            isLive(projected, now) &&
            room.invite?.expiresAt > now &&
            [room.invite.codeHash, room.invite.linkHash].includes(digest),
        );
        if (self)
          return { value: self.binding !== actor.binding || !self.active };
        room.pending = room.pending.filter((entry) => entry.expiresAt > now);
        const previous = room.pending.find(
          ({ account }) => account === actor.account,
        );
        if (previous?.binding === actor.binding) return { value: null };
        invalidInvite(previous || room.pending.length < 8);
        room.pending = room.pending.filter(
          ({ account }) => account !== actor.account,
        );
        room.pending.push({
          id: randomUUID(),
          account: actor.account,
          binding: actor.binding,
          name: body.name,
          expiresAt: Math.min(room.invite.expiresAt, now + 5 * 60_000),
        });
        return { room };
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
        await edit(
          id,
          actor,
          renew ? "host" : "active",
          async (room, seat, now) => {
            if (now - seat.seenAt < HEARTBEAT_MS) return {};
            if (renew) {
              await reserve(id, now);
              room.leaseUntil = now + LEASE_MS;
              if (!room.locked) room.expiresAt = now + LOBBY_MS;
            }
            room.members.find(({ id }) => id === seat.id).seenAt = now;
            return { room };
          },
        ).catch((error) => {
          if (error.code !== "authority_changed") throw error;
        });
      }
    }
    return response(id, actor);
  }

  async function reconnect(id, actor, body) {
    keys(body, "roomId", "rules");
    requireValue(typeof body.rules === "string" && RULES_ID.test(body.rules));
    await edit(id, actor, "member", async (room, self, now) => {
      requireValue(body.rules === room.rules, 409, "incompatible");
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
      } else {
        forgetPair(room, self.id);
      }
      member.binding = actor.binding;
      member.presence = randomUUID();
      member.seenAt = now;
      member.active = true;
      return { room, guard };
    });
    return response(id, actor);
  }

  async function approve(id, actor, body) {
    keys(body, "roomId", "requestId", "approve");
    requireValue(
      ROOM_ID.test(body.requestId) && typeof body.approve === "boolean",
    );
    await edit(id, actor, "host", async (room, _self, now) => {
      requireValue(!room.locked, 409, "roster_locked");
      const pending = room.pending.find(({ id }) => id === body.requestId);
      requireValue(pending?.expiresAt > now, 404, "invalid_invite");
      room.pending = room.pending.filter(({ id }) => id !== pending.id);
      let approvedId;
      if (body.approve) {
        requireValue(room.members.length < MEMBERS, 409, "room_full");
        requireValue(
          bindingCurrent(pending, await store.account(pending.account), now),
          409,
          "authority_changed",
        );
        approvedId = randomUUID();
        room.members.push({
          id: approvedId,
          account: pending.account,
          binding: pending.binding,
          presence: randomUUID(),
          name: pending.name,
          seenAt: now,
          active: true,
        });
      }
      return { room, approvedId };
    });
  }

  async function roomAction(operation, id, actor, body) {
    const withOnlyRoom = () => keys(body, "roomId");
    switch (operation) {
      case "room/state":
        withOnlyRoom();
        return state(id, actor);
      case "room/reconnect":
        return reconnect(id, actor, body);
      case "room/approve":
        await approve(id, actor, body);
        break;
      case "room/rotate-invite": {
        withOnlyRoom();
        const inviteSecret = await edit(
          id,
          actor,
          "host",
          (room, _self, now) => {
            requireValue(!room.locked, 409, "roster_locked");
            const { secret, invite } = rolledInvite(now);
            room.invite = invite;
            room.pending = [];
            return { room, value: secret };
          },
        );
        return response(id, actor, inviteSecret);
      }
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
          room.pending = [];
          room.invite = null;
          room.expiresAt = now + CAMPAIGN_MS;
          return { room };
        });
        break;
      case "room/unlock": {
        withOnlyRoom();
        const secret = await edit(id, actor, "host", (room, _self, now) => {
          requireValue(!room.head, 409, "roster_locked");
          room.members = room.members.filter((member) => !member.withdrawn);
          room.locked = false;
          room.requiredIds = [];
          room.expiresAt = now + LOBBY_MS;
          const { invite, secret } = rolledInvite(now);
          room.invite = invite;
          return { room, value: secret };
        });
        return response(id, actor, secret);
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
            room.pending = room.pending.filter(
              ({ account }) => account !== target.account,
            );
          }
          return { room };
        });
        await onRoomChanged?.();
        break;
      }
      case "room/suspend":
      case "room/leave":
      case "room/withdraw": {
        if (operation === "room/suspend") {
          keys(body, "roomId", "presence");
          requireValue(ROOM_ID.test(body.presence));
        } else withOnlyRoom();
        const withdraw = operation === "room/withdraw";
        const leave = operation === "room/leave";
        if (leave) {
          const loaded = await loadRoom(id);
          if (loaded && !accountSeat(loaded.room, actor.account)) {
            const cancelled = await edit(
              id,
              actor,
              "cancelInvite",
              (room, approved) => {
                if (approved) return { value: false };
                const pending = room.pending.filter(
                  (request) =>
                    request.account !== actor.account ||
                    request.binding !== actor.binding,
                );
                return pending.length === room.pending.length
                  ? { value: true }
                  : { room: { ...room, pending }, value: true };
              },
            );
            if (cancelled) return {};
          }
        }
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
              member.presence !== body.presence
            )
              return {};
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
        await onRoomChanged?.();
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
