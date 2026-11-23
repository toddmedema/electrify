const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { gzipSync } = require("node:zlib");
const { handle, reap } = require("./coop-checkpoints.cjs");
const {
  buildCheckpointValidator,
} = require("../../scripts/build-coop-checkpoint-validator");
const output = mkdtempSync(
  path.join(tmpdir(), "electrify-checkpoint-validator-"),
);
const checkpointValidatorPath = path.join(
  output,
  "runtime/server/checkpoint.cjs",
);
let createWorld, loadSimData, matchScenario, checkpointWorld, encodeWire;

before(async () => {
  await buildCheckpointValidator(output);
  require("../../scripts/testing/replication-runtime")();
  ({
    createWorld,
    matchScenario,
    checkpointWorld,
  } = require("../../src/multiplayer/World"));
  ({ encodeWire } = require("../../src/multiplayer/WireJson"));
  ({ loadSimData } = require("../../src/testing/SimData"));
});
after(() => rmSync(output, { recursive: true, force: true }));

function encoded(value) {
  const bytes = gzipSync(Buffer.from(encodeWire(value)));
  return {
    content: bytes.toString("base64"),
    digest: createHash("sha256").update(bytes).digest("hex"),
    explicit: true,
  };
}

function fixture() {
  const objects = new Map();
  let generation = 0;
  const bucket = {
    async getFiles({ prefix }) {
      return [
        [...objects]
          .filter(([key]) => key.startsWith(prefix))
          .map(([name, metadata]) => ({
            name,
            metadata,
          })),
      ];
    },
    file(key, options = {}) {
      function entry() {
        const value = objects.get(key);
        assert.ok(value);
        if (options.generation)
          assert.equal(value.generation, options.generation);
        return value;
      }
      return {
        async save(bytes, options) {
          assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
          assert.equal(objects.has(key), false);
          objects.set(key, {
            bytes,
            generation: String(++generation),
            timeCreated: new Date().toISOString(),
          });
        },
        async getMetadata() {
          const { generation, bytes } = entry();
          return [{ generation, size: bytes.length }];
        },
        async download() {
          return [entry().bytes];
        },
        async delete(options) {
          assert.equal(options.ifGenerationMatch, entry().generation);
          objects.delete(key);
        },
      };
    },
  };
  const host = randomUUID();
  const guest = randomUUID();
  const roomId = randomUUID();
  const spec = { scenarioId: 106, difficulty: "Employee" };
  loadSimData(matchScenario(spec).location);
  const seats = [
    { id: host, name: "Host" },
    { id: guest, name: "Guest" },
  ];
  const world = {
    ...checkpointWorld(createWorld(spec, seats, randomUUID(), randomUUID())),
    revision: 4,
  };
  const state = {
    hostId: host,
    locked: true,
    rules: world.rules,
    epoch: world.epoch,
    members: world.seats,
    head: null,
    requiredIds: seats.map(({ id }) => id),
  };
  function context(seatId = state.hostId) {
    return {
      bucket,
      roomId,
      checkpointValidatorPath,
      seatId,
      hostId: state.hostId,
      room: { ...state },
      async updateRoom(update, guard) {
        assert.equal(guard, "host");
        const { room, value } = update({ ...state });
        Object.assign(state, room);
        return value;
      },
      async recheck() {
        return { ...state };
      },
    };
  }
  return { bucket, context, objects, roomId, state, world, guest };
}

test("publishes immutable checkpoints and repeats an exact authorized save", async () => {
  const { context, objects, world, state } = fixture();
  const body = encoded(world);
  const first = await handle("save/publish", context(), body);
  assert.equal(state.head.epoch, world.epoch);
  assert.deepEqual(await handle("save/publish", context(), body), first);
  assert.equal(objects.size, 1);
  assert.deepEqual(await handle("save/read", context(), {}), {
    content: body.content,
    digest: body.digest,
  });
});

test("reserves bounded recovery uploads when ordinary checkpoint attempts run out", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { context, world, state, guest } = fixture();
  const ordinary = encoded(world);
  for (let attempt = 0; attempt < 6; attempt++)
    await handle("save/publish", context(), ordinary);
  await assert.rejects(handle("save/publish", context(), ordinary), {
    code: "checkpoint-rate-limit",
  });

  state.hostId = guest;
  state.epoch = randomUUID();
  state.restoreHead = state.head;
  const recovery = {
    ...encoded({ ...world, epoch: state.epoch }),
    explicit: false,
  };
  await assert.rejects(
    handle("save/publish", context(), {
      ...recovery,
      digest: "a".repeat(64),
    }),
    { code: "invalid-snapshot" },
  );
  await handle("save/publish", context(), recovery);
  assert.equal(state.head.epoch, state.epoch);
  assert.equal(state.restoreHead, null);
  await assert.rejects(handle("save/publish", context(), recovery), {
    code: "checkpoint-rate-limit",
  });

  state.hostId = world.seats[0].id;
  state.epoch = randomUUID();
  state.restoreHead = state.head;
  const nextRecovery = {
    ...encoded({ ...world, epoch: state.epoch }),
    explicit: false,
  };
  await assert.rejects(handle("save/publish", context(), nextRecovery), {
    code: "checkpoint-rate-limit",
  });
  t.mock.timers.tick(60_000);
  await handle("save/publish", context(), nextRecovery);
  assert.equal(state.head.epoch, state.epoch);
});

test("guests, wrong epochs and corrupt compressed uploads cannot publish a head", async () => {
  const { context, objects, world, state, guest } = fixture();
  await assert.rejects(handle("save/publish", context(guest), encoded(world)), {
    status: 403,
  });
  await assert.rejects(
    handle(
      "save/publish",
      context(),
      encoded({ ...world, epoch: randomUUID() }),
    ),
    { code: "invalid-checkpoint" },
  );
  await assert.rejects(
    handle("save/publish", context(), {
      ...encoded(world),
      digest: "a".repeat(64),
    }),
    { code: "invalid-snapshot" },
  );
  assert.equal(objects.size, 0);
  assert.equal(state.head, null);
});

test("a superseded write cannot change a newer head", async () => {
  const { context, world, state } = fixture();
  const stale = context();
  await handle("save/publish", context(), encoded({ ...world, revision: 20 }));
  await assert.rejects(handle("save/publish", stale, encoded(world)), {
    code: "checkpoint-conflict",
  });
  assert.equal(state.head.revision, 20);
});

test("rejects invalid grids and incompatible save schemas before writing an object", async () => {
  const { context, objects, world, state } = fixture();
  await assert.rejects(
    handle("save/publish", context(), encoded({ ...world, grids: [{}, {}] })),
    { code: "invalid-checkpoint" },
  );
  await assert.rejects(
    handle(
      "save/publish",
      context(),
      encoded({ ...world, gameSchema: world.gameSchema + 1 }),
    ),
    { code: "invalid-checkpoint" },
  );
  assert.equal(objects.size, 0);
  assert.equal(state.head, null);
});

test("pins the campaign setup and disallows conflicting bytes at the same revision", async () => {
  const { context, objects, world, state } = fixture();
  const data = encoded(world);
  await handle("save/publish", context(), { ...data, explicit: false });
  assert.equal(state.explicitHead, null);
  await handle("save/publish", context(), data);
  assert.equal(state.explicitHead.id, state.head.id);
  assert.equal(objects.size, 1);
  await assert.rejects(
    handle(
      "save/publish",
      context(),
      encoded({ ...world, pricePerMWh: world.pricePerMWh + 1 }),
    ),
    { code: "checkpoint-conflict" },
  );
  const alternate = checkpointWorld(
    createWorld(
      {
        ...world.spec,
        difficulty: "Manager",
      },
      world.seats,
      world.matchId,
      world.epoch,
    ),
  );
  await assert.rejects(
    handle(
      "save/publish",
      context(),
      encoded({ ...alternate, revision: world.revision + 1 }),
    ),
    { code: "checkpoint-conflict" },
  );
  assert.equal(state.head.digest, data.digest);
  assert.equal(objects.size, 1);
});

test("an explicit pause can publish at the most recent confirmed revision", async () => {
  const { context, world, state } = fixture();
  await handle("save/publish", context(), {
    ...encoded(world),
    explicit: false,
  });
  const previous = state.head.id;
  const paused = { ...world, reason: "Host saved and stopped the match" };
  await handle("save/publish", context(), encoded(paused));
  assert.equal(state.head.revision, world.revision);
  assert.notEqual(state.head.id, previous);
  assert.equal(state.explicitHead.id, state.head.id);
});

test("requires the same restore generation after reading from storage", async () => {
  const { context, world, state } = fixture();
  await handle("save/publish", context(), encoded(world));
  const reader = context();
  await handle(
    "save/publish",
    context(),
    encoded({ ...world, revision: world.revision + 1 }),
  );
  assert.notEqual(reader.room.head.id, state.head.id);
  await assert.rejects(handle("save/read", reader, {}), {
    code: "checkpoint-conflict",
  });
  const exportResult = await handle("save/download", reader, {});
  assert.equal(exportResult.digest, reader.room.head.digest);
});

test("reaps abandoned objects by generation while preserving every pinned checkpoint", async () => {
  const { bucket, context, objects, roomId, world, state } = fixture();
  await handle("save/publish", context(), encoded(world));
  const pinned = `checkpoints/${roomId}/${state.head.id}`;
  const obsolete = `checkpoints/${roomId}/${randomUUID()}`;
  const abandoned = `staging/${roomId}/${randomUUID()}`;
  const now = Date.now();
  for (const [key, age] of [
    [pinned, 1_000_000],
    [obsolete, 1_000_000],
    [abandoned, 200_000],
  ]) {
    objects.set(key, {
      generation: objects.get(key)?.generation ?? "4",
      timeCreated: new Date(now - age).toISOString(),
    });
  }
  await reap(
    bucket,
    async (id) => {
      assert.equal(id, roomId);
      return state;
    },
    now,
  );
  assert.deepEqual([...objects.keys()], [pinned]);
});

test("preserves the original roster and removes retired guests from required attendance", async () => {
  const { context, guest, world, state } = fixture();
  const hostId = state.hostId;
  const ended = {
    ...world,
    outcomes: { [guest]: { outcome: "bankrupt", title: "Bankrupt", month: 0 } },
  };
  await handle("save/publish", context(), encoded(ended));
  assert.deepEqual(state.head.seats, world.seats);
  assert.deepEqual(state.requiredIds, [hostId]);
  assert.deepEqual(state.members, world.seats);
});
