const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const { gzipSync } = require("node:zlib");
const { handle } = require("./coop-checkpoints.cjs");

function encoded(value) {
  const bytes = gzipSync(Buffer.from(JSON.stringify(value)));
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
          objects.set(key, { bytes, generation: String(++generation) });
        },
        async getMetadata() {
          const { generation, bytes } = entry();
          return [{ generation, size: bytes.length }];
        },
        async download() {
          return [entry().bytes];
        },
        async delete() {
          entry();
          objects.delete(key);
        },
      };
    },
  };
  const host = randomUUID();
  const guest = randomUUID();
  const world = {
    schema: 3,
    gameSchema: 1,
    rules: "compatibility",
    epoch: randomUUID(),
    matchId: randomUUID(),
    revision: 4,
    spec: { scenarioId: 1 },
    seats: [{ id: host }, { id: guest }],
    grids: [{}, {}],
  };
  const state = {
    hostId: host,
    locked: true,
    rules: world.rules,
    epoch: world.epoch,
    members: world.seats,
    head: null,
  };
  function context(seatId = host) {
    return {
      bucket,
      roomId: "room",
      seatId,
      hostId: host,
      room: { ...state },
      async updateRoom(update, guard) {
        assert.equal(guard, "host");
        const { room, value } = update({ ...state });
        Object.assign(state, room);
        return value;
      },
    };
  }
  return { context, objects, state, world, guest };
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
